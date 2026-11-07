'use strict';

/**
 * Resolução de eventos do provider 'fadas' (o próprio Gestão empurrando fatos do site). `source` é sempre 'site' e o ator é 'system':
 * quem alega origem no corpo não muda isso. O registro precisa EXISTIR e bater com o cliente/tarólogo informado (Maturacao/59, 4.5 item 8).
 * Verificador injetável (`deps.verificarSite`) para teste; o padrão confere em `gf_pagamentos` e `gf_consultas_ext`.
 */

const { EventoRecusadoError } = require('./eventos.erros');

const INTENCOES = ['site_payment_posted', 'site_consultation_ended', 'consultation_data_posted'];
const ENCERRADAS = ['Finalizada pelo tarólogo', 'Concluída'];
const COPIAR = ['paymentId', 'consultationId', 'postedMessageId', 'minutes', 'amount', 'reference'];
const texto = (v) => (v === undefined || v === null || `${v}`.trim() === '' ? null : `${v}`.trim());

const recusa = (code, msg, status = 422) => new EventoRecusadoError(code, msg, status);

async function verificarPagamento(executor, { paymentId, clientId }) {
  if (!paymentId) throw recusa('INVALID_INPUT', 'Informe o pagamento do evento.', 400);
  const [linhas] = await executor.execute('SELECT id_cliente FROM gf_pagamentos WHERE id = ?', [paymentId]);
  if (!linhas[0]) throw recusa('LILLY_EVENT_NOT_FOUND', 'O pagamento do evento não existe.');
  if (clientId && `${linhas[0].id_cliente}` !== clientId) throw recusa('LILLY_EVENT_MISMATCH', 'O pagamento não é deste cliente.');
  return { clientId: `${linhas[0].id_cliente}` };
}

async function verificarConsulta(executor, { consultationId, clientId, tarologistId }, exigirEncerrada, agora) {
  if (!consultationId) throw recusa('INVALID_INPUT', 'Informe a consulta do evento.', 400);
  const [linhas] = await executor.execute('SELECT id_cliente, id_tarologo, status, encerrada_em FROM gf_consultas_ext WHERE id = ?', [consultationId]);
  const c = linhas[0];
  if (!c) throw recusa('LILLY_EVENT_NOT_FOUND', 'A consulta do evento não existe.');
  if ((clientId && `${c.id_cliente}` !== clientId) || (tarologistId && `${c.id_tarologo}` !== tarologistId)) throw recusa('LILLY_EVENT_MISMATCH', 'A consulta não é desta cliente ou deste tarólogo.');
  const fim = c.encerrada_em ? new Date(c.encerrada_em) : null;
  if (exigirEncerrada) {
    if (!ENCERRADAS.includes(c.status) || !fim) throw recusa('LILLY_EVENT_STATE', 'A consulta ainda não foi encerrada.');
    if (fim.getTime() > agora.getTime()) throw recusa('LILLY_EVENT_STATE', 'O encerramento da consulta está no futuro.');
  }
  return { clientId: `${c.id_cliente}`, tarologistId: `${c.id_tarologo}`, ...(fim ? { endedAt: fim.toISOString() } : {}) };
}

/** Confere o registro no Gestão e devolve o que o BACKEND sabe (clientId, tarologistId, endedAt). */
async function verificarSitePadrao(intent, dados, { executor, agora = new Date() }) {
  if (intent === 'site_payment_posted') return verificarPagamento(executor, dados);
  return verificarConsulta(executor, dados, intent === 'site_consultation_ended', agora);
}

async function resolverSite(event, { executor, verificarSite = verificarSitePadrao, agora = new Date() }) {
  const id = texto(event.id ?? event.eventId);
  const d = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {};
  const intent = d.intent;
  if (!id) throw recusa('INVALID_INPUT', 'Evento do site sem id.', 400);
  if (!INTENCOES.includes(intent)) throw recusa('INVALID_INPUT', 'Intenção de evento do site desconhecida.', 400);
  const at = event.at && !Number.isNaN(Date.parse(event.at)) ? new Date(event.at).toISOString() : null;
  if (!at) throw recusa('INVALID_INPUT', 'Evento do site sem instante válido.', 400);
  const dados = { paymentId: texto(d.paymentId), consultationId: texto(d.consultationId), clientId: texto(event.clientId), tarologistId: texto(event.tarologistId) };
  const saber = await verificarSite(intent, dados, { executor, agora });
  const data = { intent, staffAuthorized: false };
  for (const k of COPIAR) if (d[k] !== undefined) data[k] = d[k];
  if (saber.endedAt) data.endedAt = saber.endedAt;
  return {
    id: `site:${id}`, at, type: 'message', source: 'site', conversationId: texto(event.conversationId), contactId: null,
    actor: 'system', internal: false, clientId: saber.clientId || dados.clientId, tarologistId: saber.tarologistId || dados.tarologistId, text: '', data,
  };
}

module.exports = { resolverSite, verificarSitePadrao, INTENCOES };
