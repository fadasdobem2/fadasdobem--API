'use strict';

/**
 * Serviço das ações da Lilly: junta o registro de executores, a guarda de idempotência e a conciliação.
 * Devolve `{ status, corpo }` para o controller só repassar. NUNCA executa efeito com a flag das ações desligada.
 */

const { acoesLiberadas } = require('../lilly.config');
const { obter } = require('./acoes.registro');
const { executarUmaVez } = require('./acoes.guarda');
const { conciliar } = require('./acoes.conciliacao');
const { AcaoRecusadaError } = require('./acoes.erros');

const erro = (status, code, message) => ({ status, corpo: { error: { code, message } } });
const ok = (corpo, status = 200) => ({ status, corpo });

/** `POST /lilly/actions/validate`: recusa vira 200 allowed:false (D3), nunca 5xx por falta de executor. */
async function validarAcao({ action, conversation, legacyBotRequest }) {
  const def = obter(action.kind);
  if (!def) return ok({ allowed: false, reason: 'A validação desta ação ainda não está habilitada.' });
  try {
    const r = await def.validar(action, { conversation, legacyBotRequest });
    if (!r || r.allowed !== true) return ok({ ...(r || {}), allowed: false, reason: r?.reason || 'Ação não permitida.' });
    return ok(r);
  } catch (e) {
    if (e instanceof AcaoRecusadaError) return ok({ allowed: false, reason: e.message });
    throw e;
  }
}

/** `POST /lilly/actions`: `chaveBruta` já validada pelo controller. 403 desligada; 422 sem executor ou só-Umbler. */
async function executarAcao({ chaveBruta, action }) {
  if (!acoesLiberadas()) return erro(403, 'LILLY_ACTIONS_DISABLED', 'As ações da Lilly estão desligadas.');
  const def = obter(action.kind);
  if (!def || def.soUmbler) return erro(422, 'LILLY_ACTION_UNSUPPORTED', 'Esta ação ainda não está habilitada.');
  try {
    const { resultado } = await executarUmaVez({
      chaveBruta, acao: action, transacional: def.transacional !== false, executarEfeito: (acao, ctx) => def.executar(acao, ctx),
    });
    return ok({ committed: true, result: resultado });
  } catch (e) {
    if (e && e.status && e.code) return erro(e.status, e.code, e.message);
    throw e;
  }
}

/** `GET /lilly/actions/:chave`. */
async function conciliarAcao(chaveBruta) {
  const corpo = await conciliar(chaveBruta);
  return corpo ? ok(corpo) : erro(400, 'INVALID_INPUT', 'Informe a chave de idempotência.');
}

module.exports = { validarAcao, executarAcao, conciliarAcao };
