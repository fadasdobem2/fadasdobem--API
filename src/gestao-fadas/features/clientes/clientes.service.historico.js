'use strict';

/** Históricos da cliente e ampliação do histórico (R25) (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */

const { lendo } = require('../../_comum/legado');
const { lendoNovo } = require('../../novo/leitura');
const model = require('./clientes.model');
const { ampliarHistorico: ampliar } = require('./helpers/ampliacao');
const { lerHistorias } = require('./clientes.service.historias');
const novo = require('./cliente-novo');
const novas = require('./cliente-novo.leitura');

const SEM_RECEBIMENTOS = { informed: [], confirmed: [], notFound: [] };
/** Cliente da faixa nova: o legado não tem história dela (consulta nem recebimento); a leitura é a mesma regra, sobre nada. */
const daFaixaNova = (clientId) => novas.ativa() && novo.ehIdDaFaixaNova(`${clientId}`);

async function existe(m, clientId) {
  return (await m.LegadoUsuario.findAll({ attributes: ['id'], where: { nivel: 0, id: Number(clientId) }, raw: true })).length > 0;
}

/**
 * Se o ID é de uma cliente (nivel = 0). Para a ampliação do histórico, que nomeia uma e não lê mais nada (R25).
 * ID da faixa nova (>= 1.000.000.000) é de cliente criada pela Lilly no banco novo (`gf_clientes_novos`); o legado nem é consultado.
 */
function clienteExiste(clientId) {
  if (novo.ehIdDaFaixaNova(`${clientId}`)) return novo.clienteNovoExiste(clientId);
  return lendo((m) => existe(m, clientId));
}

/** Histórico de consultas da cliente no alcance do perfil; null se o ID não é cliente. */
async function historicoDeConsultas({ role, expanded, clientId, nowLocal, query }) {
  if (daFaixaNova(clientId)) {
    if (!await novo.clienteNovoExiste(clientId)) return null;
    return model.buildRealClientConsultationHistory({ role, expanded, nowLocal, clientId, rows: [], query });
  }
  return lendo(async (m) => {
    if (!await existe(m, clientId)) return null;
    const historia = await lerHistorias(m, [clientId], { consultas: true, recebimentos: false });
    return model.buildRealClientConsultationHistory({ role, expanded, nowLocal, clientId, rows: historia.consultations, query });
  });
}

/** Histórico de recebimentos da cliente (gêmeos conciliados pelo ID, R20); null se o ID não é cliente. */
async function historicoDeRecebimentos({ role, expanded, clientId, query }) {
  if (daFaixaNova(clientId)) {
    if (!await novo.clienteNovoExiste(clientId)) return null;
    return model.buildRealClientReceiptHistory({ role, expanded, clientId, sources: SEM_RECEBIMENTOS, query });
  }
  return lendo(async (m) => {
    if (!await existe(m, clientId)) return null;
    const historia = await lerHistorias(m, [clientId], { consultas: false, recebimentos: true });
    return model.buildRealClientReceiptHistory({ role, expanded, clientId, sources: historia.receipts, query });
  });
}

/**
 * O alcance pedido ao histórico: sem `grant`, o do perfil (false); com ele, o completo (true) se a linha lida pelo `id` em
 * gf_auditoria é uma ampliação desta cliente pela mesma conta, função e sessão de agora (R25). Qualquer outra, de sessão
 * encerrada ou mandada por outro perfil inclusive, é null, e a rota recusa com o motivo `scope` (403).
 * Só LÊ gf_auditoria. `contexto` = { clientId, actor: { accountId, role }, sessionId }.
 */
async function ampliacaoValida(contexto, grant) {
  if (grant === undefined) return false;
  // Sem identificador de sessão não há como provar que a liberação é desta sessão: recusa (ver decisões pendentes).
  if (!contexto.sessionId) return null;
  return lendoNovo(async (m) => {
    const linha = await m.GfAuditoria.findOne({ where: { id: grant }, raw: true });
    if (!linha) return null;
    let depois = null;
    // MySQL guarda texto; o Postgres (jsonb) já devolve o objeto.
    try { depois = typeof linha.depois === 'string' ? JSON.parse(linha.depois) : (linha.depois ?? null); } catch { depois = null; }
    const entrada = {
      id: linha.id, action: linha.acao, entity: linha.entidade, entityId: linha.entidade_id,
      actorUserId: linha.ator_conta_id, actorRole: linha.ator_funcao, after: depois, reason: linha.motivo,
    };
    return model.isRealClientHistoryGrantFor(entrada, contexto) ? true : null;
  });
}

/** Ampliação do histórico (R25): a regra e a gravação ficam em helpers/ampliacao.js; aqui entra só a leitura da existência. */
const ampliarHistorico = (contexto, corpo, dependencias = {}) => ampliar(contexto, corpo, { clienteExiste, ...dependencias });

module.exports = {
  ampliacaoValida,
  ampliarHistorico,
  clienteExiste,
  historicoDeConsultas,
  historicoDeRecebimentos,
};
