'use strict';

/**
 * Restrições cliente x taróloga (Maturacao/29 seção 10). Uma linha por restrição (`gf_restricoes`), com a história embutida (só cresce) e um
 * índice único parcial: UMA restrição ativa por (cliente, taróloga, quem pediu).
 *   - leitura: a equipe lê todas; a taróloga só as DELA pedidas por ela (`restrictionsVisibleTo`, restriction-model.ts);
 *   - gravação (`PUT /restrictions/:id`): a equipe cria, edita e remove (`canManageConsultations`); a taróloga só REMOVE a própria
 *     ("Para incluir ou alterar uma restrição, comunique ao atendimento"). O servidor confere a sequência da história, o que não muda
 *     (cliente, taróloga, quem pediu), carimba autor e instante dos eventos manuais e valida a queixa que originou a restrição contra a consulta;
 *   - idempotência `operationKey`, revisão `expectedVersion` (0 = nova; 409 `VERSION_CHANGED`), auditoria e `gf_operacoes` na MESMA transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/restricoes');
const f = require('./fin.comum');

const ACOES = ['created', 'edited', 'removed'];
const comoItem = (l) => ({ ...f.textoDe(l), id: l.id });
let verificarCliente = async (id) => require('../clientes/clientes.service').clienteExiste(id);
const definirVerificadorDeCliente = (fn) => { verificarCliente = fn; };
const igual = f.igual;

function forma(r) {
  if (!f.ehObjeto(r)) throw f.invalido('record');
  f.idRegistro(r.id, 'record.id'); f.idCliente(r.clientId, 'record.clientId'); f.idRegistro(r.tarotId, 'record.tarotId');
  if (r.requestedBy !== undefined && !['client', 'tarologist'].includes(r.requestedBy)) throw f.invalido('record.requestedBy');
  if (typeof r.reason !== 'string' || r.reason.length > 1000) throw f.regra('Use até 1.000 caracteres no motivo.');
  if (typeof r.active !== 'boolean') throw f.invalido('record.active');
  f.instante(r.createdAt, 'record.createdAt'); f.instante(r.updatedAt, 'record.updatedAt');
  if (!Array.isArray(r.history) || !r.history.length || r.history.length > 500) throw f.invalido('record.history');
  for (const e of r.history) {
    if (!f.ehObjeto(e) || !ACOES.includes(e.action) || typeof e.actor !== 'string' || !e.actor.trim() || typeof e.reason !== 'string' || e.reason.length > 1000) throw f.invalido('record.history');
    f.instante(e.at, 'record.history.at');
  }
  if (r.complaintConsultationIds !== undefined && (!Array.isArray(r.complaintConsultationIds) || r.complaintConsultationIds.length > 200 || r.complaintConsultationIds.some((x) => typeof x !== 'string' || !x))) throw f.invalido('record.complaintConsultationIds');
  return r;
}

/** `GET /restrictions`: equipe lê tudo; a taróloga só as dela pedidas por ela. */
async function ler(req) {
  const a = f.ator(req, { permissao: 'canViewConsultations', aceitaTarologa: true });
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfRestricoes.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] }));
  const todas = dom.visiveisPara(linhas.map(comoItem), a.perfil, a.proprio);
  const versoes = Object.fromEntries(linhas.filter((l) => todas.some((t) => t.id === l.id)).map((l) => [l.id, Number(l.version)]));
  return { readAt: new Date().toISOString(), items: todas, versions: versoes };
}

/** Eventos novos: carimba autor e instante dos manuais; os que nascem da queixa trazem o autor e o instante da consulta. */
function carimbar(antes, pedido, a, agora, queixaNova) {
  const anteriores = antes ? antes.history : [];
  const novos = pedido.history.slice(anteriores.length).map((e) => (queixaNova ? e : { ...e, at: agora, actor: a.nome, reason: e.reason.trim() }));
  const history = [...anteriores, ...novos];
  const ultimo = history[history.length - 1];
  const ativa = ultimo.action !== 'removed';
  const motivo = ativa ? ultimo.reason : (history.slice().reverse().find((e) => e.action !== 'removed') || ultimo).reason;
  return { ...pedido, requestedBy: pedido.requestedBy ?? (antes && antes.requestedBy), active: ativa, reason: motivo, history, updatedAt: ultimo.at, updatedBy: ultimo.actor, createdAt: antes ? antes.createdAt : history[0].at, createdBy: antes ? antes.createdBy : history[0].actor };
}

/** Sequência válida da história: `created`, depois `edited` enquanto ativa, e `removed` encerra. */
function conferirSequencia(antes, pedido) {
  const anteriores = antes ? antes.history : [];
  if (pedido.history.length < anteriores.length || !igual(pedido.history.slice(0, anteriores.length), anteriores)) throw f.regra('O histórico da restrição não pode ser apagado.');
  if (pedido.history.length === anteriores.length && antes) return;
  let ativa = antes ? antes.active : false; let primeira = !antes;
  for (const e of pedido.history.slice(anteriores.length)) {
    if (primeira) { if (e.action !== 'created') throw f.regra('Não foi possível identificar esta alteração.'); primeira = false; ativa = true; continue; }
    if (!ativa) throw f.regra('Esta restrição já foi removida.');
    if (e.action === 'created') throw f.regra('Não foi possível identificar esta alteração.');
    if (e.action === 'removed') ativa = false;
  }
}

async function conferirQueixas(ex, antes, pedido) {
  const anteriores = new Set(antes ? antes.complaintConsultationIds || [] : []);
  const novas = (pedido.complaintConsultationIds || []).filter((x) => !anteriores.has(x));
  for (const id of novas) {
    const [l] = await ex.execute("SELECT id_cliente, id_tarologo, item -> 'cancellationReview' IS NOT NULL AS tem FROM gf_consultas_ext WHERE id = ?", [id]);
    if (!l[0] || l[0].id_cliente !== pedido.clientId || l[0].id_tarologo !== pedido.tarotId || !l[0].tem) throw f.regra('Confira a consulta cancelada por reclamação.');
  }
  return novas.length > 0;
}

/** `PUT /restrictions/:id`: `{ operationKey, expectedVersion, record }`. */
async function gravar(req) {
  const a = f.ator(req, { permissao: 'canManageConsultations', escrita: true, aceitaTarologa: true });
  const id = f.idRegistro(req.params.id);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  const pedido = forma(b.record);
  if (pedido.id !== id) throw f.invalido('record.id');
  const quem = pedido.requestedBy ?? 'tarologist';
  if (expectedVersion === 0 && !(await verificarCliente(pedido.clientId))) throw new (require('../../../utils/AppError'))('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  return f.gravar(req, {
    escopo: 'restricoes.gravar', operationKey, corpo: { id, expectedVersion, record: pedido }, entidade: 'restricao', entidadeId: id, acao: 'restricoes.gravar',
    producao: async (ex) => {
      await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_restricoes:${id}`]);
      const [linhas] = await ex.execute('SELECT id, item, version FROM gf_restricoes WHERE id = ? FOR UPDATE', [id]);
      const antes = linhas[0] ? comoItem(linhas[0]) : null;
      if ((antes ? Number(linhas[0].version) : 0) !== expectedVersion) throw f.conflitoVersao('A restrição mudou. Atualize a tela e tente novamente.');
      if (antes && (antes.clientId !== pedido.clientId || antes.tarotId !== pedido.tarotId || dom.solicitante(antes) !== dom.solicitante(pedido))) throw f.regra('Não foi possível identificar esta alteração.');
      conferirSequencia(antes, pedido);
      const novos = pedido.history.slice(antes ? antes.history.length : 0);
      // Quem pode: a taróloga só remove a própria; a equipe gerencia.
      for (const e of novos) {
        if (!dom.podeGerenciar(a.perfil, a.proprio, pedido.tarotId, quem)) throw f.negado(true);
        if (a.tarologa && e.action !== 'removed') throw f.regra('Para incluir ou alterar uma restrição, comunique ao atendimento.');
      }
      const queixaNova = a.equipe && await conferirQueixas(ex, antes, pedido);
      const agora = new Date().toISOString();
      const reg = carimbar(antes, pedido, a, agora, queixaNova);
      const versao = expectedVersion + 1;
      const { id: _i, ...semId } = reg;
      if (!antes) {
        await ex.execute('INSERT INTO gf_restricoes (id, id_cliente, id_tarologo, solicitante, ativa, item, version, criado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)', [id, reg.clientId, reg.tarotId, dom.solicitante(reg), reg.active, JSON.stringify(semId), a.nome, operationKey]);
      } else {
        await ex.execute('UPDATE gf_restricoes SET ativa = ?, item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [reg.active, JSON.stringify(semId), versao, id]);
      }
      const acao = reg.history[reg.history.length - 1].action;
      return { antes: antes ? { version: expectedVersion, active: antes.active } : null, depois: { version: versao, active: reg.active, action: acao, clientId: reg.clientId, tarotId: reg.tarotId, requestedBy: dom.solicitante(reg) }, resposta: { readAt: agora, items: [reg], versions: { [id]: versao } } };
    },
  });
}

/** Todas as restrições, para o Painel (`GET /panel/sources`). */
async function paraOPainel() {
  const linhas = await lendoNovo((m) => m.GfRestricoes.findAll({ order: [['criado_em', 'ASC'], ['id', 'ASC']] }));
  return linhas.map(comoItem);
}

module.exports = { ler, gravar, paraOPainel, definirVerificadorDeCliente };
