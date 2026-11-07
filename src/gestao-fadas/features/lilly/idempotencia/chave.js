'use strict';

/**
 * Chave e hash de idempotência das ações da Lilly (Maturacao/59, D5 e D6).
 *  - A chave da Lilly é `<eventId>:<sufixo>:<conversationId>` e pode passar de 128 caracteres ou trazer símbolos: guardamos a
 *    chave ORIGINAL e usamos, como chave interna, a própria (se válida) ou o sha256 dela.
 *  - O hash do corpo cobre só o que define a operação (kind, conversationId, clientId, tarologistId, payload). Status, erro,
 *    resultado e evidências mudam entre tentativas e dariam 409 numa repetição legítima.
 */

const { createHash } = require('crypto');
const { hashDoCorpo } = require('../../../novo/operacoes');

const CHAVE_VALIDA = /^[A-Za-z0-9._:-]{8,128}$/;
const ORIGINAL_MAX = 1024;

/** `{ interna, original }` ou `null` se a chave não existe ou é absurda. */
function normalizarChave(bruta) {
  if (typeof bruta !== 'string') return null;
  const original = bruta.trim();
  if (!original || original.length > ORIGINAL_MAX) return null;
  const interna = CHAVE_VALIDA.test(original) ? original : `sha256:${createHash('sha256').update(original, 'utf8').digest('hex')}`;
  return { interna, original };
}

/** O que identifica a operação, na forma que o hash estável cobre. */
function corpoDaOperacao(acao) {
  const a = acao && typeof acao === 'object' ? acao : {};
  return {
    kind: a.kind ?? null,
    conversationId: a.conversationId ?? null,
    clientId: a.clientId ?? null,
    tarologistId: a.tarologistId ?? null,
    payload: a.payload ?? null,
  };
}

const hashDaAcao = (acao) => hashDoCorpo(corpoDaOperacao(acao));

module.exports = { normalizarChave, corpoDaOperacao, hashDaAcao, CHAVE_VALIDA };
