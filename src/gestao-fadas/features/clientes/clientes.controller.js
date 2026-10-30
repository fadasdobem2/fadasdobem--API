'use strict';

const { responderSucesso } = require('../../../utils/response.util');
const { catchAsyncRoute } = require('../../../utils/catchAsync.util');
const model = require('./clientes.model');
const service = require('./clientes.service');
const { permissionsFor } = require('./helpers/perfis');
const { resolverPerfil } = require('../../_comum/politica-acesso');
const { contaDaRequisicao } = require('../../_comum/conta');
const { saoPauloTimestamp } = require('./helpers/valores');
const { CONSULTAS, RECEBIMENTOS, consultaDaLista, consultaDoHistorico, erro, idDaCliente } = require('./clientes.validacao');

/**
 * Ordem das verificações da B (real-clients-http.server.ts), depois do login e da permissão RBAC das rotas:
 *   1. perfil (papel da A -> perfil da B) e canReadRealClients: sem perfil = 403 ACCESS_DENIED;
 *   2. formato dos parâmetros: 400 INVALID_INPUT;
 *   3. política do perfil (planRealClientList / liberação do histórico): 403 ACCESS_DENIED com o motivo `scope`;
 *   4. leitura; ID que não é cliente: 404 CLIENT_NOT_FOUND.
 * O evento de segurança `auth.access.denied` (motivo role/scope) da B não existe na A: ver relatório.
 */

/** Perfil da B do usuário pelos papéis RBAC da A (helpers/perfis.js). */
function perfilDaRequisicao(req) {
  const perfil = resolverPerfil(req); // papel RBAC e, na falta, papel de produto (ver _comum/politica-acesso.js)
  if (!perfil || !permissionsFor(perfil).canReadRealClients) throw erro('ACCESS_DENIED');
  return perfil;
}

/**
 * Identificador da sessão para conferir a liberação do histórico (R25). DECISÃO PENDENTE: a A não expõe um ID de sessão
 * estável (o JWT de acesso é renovado); enquanto não houver, devolve null e toda `grant` é recusada com 403 (scope).
 */
const sessaoDaRequisicao = (req) => {
  const sid = req && req.jwtClaims && req.jwtClaims.sid;
  return typeof sid === 'string' && sid ? sid : null;
};

const relogio = () => {
  const agora = new Date();
  return { readAt: agora.toISOString(), nowLocal: saoPauloTimestamp(agora) };
};

/** Recorte de datas do histórico no relógio da leitura; null quando o filtro da v608 não montaria aquela combinação. */
function historicoComDatas(query, nowLocal) {
  if (!query) return null;
  const datas = model.realClientHistoryDates(query, nowLocal);
  return 'range' in datas ? { ...query, range: datas.range } : null;
}

async function historico(req, res, esquema, ler, mensagem) {
  const perfil = perfilDaRequisicao(req);
  const { readAt, nowLocal } = relogio();
  const clientId = idDaCliente(req.params.id);
  const query = historicoComDatas(consultaDoHistorico(req.query, esquema), nowLocal);
  if (clientId === null || !query) throw erro('INVALID_INPUT');
  const expanded = await service.ampliacaoValida({ clientId, actor: { accountId: contaDaRequisicao(req), role: perfil }, sessionId: sessaoDaRequisicao(req) }, query.grant);
  if (expanded === null) throw erro('ACCESS_DENIED');
  const resultado = await ler({ role: perfil, expanded, clientId, nowLocal, query });
  if (!resultado) throw erro('CLIENT_NOT_FOUND');
  return responderSucesso(res, { readAt, ...resultado }, mensagem, 200);
}

module.exports = {
  /** GET /: o recorte ou a busca do perfil, com a página do recorte inteiro. */
  listar: catchAsyncRoute(async (req, res) => {
    const perfil = perfilDaRequisicao(req);
    const { readAt, nowLocal } = relogio();
    const query = consultaDaLista(req.query);
    if (!query) throw erro('INVALID_INPUT');
    const planejado = model.planRealClientList(perfil, query, nowLocal);
    if (planejado.denied) throw erro(planejado.denied === 'input' ? 'INVALID_INPUT' : 'ACCESS_DENIED');
    return responderSucesso(res, { readAt, ...await service.listar(planejado.plan) }, 'Clientes do legado.', 200);
  }),

  /** GET /:id: a ficha com a projeção do perfil. */
  obter: catchAsyncRoute(async (req, res) => {
    const perfil = perfilDaRequisicao(req);
    const { readAt, nowLocal } = relogio();
    const clientId = idDaCliente(req.params.id);
    if (clientId === null) throw erro('INVALID_INPUT');
    const ficha = await service.obter({ role: perfil, clientId, nowLocal });
    if (!ficha) throw erro('CLIENT_NOT_FOUND');
    return responderSucesso(res, { readAt, ...ficha }, 'Cliente do legado.', 200);
  }),

  /** GET /:id/consultations: histórico de consultas no alcance do perfil. */
  consultas: catchAsyncRoute((req, res) => historico(req, res, CONSULTAS, service.historicoDeConsultas, 'Histórico de consultas da cliente.')),

  /** GET /:id/receipts: histórico de recebimentos (gêmeos conciliados pelo ID). */
  recebimentos: catchAsyncRoute((req, res) => historico(req, res, RECEBIMENTOS, service.historicoDeRecebimentos, 'Histórico de recebimentos da cliente.')),

  /** POST /:id/history-access: só a supervisora. Grava `clients.history.expand` em gf_auditoria e responde 201 { grant }. */
  ampliarHistorico: catchAsyncRoute(async (req, res) => {
    const perfil = perfilDaRequisicao(req);
    if (!permissionsFor(perfil).canExpandRealClientHistory) throw erro('ACCESS_DENIED', true);
    const clientId = idDaCliente(req.params.id);
    if (clientId === null) throw erro('INVALID_INPUT', true);
    const resultado = await service.ampliarHistorico({ clientId, actor: { accountId: contaDaRequisicao(req), role: perfil }, sessionId: sessaoDaRequisicao(req) }, req.body);
    return responderSucesso(res, resultado, 'Histórico completo liberado.', 201);
  }),
};
