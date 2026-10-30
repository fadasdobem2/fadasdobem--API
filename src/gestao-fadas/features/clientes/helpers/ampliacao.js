'use strict';

/**
 * Ampliação do histórico pela supervisora (R25): regra e gravação de `POST /clientes/:id/history-access`. Porta de
 * `handleClientHistoryAccess` (features/clientes/real-clients-http.server.ts) e `appendOnce` (payout-audit.ts) da B.
 */

const AppError = require('../../../../utils/AppError');
const model = require('../clientes.model');
const { permissionsFor } = require('./perfis');
const { validateHistoryAccessReason } = require('./historico');
const { saoPauloTimestamp } = require('./valores');
const { erro } = require('../clientes.validacao');

const ERRO_INDISPONIVEL = () => new AppError('Não foi possível acessar o serviço. Tente novamente.', 503, { codigo: 'SERVICE_UNAVAILABLE' });

/** O 409 de uma escrita com chave de operação: a mesma chave voltou com outro corpo (`operationKeyConflict` da B). */
const conflitoDeChave = () => new AppError(
  'Esta operação já foi registrada com outros dados. Atualize a página e confira.', 409, { codigo: 'OPERATION_KEY_CONFLICT' },
);

/** Grava a linha numa transação de `gf_*` (novo/escritor.js: Postgres por padrão), uma vez por `operation_key`. Carregada sob demanda. */
function gravarAmpliacao(fato, chave) {
  const { emTransacao } = require('../../../novo/escritor');
  const { criarAuditoria } = require('../../../_comum/auditoria');
  return emTransacao((executor) => criarAuditoria(executor).adicionarUmaVez(fato, chave));
}

/**
 * Ampliação do histórico pela supervisora (R25). Ordem da B: função (403) -> corpo (400) -> motivo (400) -> cliente existe
 * (404) -> grava em gf_auditoria -> 201 { grant: { id, clientId, grantedAt } }. A linha `clients.history.expand`
 * (entidade `cliente`, entidade_id = a cliente, depois = { sessionId }, motivo aparado) é idempotente por `operationKey`: a
 * mesma chave com a mesma liberação (conta, função, sessão, cliente e motivo) devolve a mesma sem gravar outra; qualquer
 * diferença é 409. Falha de gravação, inclusive a escrita desligada (GESTAO_FADAS_ESCRITA_ENABLED), é 503 e nenhuma liberação.
 * `contexto` = { clientId, actor: { accountId, role }, sessionId }; `corpo` = { reason, operationKey }.
 * `dependencias` (clienteExiste, gravar) existem para a verificação offline.
 *
 * DECISÃO PENDENTE (diferença em relação à B): a A não tem ID de sessão estável. Sem `contexto.sessionId` a liberação nunca
 * seria aceita pelos GET do histórico (ampliacaoValida a recusa), então a gravação é recusada com 501 em vez de poluir a auditoria.
 */
async function ampliarHistorico(contexto, corpo, dependencias = {}) {
  if (!permissionsFor(contexto.actor.role).canExpandRealClientHistory) throw erro('ACCESS_DENIED', true);
  // Corpo que não é um objeto (ausente, nulo, lista) é inválido, como no esquema estrito da B.
  const objeto = corpo !== null && typeof corpo === 'object' && !Array.isArray(corpo);
  const chaves = objeto ? Object.keys(corpo) : [];
  const chave = objeto ? corpo.operationKey : undefined;
  const corpoValido = objeto && chaves.every((k) => k === 'reason' || k === 'operationKey')
    && typeof corpo.reason === 'string'
    && typeof chave === 'string' && chave.length >= 1 && chave.length <= 64 && chave.trim() === chave;
  if (!corpoValido) throw erro('INVALID_INPUT', true);
  try {
    validateHistoryAccessReason(corpo.reason);
  } catch {
    throw erro('INVALID_INPUT', true);
  }
  const planejado = model.planRealClientHistoryGrant(contexto, corpo.reason);
  if (planejado.denied) throw erro(planejado.denied === 'input' ? 'INVALID_INPUT' : 'ACCESS_DENIED', true);
  if (!await dependencias.clienteExiste(contexto.clientId)) throw erro('CLIENT_NOT_FOUND', true);
  if (!contexto.sessionId) {
    throw new AppError('A ampliação do histórico depende de um identificador de sessão que a API ainda não expõe.', 501, { codigo: 'AMPLIACAO_HISTORICO_SEM_SESSAO' });
  }
  let entrada;
  try {
    entrada = await (dependencias.gravar || gravarAmpliacao)(planejado.fact, chave);
  } catch (_e) {
    if (process.env.GESTAO_FADAS_DEBUG === 'true') console.error('[history-access]', _e && (_e.code || _e.name), _e && _e.message);
    throw ERRO_INDISPONIVEL();
  }
  if (!model.sameRealClientHistoryGrant(entrada, planejado.fact)) throw conflitoDeChave();
  return { grant: { id: entrada.id, clientId: contexto.clientId, grantedAt: saoPauloTimestamp(new Date(entrada.createdAt)) } };
}

module.exports = { ampliarHistorico };
