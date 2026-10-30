'use strict';

/**
 * Política do comando `/lancar_pagamento` (crédito manual por atendimento):
 *  - só agente humano (sender.type = user) cujo id esteja em CHATWOOT_LANCAR_PAGAMENTO_AGENT_IDS (vazio = ninguém);
 *  - valor livre: positivo, no máximo 2 casas, teto por lançamento e teto diário por agente;
 *  - idempotência por (conta, conversa, mensagem): a mesma mensagem nunca lança duas vezes;
 *  - auditoria em audit_logs (tentativa negada e lançamento concluído), sem texto livre nem dados pessoais.
 */

const guard = require('./webhook.guard');

const TETO_PADRAO_BRL = 500;
const TETO_DIARIO_PADRAO_BRL = 2000;
const TTL_IDEMPOTENCIA_S = 60 * 60 * 24 * 7;
const TTL_DIA_S = 60 * 60 * 24;

/** Auditoria injetável para teste. */
let auditoria = null;
function _setAuditoriaParaTeste(fn) {
  auditoria = fn;
}
async function gravarAuditoria(params) {
  try {
    const fn =
      auditoria ||
      // eslint-disable-next-line global-require
      require('../admin/helpers/adminAudit.helper').persistAdminAuditLog;
    await fn(params);
  } catch (err) {
    // Falha de auditoria não pode derrubar nem vazar dados: só o aviso, sem corpo.
    console.error('[chatwoot:lancar] falha ao gravar audit_logs:', err?.message || 'erro');
  }
}

function agentesPermitidos() {
  return `${process.env.CHATWOOT_LANCAR_PAGAMENTO_AGENT_IDS || ''}`
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function tetoPorLancamento() {
  const n = Number(`${process.env.CHATWOOT_LANCAR_PAGAMENTO_MAX_BRL || ''}`.trim());
  return Number.isFinite(n) && n > 0 ? n : TETO_PADRAO_BRL;
}

function tetoDiario() {
  const n = Number(`${process.env.CHATWOOT_LANCAR_PAGAMENTO_DAILY_MAX_BRL || ''}`.trim());
  return Number.isFinite(n) && n > 0 ? n : TETO_DIARIO_PADRAO_BRL;
}

/** Extrai quem escreveu e o id da mensagem a partir do payload do Chatwoot (já autenticado). */
function extrairContexto(parsed) {
  const msg = parsed?.message || parsed || {};
  const sender = parsed?.sender || msg?.sender || {};
  const idMsg = parsed?.id ?? msg?.id;
  return {
    messageId: idMsg != null && idMsg !== '' ? String(idMsg) : null,
    senderId: sender?.id != null && sender.id !== '' ? String(sender.id) : null,
    senderType: `${sender?.type || ''}`.trim().toLowerCase(),
  };
}

/** @returns {{ok:true}|{ok:false,motivo:string,nota:string}} */
function autorizarRemetente(ctx) {
  if (ctx?.senderType !== 'user' || !ctx?.senderId) {
    return { ok: false, motivo: 'remetente_nao_humano', nota: 'Comando restrito a atendentes autorizados.' };
  }
  const lista = agentesPermitidos();
  if (!lista.length || !lista.includes(ctx.senderId)) {
    return { ok: false, motivo: 'agente_nao_autorizado', nota: 'Comando restrito a atendentes autorizados.' };
  }
  if (!ctx.messageId) {
    return { ok: false, motivo: 'sem_message_id', nota: 'Não foi possível identificar a mensagem; lançamento recusado.' };
  }
  return { ok: true };
}

/** Valida valor livre digitado (pacote do catálogo não passa por aqui). */
function validarValorLivre(valor) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, nota: 'Valor inválido.' };
  if (Math.abs(Math.round(n * 100) / 100 - n) > 1e-9) {
    return { ok: false, nota: 'Use no máximo 2 casas decimais.' };
  }
  const teto = tetoPorLancamento();
  if (n > teto) {
    return { ok: false, nota: `Valor acima do teto por lançamento (R$ ${teto.toFixed(2).replace('.', ',')}).` };
  }
  return { ok: true };
}

function chaveIdempotencia(accountId, conversationId, messageId) {
  return `chatwoot:lancar:${accountId}:${conversationId}:${messageId}`;
}

/** true = primeira vez. */
function reivindicarMensagem(accountId, conversationId, messageId) {
  return guard.claimOnce(chaveIdempotencia(accountId, conversationId, messageId), TTL_IDEMPOTENCIA_S);
}
function liberarMensagem(accountId, conversationId, messageId) {
  return guard.releaseClaim(chaveIdempotencia(accountId, conversationId, messageId));
}

/** Reserva o valor no teto diário do agente. false = estouraria (nada fica reservado). */
async function reservarTetoDiario(senderId, valor) {
  const dia = new Date().toISOString().slice(0, 10);
  const chave = `lancar-dia:${senderId}:${dia}`;
  const total = await guard.addToCounter(chave, valor, TTL_DIA_S);
  if (total > tetoDiario() + 1e-9) {
    await guard.addToCounter(chave, -valor, TTL_DIA_S);
    return false;
  }
  return true;
}
async function devolverTetoDiario(senderId, valor) {
  const dia = new Date().toISOString().slice(0, 10);
  await guard.addToCounter(`lancar-dia:${senderId}:${dia}`, -valor, TTL_DIA_S);
}

module.exports = {
  extrairContexto,
  autorizarRemetente,
  validarValorLivre,
  reivindicarMensagem,
  liberarMensagem,
  reservarTetoDiario,
  devolverTetoDiario,
  gravarAuditoria,
  tetoPorLancamento,
  tetoDiario,
  _setAuditoriaParaTeste,
};
