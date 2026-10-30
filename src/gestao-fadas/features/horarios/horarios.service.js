'use strict';

/**
 * Regras da fatia Horários e escala (Maturacao/28 seção 5.3; domínio em `_comum/dominio/horarios.js`).
 *   - leitura: equipe (`canViewSchedules`) lê tudo; taróloga só o seu `tarotId` (o que a sessão trouxer);
 *   - gravação: `canEditSchedule` (equipe) ou a taróloga no seu próprio `tarotId`;
 *   - idempotência por `operationKey` (gf_operacoes), concorrência por `expectedRevision` (409 VERSION_CHANGED),
 *     auditoria em gf_auditoria na MESMA transação; o legado MySQL nunca é tocado.
 */

const { randomUUID, createHash } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil, permissoesDoPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { guardarExcecao, revisaoDe } = require('../../_comum/dominio/horarios');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const { lendoNovo } = require('../../novo/leitura');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');
const validar = require('./horarios.validacao');
const store = require('./horarios.store');

const REVISAO_VAZIA = revisaoDe([]);
const negado = (escrita) => new AppError(escrita ? 'Esta ação não está disponível para a sua função.' : 'Esta informação não está disponível para a sua função.', 403, { codigo: 'ACCESS_DENIED' }, true);
// Texto do front (integration/schedules/use-real-schedules.ts, CONFLICT_COPY); o gate só o repassa com `usarMensagem`.
const conflitoVersao = () => new AppError('Não foi possível salvar este horário. Reabra o lançamento e tente novamente.', 409, { codigo: 'VERSION_CHANGED', usarMensagem: true }, true);
const indisponivel = () => new AppError('Serviço indisponível.', 503, { codigo: 'SERVICE_UNAVAILABLE' }, true);
const chaveAuditoria = (escopo, chave) => `hor:${createHash('sha256').update(`${escopo}:${chave}`).digest('hex').slice(0, 40)}`;

function contexto(req, escrita) {
  const perfil = resolverPerfil(req);
  const p = perfil ? permissoesDoPerfil(perfil) : {};
  const proprio = perfil === 'tarologa' ? `${(req.user && req.user.tarotId) || ''}` : '';
  return { perfil, equipe: escrita ? Boolean(p.canEditSchedule) && perfil !== 'tarologa' : Boolean(p.canViewSchedules), proprio };
}

/** Quem pode agir sobre `tarotId`: equipe em qualquer um, taróloga só no seu. */
function exigirAcesso(req, tarotId, escrita) {
  const c = contexto(req, escrita);
  if (c.equipe || (c.perfil === 'tarologa' && c.proprio && c.proprio === tarotId)) return c;
  throw negado(escrita);
}

const mapa = (itens) => Object.fromEntries(itens.map((i) => [i.key, i.override]));
const forma = (o) => JSON.stringify([o.todayHours, o.periods, o.note, o.updatedAt, o.absenceType, o.startDate, o.endDate, o.commandId, o.noteUpdatedAt, o.noteStartDate, o.noteEndDate, o.rosterResponse]);

/** `GET /schedules`: `{ readAt, today, emptyRevision, profiles, overrides, revisions, holidays }`. */
async function ler(req) {
  if (!novosDadosNoPostgres()) throw indisponivel();
  const q = validar.consulta(req.query || {});
  const c = contexto(req, false);
  let alvo = q.tarotId;
  if (c.perfil === 'tarologa') {
    if (!c.proprio || (alvo && alvo !== c.proprio)) throw negado(false);
    alvo = c.proprio;
  } else if (!c.equipe) {
    throw negado(false);
  }
  const { excecoes, semanais } = await lendoNovo((m) => store.lerTudo(m, alvo));
  const ids = new Map();
  for (const e of excecoes) ids.set(e.tarotId, [...(ids.get(e.tarotId) || []), e.id]);
  const semana = new Map();
  for (const s of semanais) semana.set(s.id_tarologo, { ...(semana.get(s.id_tarologo) || {}), [s.weekday]: s.hours });
  const revisions = {};
  for (const id of new Set([...ids.keys(), ...semana.keys()])) revisions[id] = revisaoDe(ids.get(id) || []);
  const noJanela = (o) => (!q.de || o.endDate >= q.de) && (!q.ate || o.startDate <= q.ate);
  return {
    readAt: new Date().toISOString(), today: hojeOperacional(), emptyRevision: REVISAO_VAZIA,
    profiles: [...semana].map(([id, weeklySchedule]) => ({ id, weeklySchedule })),
    overrides: mapa(excecoes.filter((e) => noJanela(e.override))), revisions, holidays: [],
  };
}

/** Executa uma gravação idempotente: efeito + auditoria + gf_operacoes numa transação. */
async function gravar(req, { escopo, operationKey, corpo, tarotId, acao, producao }) {
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  const conta = contaDaRequisicao(req);
  const perfil = resolverPerfil(req);
  if (!conta || !perfil) throw new AppError('Gravação indisponível.', 503, { codigo: 'SERVICE_UNAVAILABLE' }, true);
  try {
    const r = await emTransacao(async (ex) => umaVez(ex, { escopo, chave: operationKey, corpo: { ...corpo, tarotId, usuario: conta } }, async () => {
      const feito = await producao(ex);
      const agora = Date.now();
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: conta, actorRole: perfil, action: acao, entity: 'horarios', entityId: tarotId, before: feito.antes, after: feito.depois },
        { id: randomUUID(), agora, chave: chaveAuditoria(escopo, operationKey) },
      ));
      return feito.resposta;
    }));
    return r.resposta;
  } catch (erro) {
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY')) throw conflitoVersao();
    throw erro;
  }
}

/** Aplica o diff entre as exceções ativas e as novas (soft-delete das que saem ou mudam, insere as novas). */
async function aplicarDiff(ex, tarotId, ativas, proximo, operationKey) {
  const antes = {}; const depois = {};
  const porChave = new Map(ativas.map((a) => [a.key, a]));
  for (const a of ativas) {
    if (!proximo[a.key] || forma(proximo[a.key]) !== forma(a.override)) { await store.removerExcecao(ex, a.id); antes[a.key] = a.override; }
  }
  for (const [chave, o] of Object.entries(proximo)) {
    const atual = porChave.get(chave);
    if (!atual || forma(o) !== forma(atual.override)) { await store.inserirExcecao(ex, tarotId, o, operationKey); depois[chave] = o; }
  }
  return { antes, depois };
}

const respostaExcecoes = (tarotId, proximo) => ({ readAt: new Date().toISOString(), tarotId, overrides: proximo });

async function gravarExcecao(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  const acesso = exigirAcesso(req, tarotId, true);
  const c = validar.corpoExcecao(req.body, { hoje: hojeOperacional(), tarologa: acesso.perfil === 'tarologa' });
  return gravar(req, {
    escopo: 'horarios.excecao', operationKey: c.operationKey, corpo: c, tarotId, acao: 'horarios.excecao.gravar',
    producao: async (ex) => {
      const ativas = await store.ativasDoTarologo(ex, tarotId);
      if (revisaoDe(ativas.map((a) => a.id)) !== c.expectedRevision) throw conflitoVersao();
      const proximo = guardarExcecao(mapa(ativas), tarotId, c.override, c.replaceKey);
      const { antes, depois } = await aplicarDiff(ex, tarotId, ativas, proximo, c.operationKey);
      const novas = await store.ativasDoTarologo(ex, tarotId);
      return { antes, depois, resposta: { ...respostaExcecoes(tarotId, mapa(novas)), revision: revisaoDe(novas.map((a) => a.id)) } };
    },
  });
}

async function removerExcecao(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  exigirAcesso(req, tarotId, true);
  const c = validar.corpoRemocao({ ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) });
  const chave = `${req.params.key || ''}`;
  return gravar(req, {
    escopo: 'horarios.excecao.remover', operationKey: c.operationKey, corpo: { ...c, chave }, tarotId, acao: 'horarios.excecao.remover',
    producao: async (ex) => {
      const ativas = await store.ativasDoTarologo(ex, tarotId);
      if (revisaoDe(ativas.map((a) => a.id)) !== c.expectedRevision) throw conflitoVersao();
      const alvo = ativas.find((a) => a.key === chave);
      if (!alvo) throw new AppError('Não encontrado.', 404, { codigo: 'NOT_FOUND' }, true);
      await store.removerExcecao(ex, alvo.id);
      const novas = await store.ativasDoTarologo(ex, tarotId);
      return { antes: { [alvo.key]: alvo.override }, depois: null, resposta: { ...respostaExcecoes(tarotId, mapa(novas)), revision: revisaoDe(novas.map((a) => a.id)) } };
    },
  });
}

async function gravarSemanal(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  exigirAcesso(req, tarotId, true);
  const c = validar.corpoSemanal(req.body);
  return gravar(req, {
    escopo: 'horarios.semanal', operationKey: c.operationKey, corpo: c, tarotId, acao: 'horarios.semanal.gravar',
    producao: async (ex) => {
      const atual = await store.semanaDoTarologo(ex, tarotId);
      const antes = {}; const depois = {};
      for (const [dia, horas] of Object.entries(c.weeklySchedule)) {
        if (atual[dia] === horas) continue;
        if (atual[dia] === undefined) await store.inserirDia(ex, tarotId, dia, horas); else { await store.atualizarDia(ex, tarotId, dia, horas); antes[dia] = atual[dia]; }
        depois[dia] = horas;
      }
      return { antes, depois, resposta: { readAt: new Date().toISOString(), tarotId, weeklySchedule: { ...atual, ...c.weeklySchedule } } };
    },
  });
}

module.exports = { ler, gravarExcecao, removerExcecao, gravarSemanal, REVISAO_VAZIA };
