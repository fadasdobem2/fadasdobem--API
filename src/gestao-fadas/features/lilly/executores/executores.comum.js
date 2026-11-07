'use strict';

/**
 * Peças comuns dos executores da Lilly: recusa, pedido de serviço (pseudo-`req` com a conta da Lilly), tradução dos erros dos
 * serviços da equipe, chave interna de cada operação e auditoria (`_comum/auditoria.js`, `gf_auditoria`).
 * Regra do contrato (Maturacao/59, D3/D7): recusa conhecida = 4xx (`AcaoRecusadaError`); 5xx só para falha real.
 */

const { createHash, randomUUID } = require('crypto');
const { AcaoRecusadaError } = require('../acoes/acoes.erros');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../../_comum/auditoria');
const cfg = require('./executores.config');

const recusar = (code, message, status = 422) => { throw new AcaoRecusadaError(code, message, status); };

/** Falha que NÃO deve ficar guardada como recusa (nada aconteceu e a repetição pode dar certo depois): sai 409 sem guardar. */
class AcaoNaoExecutadaError extends Error {
  constructor(code, message, status = 409) { super(message); this.name = 'AcaoNaoExecutadaError'; this.code = code; this.status = status; }
}

const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v) => (typeof v === 'string' ? v.trim() : '');
const ID_CLIENTE = /^[1-9]\d{0,9}$/;
const ehIdCliente = (v) => typeof v === 'string' && ID_CLIENTE.test(v) && Number(v) <= 2147483647;
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Chave de operação dos serviços da equipe (`^[A-Za-z0-9._:-]{8,128}$`): estável por (chave da Lilly, finalidade). A chave original da Lilly passa de 128. */
const chaveDaOperacao = (chave, finalidade) => `lilly:${finalidade}:${sha(`${chave.interna}|${finalidade}`).slice(0, 40)}`;

/** Conta de serviço configurada ou falha (409 sem guardar: configurar e repetir). */
function exigirConta() {
  const id = cfg.contaDeServico();
  if (!id) throw new AcaoNaoExecutadaError('LILLY_SERVICE_ACCOUNT_MISSING', 'A conta de serviço da Lilly não está configurada.');
  return id;
}

/** Pseudo-requisição que os serviços da equipe entendem: a Lilly age como atendimento (perfil `atendente`), nunca com perfil maior. */
function pedidoDeServico({ params = {}, body, query = {} } = {}) {
  return { user: { id: exigirConta(), nome: cfg.NOME_DO_SERVICO, role: 'ATENDENTE' }, params, query, body, accessContext: { roleIds: [] } };
}

/** Erro de serviço (`AppError`) vira recusa 4xx com a frase do front; 5xx e erros de bug seguem como estão. */
async function chamarServico(fn) {
  try { return await fn(); } catch (e) {
    const status = e && e.statusCode;
    if (Number.isInteger(status) && status >= 400 && status < 500) {
      const codigo = e.dados && e.dados.codigo ? `${e.dados.codigo}` : 'RULE_VIOLATION';
      throw new AcaoRecusadaError(`LILLY_${codigo}`, e.message || 'Ação recusada.', status);
    }
    throw e;
  }
}

/** Auditoria do efeito da Lilly (`gf_auditoria`) na transação do executor. `motivo` serve de índice de busca (ex.: `payment:<id>`). */
async function auditar(executor, chave, { acao, entidade, entidadeId, antes, depois, motivo }) {
  await executor.execute(AUDIT_INSERT, linhaDeAuditoria(
    { actorUserId: exigirConta(), actorRole: 'atendente', action: `lilly.${acao}`, entity: entidade, entityId: `${entidadeId}`.slice(0, 64), before: antes, after: depois, reason: motivo ? `${motivo}`.slice(0, 1000) : undefined },
    { id: randomUUID(), agora: Date.now(), chave: `lilly:${sha(`${chave.interna}|${acao}`).slice(0, 40)}` },
  ));
}

module.exports = { recusar, AcaoNaoExecutadaError, ehObjeto, texto, ehIdCliente, sha, chaveDaOperacao, exigirConta, pedidoDeServico, chamarServico, auditar };
