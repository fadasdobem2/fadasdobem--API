'use strict';

/**
 * Regras da fatia Presença (Maturacao/28 seção 5.3; domínio em `_comum/dominio/presenca*.js`).
 *   - leitura: equipe (`canViewSchedules`) lê todos; taróloga só o seu `tarotId` (o que a sessão trouxer);
 *   - gravação: equipe (`canManageConsultations`) ou a taróloga no seu próprio `tarotId`; `request` e `activity` só da própria taróloga;
 *   - idempotência por `operationKey` (gf_operacoes), concorrência por `expectedRevision` (409 VERSION_CHANGED),
 *     auditoria em gf_auditoria na MESMA transação, histórico de presença em gf_presenca_historico; o legado MySQL nunca é tocado;
 *   - o vencimento 60+5 NÃO roda aqui: é o job (`presenca.job.js`), com o mesmo `avancarConfirmacao`.
 * Com a fatia Consulta ligada (GF_FATIA_CONSULTA), a regra "consulta já iniciada impede a pausa" é do servidor (gancho `ciclo.presenca`).
 */

const { randomUUID, createHash } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil, permissoesDoPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const { lendoNovo } = require('../../novo/leitura');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');
const dom = require('../../_comum/dominio/presenca');
const horariosStore = require('../horarios/horarios.store');
const validar = require('./presenca.validacao');
const store = require('./presenca.store');
const cicloPresenca = require('../consultas-ciclo/ciclo.presenca');

const REVISAO_VAZIA = '0';
const BATIMENTO_MIN_MS = 60_000;
const negado = (escrita) => new AppError(escrita ? 'Esta ação não está disponível para a sua função.' : 'Esta informação não está disponível para a sua função.', 403, { codigo: 'ACCESS_DENIED' }, true);
const conflitoVersao = () => new AppError('A presença mudou desde que você abriu a tela. Atualize e tente novamente.', 409, { codigo: 'VERSION_CHANGED' }, true);
const indisponivel = () => new AppError('Serviço indisponível.', 503, { codigo: 'SERVICE_UNAVAILABLE' }, true);
const chaveAuditoria = (escopo, chave) => `pre:${createHash('sha256').update(`${escopo}:${chave}`).digest('hex').slice(0, 40)}`;

function contexto(req, escrita) {
  const perfil = resolverPerfil(req);
  const p = perfil ? permissoesDoPerfil(perfil) : {};
  const proprio = perfil === 'tarologa' ? `${(req.user && req.user.tarotId) || ''}` : '';
  return { perfil, equipe: perfil !== 'tarologa' && Boolean(escrita ? p.canManageConsultations : p.canViewSchedules), proprio };
}

/** Quem pode agir sobre `tarotId`: equipe em qualquer um, taróloga só no seu (`soProprio` fecha para a equipe). */
function exigirAcesso(req, tarotId, escrita, soProprio = false) {
  const c = contexto(req, escrita);
  if (c.perfil === 'tarologa' && c.proprio && c.proprio === tarotId) return c;
  if (c.equipe && !soProprio) return c;
  throw negado(escrita);
}

/** Estado vazio de quem ainda nunca declarou turno: Offline, como o front lê `shiftStatus` ausente. */
const perfilInicial = (id) => ({ id, shiftStatus: 'Offline', online: false, status: 'Disponível' });

/** Campos de presença do perfil, como o front lê (sem a escala semanal que o domínio usou). */
const publico = ({ weeklySchedule, ...resto }) => ({ ...resto, online: resto.shiftStatus !== 'Offline', status: resto.shiftStatus === 'Em pausa' ? 'Pausa' : 'Disponível' }); // eslint-disable-line no-unused-vars
const resumo = (p) => ({ shiftStatus: p.shiftStatus, shiftExit: p.shiftExit ?? null, pauseReason: p.pauseReason ?? null, expectedReturn: p.expectedReturn ?? null, returnUntil: p.returnUntil ?? null, confirmacao: p.presenceConfirmation ? p.presenceConfirmation.reason : null });

/** `GET /presence`: `{ readAt, today, emptyRevision, profiles, revisions }`. */
async function ler(req) {
  if (!novosDadosNoPostgres()) throw indisponivel();
  const c = contexto(req, false);
  let alvo;
  if (c.perfil === 'tarologa') {
    if (!c.proprio) throw negado(false);
    alvo = c.proprio;
  } else if (!c.equipe) {
    throw negado(false);
  }
  const linhas = await lendoNovo((m) => store.lerTudo(m, alvo));
  return {
    readAt: new Date().toISOString(), today: hojeOperacional(), emptyRevision: REVISAO_VAZIA,
    profiles: linhas.map((l) => l.perfil), revisions: Object.fromEntries(linhas.map((l) => [l.perfil.id, String(l.revisao)])),
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
      const feito = await producao(ex, { id: conta, name: `${(req.user && req.user.nome) || 'Equipe'}`.slice(0, 200) });
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: conta, actorRole: perfil, action: acao, entity: 'presenca', entityId: tarotId, before: feito.antes, after: feito.depois },
        { id: randomUUID(), agora: Date.now(), chave: chaveAuditoria(escopo, operationKey) },
      ));
      return feito.resposta;
    }));
    return r.resposta;
  } catch (erro) {
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro instanceof dom.RegraPresencaError) throw new AppError(erro.message, 422, { codigo: 'RULE_VIOLATION' }, true);
    if (erro && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY')) throw conflitoVersao();
    throw erro;
  }
}

/** Perfil + escala + exceções do tarólogo dentro da transação (o domínio precisa da escala para o retorno e para o vencimento). */
async function carregar(ex, tarotId) {
  const atual = await store.carregarTravado(ex, tarotId);
  const [semana, ativas] = [await horariosStore.semanaDoTarologo(ex, tarotId), await horariosStore.ativasDoTarologo(ex, tarotId)];
  const excecoes = Object.fromEntries(ativas.map((a) => [a.key, a.override]));
  return { atual, perfil: { ...(atual ? atual.perfil : perfilInicial(tarotId)), weeklySchedule: semana }, excecoes };
}

const conferirRevisao = (atual, esperada) => { if (String(atual ? atual.revisao : 0) !== esperada) throw conflitoVersao(); };
const respostaDe = (tarotId, depois, revisao) => ({ readAt: new Date().toISOString(), tarotId, profile: publico(depois), revision: String(revisao) });

async function aplicar(req, { escopo, acao, corpo, tarotId, mudar }) {
  return gravar(req, {
    escopo, operationKey: corpo.operationKey, corpo, tarotId, acao,
    producao: async (ex, ator) => {
      const { atual, perfil, excecoes } = await carregar(ex, tarotId);
      conferirRevisao(atual, corpo.expectedRevision);
      const agora = Date.now();
      const consultas = await cicloPresenca.resumo(ex, tarotId);
      const depois = mudar(perfil, hojeOperacional(new Date(agora)), ator, agora, excecoes, consultas);
      const limpo = publico(depois);
      const revisao = await store.gravar(ex, tarotId, atual, limpo, { operationKey: corpo.operationKey });
      return { antes: resumo(perfil), depois: resumo(depois), resposta: respostaDe(tarotId, limpo, revisao) };
    },
  });
}

/** `POST /presence/:tarotId/status`: declaração de turno (Disponível, Em pausa, Offline com saída/retorno). */
async function mudarStatus(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  exigirAcesso(req, tarotId, true);
  const c = validar.corpoStatus(req.body);
  return aplicar(req, {
    escopo: 'presenca.status', acao: 'presenca.status', corpo: c, tarotId,
    mudar: (perfil, data, ator, agora, excecoes, consultas) => {
      // Regra do front (reader-start-command.ts:17): consulta já iniciada e sem relato impede a pausa.
      if (c.shiftStatus === 'Em pausa' && consultas && consultas.iniciada) throw new dom.RegraPresencaError(cicloPresenca.MENSAGEM_EM_ANDAMENTO);
      return c.shiftStatus === 'Disponível' ? dom.confirmarPresenca(perfil, data, ator, agora) : dom.mudarPresenca(perfil, c, data, ator, agora, excecoes);
    },
  });
}

/** `POST /presence/:tarotId/confirm`: confirmação expressa (`confirmProfessionalPresence`). */
async function confirmar(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  exigirAcesso(req, tarotId, true);
  const c = validar.corpoConfirmar(req.body);
  return aplicar(req, { escopo: 'presenca.confirmar', acao: 'presenca.confirmar', corpo: c, tarotId, mudar: (perfil, data, ator, agora) => dom.confirmarPresenca(perfil, data, ator, agora) });
}

/** `POST /presence/:tarotId/request`: pedido manual de confirmação ao abrir a página, só se está offline e ainda sem pedido. */
async function pedirConfirmacao(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  exigirAcesso(req, tarotId, true, true);
  const c = validar.corpoPedido(req.body);
  return gravar(req, {
    escopo: 'presenca.pedido', operationKey: c.operationKey, corpo: c, tarotId, acao: 'presenca.pedido',
    producao: async (ex) => {
      const { atual, perfil } = await carregar(ex, tarotId);
      const semTurno = perfil.shiftStatus === 'Offline';
      if (perfil.presenceConfirmation || !semTurno) return { antes: resumo(perfil), depois: resumo(perfil), resposta: respostaDe(tarotId, publico(perfil), atual ? atual.revisao : 0) };
      const depois = publico({ ...perfil, presenceConfirmation: { reason: 'manual', requestedAt: new Date().toISOString() } });
      const revisao = await store.gravar(ex, tarotId, atual, depois, { operationKey: c.operationKey });
      return { antes: resumo(perfil), depois: resumo(depois), resposta: respostaDe(tarotId, depois, revisao) };
    },
  });
}

/** `POST /presence/:tarotId/activity`: batimento da taróloga, no máximo um por minuto, sem mexer na revisão. */
async function registrarBatimento(req) {
  const tarotId = validar.idTarologo(req.params.tarotId);
  exigirAcesso(req, tarotId, true, true);
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  const agora = Date.now();
  return emTransacao(async (ex) => {
    const atual = await store.carregarTravado(ex, tarotId);
    const ultimo = atual && atual.ultimaAtividade ? new Date(atual.ultimaAtividade).getTime() : 0;
    if (!atual || agora - ultimo < BATIMENTO_MIN_MS) return { readAt: new Date(agora).toISOString(), registered: false };
    await store.registrarAtividade(ex, tarotId, new Date(agora).toISOString());
    return { readAt: new Date(agora).toISOString(), registered: true };
  });
}

module.exports = { ler, mudarStatus, confirmar, pedirConfirmacao, registrarBatimento, carregar, perfilInicial, publico, REVISAO_VAZIA };
