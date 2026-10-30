'use strict';

/**
 * Webhooks de telefonia/RTC: parsing e processamento do NCS Agora (join/leave →
 * ACTIVE/COMPLETED) e do webhook legado Intelbras Wide Voice. Ambos são idempotentes
 * e delegam a transição telecom ao ciclo de vida (fila + fecho económico).
 */
const { Op } = require('sequelize');
const { Session } = require('../../models');
const { mapAgoraRtcReasonToEndedReason, parseUidFlexible } = require('./sessions.shared');
const { updateSessionTelecomAndMaybeAdvanceQueue } = require('./sessions.lifecycle');
const AppError = require('../../utils/AppError');
const { responderSucesso } = require('../../utils/response.util');
const guard = require('../chatwoot/webhook.guard');

/** Resumo seguro para logs (sem expor token ou payloads enormes). */
function summarizeNcsBodyForLog(body) {
  const { envelope, payload } = normalizeNcsEnvelopeAndPayload(body);
  const channel = extractNcsChannelName(payload, envelope);
  return {
    eventType: envelope.eventType ?? envelope.event_type ?? null,
    channelName: channel || null,
    uid: extractNcsUidRaw(payload, envelope),
    reason: payload.reason != null ? String(payload.reason).slice(0, 120) : null,
    notifyMs: typeof envelope.notifyMs === 'number' ? envelope.notifyMs : null,
    noticeId: typeof envelope.noticeId === 'string' ? envelope.noticeId.slice(0, 64) : null,
    payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload).slice(0, 16) : [],
    topKeys: envelope && typeof envelope === 'object' ? Object.keys(envelope).slice(0, 16) : [],
  };
}

/**
 * Corpo NCS pode trazer `payload` como objeto, string JSON, ou campos repetidos fora do payload.
 */
function normalizeNcsEnvelopeAndPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { envelope: {}, payload: {} };
  }
  let payload = body.payload;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    payload = {};
  }
  return { envelope: body, payload };
}

function parseNcsEventType(envelope) {
  const raw = envelope?.eventType ?? envelope?.event_type;
  let et =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? parseInt(raw, 10)
        : NaN;
  if (Number.isFinite(et)) return et;
  const nid = envelope?.noticeId;
  if (typeof nid === 'string' && nid.includes(':')) {
    const last = nid.split(':').pop();
    const p = parseInt(String(last), 10);
    if (Number.isFinite(p)) return p;
  }
  return NaN;
}

/** Canal RTC: NCS usa `channelName`; variantes comuns em integrações. */
function extractNcsChannelName(payload, envelope) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const e = envelope && typeof envelope === 'object' ? envelope : {};
  const c =
    (typeof p.channelName === 'string' && p.channelName.trim()) ||
    (typeof p.channel === 'string' && p.channel.trim()) ||
    (typeof p.cname === 'string' && p.cname.trim()) ||
    (typeof e.channelName === 'string' && e.channelName.trim()) ||
    (typeof e.channel === 'string' && e.channel.trim()) ||
    '';
  return c;
}

function extractNcsUidRaw(payload, envelope) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const e = envelope && typeof envelope === 'object' ? envelope : {};
  return p.uid ?? p.userId ?? p.account ?? e.uid ?? null;
}

/** UID após coerção numérica (RTC Agora é inteiro). */
function extractNcsUidNumeric(payload, envelope) {
  return parseUidFlexible(extractNcsUidRaw(payload, envelope));
}

function uidMatchesSession(session, numericUid) {
  if (numericUid === null) return false;
  const cu = parseUidFlexible(session.agora_uid_client);
  const su = parseUidFlexible(session.agora_uid_specialist);
  return numericUid === cu || numericUid === su;
}

function resolveWebhookTimestampSeconds(payload, envelope = {}) {
  const tsRaw = payload?.ts;
  if (typeof tsRaw === 'number' && tsRaw >= 946684800 && tsRaw < 4102444800) return tsRaw;
  const nm =
    typeof envelope?.notifyMs === 'number'
      ? envelope.notifyMs
      : typeof payload?.notifyMs === 'number'
        ? payload.notifyMs
        : null;
  if (nm !== null && Number.isFinite(nm)) return Math.floor(nm / 1000);
  return Math.floor(Date.now() / 1000);
}

async function processAgoraNcsWebhookAsync(body) {
  const summary = summarizeNcsBodyForLog(body);
  console.log('[Agora:Webhook] processando async', summary);

  const { envelope, payload } = normalizeNcsEnvelopeAndPayload(body);
  const eventType = parseNcsEventType(envelope);

  if (!Number.isFinite(eventType)) {
    console.log('[Agora:Webhook] ignorado · eventType inválido ou ausente', summary);
    return;
  }

  const channel = extractNcsChannelName(payload, envelope);
  if (!channel || (eventType !== 103 && eventType !== 104)) {
    console.log('[Agora:Webhook] ignorado · fora 103/104 ou sem channel', {
      eventType,
      channel: channel || null,
      productId: envelope?.productId ?? null,
    });
    return;
  }

  const uidJoin = extractNcsUidNumeric(payload, envelope);
  if (uidJoin === null) {
    console.warn('[Agora:Webhook] uid inválido no payload', { channel, eventType, summary });
    return;
  }

  let session =
    (await Session.findOne({
      where: { provider_channel_id: channel },
      paranoid: true,
      order: [['updated_at', 'DESC']],
    })) ||
    (await Session.findOne({
      where: { agora_channel_id: channel },
      paranoid: true,
      order: [['updated_at', 'DESC']],
    }));

  if (!session) {
    console.warn('[Agora:Webhook] nenhuma Session na BD para o canal', { channel, eventType, uidJoin });
    return;
  }

  const tsSeconds = resolveWebhookTimestampSeconds(payload, envelope || {});

  if (!uidMatchesSession(session, uidJoin)) {
    console.warn('[Agora:Webhook] uid não corresponde agora_uid_client/specialist', {
      sessionId: session.id,
      channel,
      eventType,
      uidJoin,
    });
    return;
  }

  if (eventType === 103) {
    const wasStarted = Boolean(session.started_at);
    await session.update({
      telecom_status: 'ACTIVE',
      started_at: session.started_at || new Date(tsSeconds * 1000),
    });
    console.log('[Agora:Webhook] User Joined (103) → ACTIVE', {
      sessionId: session.id,
      channel,
      uidJoin,
      tsSeconds,
      started_at_preexistente: wasStarted,
    });
    return;
  }

  if (`${session.telecom_status || ''}`.toUpperCase() === 'COMPLETED') {
    console.log('[Agora:Webhook] User Left ignorado · sessão já COMPLETED', {
      sessionId: session.id,
      channel,
    });
    return;
  }

  const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
  const startedSec = Number.isFinite(startedMs) ? Math.floor(startedMs / 1000) : null;
  const durationCalc = startedSec !== null ? Math.max(0, tsSeconds - startedSec) : null;

  await updateSessionTelecomAndMaybeAdvanceQueue(session, {
    telecom_status: 'COMPLETED',
    ended_at: new Date(tsSeconds * 1000),
    rtc_duration_seconds: typeof durationCalc === 'number' ? Math.trunc(durationCalc) : null,
    rtc_end_reason:
      payload.reason !== undefined && payload.reason !== null ? String(payload.reason) : null,
    ended_reason_code: mapAgoraRtcReasonToEndedReason(payload.reason),
  });

  console.log('[Agora:Webhook] User Left (104) → COMPLETED', {
    sessionId: session.id,
    channel,
    uidJoin,
    tsSeconds,
    rtc_duration_seconds: typeof durationCalc === 'number' ? Math.trunc(durationCalc) : null,
    rtc_end_reason:
      payload.reason !== undefined && payload.reason !== null ? String(payload.reason).slice(0, 120) : null,
  });
}

function normIntelbrasStr(v) {
  return `${v ?? ''}`.trim();
}

function parseIntelbrasWebhookDate(raw) {
  const s = normIntelbrasStr(raw);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseDuracaoSeconds(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.trunc(raw));
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? Math.max(0, n) : null;
}

function mapIntelbrasCausaToEndedReason(causa) {
  const c = `${causa ?? ''}`.trim().toUpperCase();
  if (!c) return 'UNKNOWN';
  if (c.includes('NORMAL')) return 'NORMAL_COMPLETION';
  if (c.includes('USER') || c.includes('BUSY') || c.includes('NO ANSWER') || c.includes('CANCEL'))
    return 'CLIENT_DISCONNECT';
  return 'UNKNOWN';
}

/**
 * @param {Record<string, unknown>} event
 */
async function findSessionForIntelbrasWebhook(event) {
  const ids = [
    normIntelbrasStr(event.UniqueId ?? event.uniqueId),
    normIntelbrasStr(event.UniqueId2 ?? event.uniqueId2),
  ].filter(Boolean);
  for (const uid of ids) {
    const row = await Session.findOne({
      where: {
        telecom_provider: 'INTELBRAS',
        [Op.or]: [{ intelbras_unique_id: uid }, { intelbras_call_id: uid }],
      },
      paranoid: true,
      order: [['updated_at', 'DESC']],
    });
    if (row) return row;
  }
  return null;
}

/**
 * Webhook Intelbras Wide Voice — configurar URL pública no painel da central.
 * Processar de forma assíncrona após HTTP 200 imediato (igual NCS Agora).
 *
 * @param {Record<string, unknown>} event
 */
async function processIntelbrasTelephonyWebhookAsync(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return;

  const tipo = normIntelbrasStr(event.Evento ?? event.evento).toUpperCase();
  const st = normIntelbrasStr(event.Status ?? event.status).toUpperCase();

  const isAnswered =
    tipo === 'BRIDGE' || tipo === 'ANSWERED' || st === 'ANSWERED';

  const isHangup = tipo === 'HANGUP' || st === 'HANGUP';

  if (!isAnswered && !isHangup) {
    console.log('[Intelbras:Webhook] evento ignorado', { tipo: tipo || null, status: st || null });
    return;
  }

  const session = await findSessionForIntelbrasWebhook(event);
  if (!session) {
    console.warn('[Intelbras:Webhook] sessão não encontrada para UniqueId(s)', {
      UniqueId: event.UniqueId ?? null,
      UniqueId2: event.UniqueId2 ?? null,
    });
    return;
  }

  if (isAnswered) {
    if (`${session.telecom_status || ''}`.toUpperCase() === 'COMPLETED') return;

    const atend =
      parseIntelbrasWebhookDate(event.DataHoraAtendimento ?? event.DataHora) ||
      (session.started_at ? new Date(session.started_at) : null) ||
      new Date();

    const uidPrimary = normIntelbrasStr(event.UniqueId ?? event.uniqueId);

    await session.update({
      telecom_status: 'ACTIVE',
      started_at: session.started_at || atend,
      intelbras_unique_id: uidPrimary || session.intelbras_unique_id,
    });

    console.log('[Intelbras:Webhook] atendimento → ACTIVE', {
      sessionId: session.id,
      uniqueId: uidPrimary || null,
    });
    return;
  }

  if (isHangup) {
    if (session.ended_at) return;

    const endedAt = parseIntelbrasWebhookDate(event.DataHoraFim) || new Date();
    let durationSec = parseDuracaoSeconds(
      event.Duracao != null ? event.Duracao : event.duracao
    );
    const startedMs = session.started_at ? new Date(session.started_at).getTime() : NaN;
    if (durationSec === null && Number.isFinite(startedMs)) {
      durationSec = Math.max(0, Math.floor((endedAt.getTime() - startedMs) / 1000));
    }

    await updateSessionTelecomAndMaybeAdvanceQueue(session, {
      telecom_status: 'COMPLETED',
      ended_at: endedAt,
      rtc_duration_seconds: durationSec,
      rtc_end_reason: event.Causa != null ? String(event.Causa) : null,
      ended_reason_code: mapIntelbrasCausaToEndedReason(event.Causa),
    });

    console.log('[Intelbras:Webhook] Hangup → COMPLETED', {
      sessionId: session.id,
      rtc_duration_seconds: durationSec,
    });
  }
}

/**
 * Autenticação do webhook NCS do Agora (fail closed).
 * Esquema oficial: cabeçalho `Agora-Signature-V2` = HMAC-SHA256 (hex) do corpo bruto com o segredo do NCS
 * (AGORA_NCS_SECRET). Sem segredo configurado a rota responde 503; AGORA_NCS_VERIFY_DISABLED=true só vale fora de produção.
 * Replay: `notifyMs` fora da janela (AGORA_NCS_TOLERANCE_S, padrão 300) é recusado e `noticeId` repetido é ignorado
 * (resposta 200 para o Agora parar de reenviar).
 */
async function verifyAgoraSignature(req, res, next) {
  try {
    if (guard.bypassPermitido('AGORA_NCS_VERIFY_DISABLED')) {
      console.warn('[Agora:Webhook] verificação de assinatura DESLIGADA (somente dev/teste).');
      return next();
    }
    const segredo = `${process.env.AGORA_NCS_SECRET || ''}`.trim();
    if (!segredo) {
      console.error('[Agora:Webhook] AGORA_NCS_SECRET ausente: webhook bloqueado.');
      return next(new AppError('Webhook Agora não configurado.', 503, null, true));
    }
    const recusar = (motivo) => {
      console.warn(`[Agora:Webhook] recusado (${motivo})`);
      return next(new AppError('Webhook não autorizado.', 401, null, true));
    };

    const enviada = `${req.get('agora-signature-v2') || ''}`.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(enviada)) return recusar('assinatura ausente ou malformada');
    const esperada = guard.hmacHex('sha256', segredo, guard.getRawBody(req));
    if (!guard.safeEqual(esperada, enviada)) return recusar('assinatura invalida');

    const tolerancia = guard.envInt('AGORA_NCS_TOLERANCE_S', 300);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (typeof body.notifyMs === 'number' && Number.isFinite(body.notifyMs)) {
      if (Math.abs(Date.now() - body.notifyMs) > tolerancia * 1000) return recusar('notifyMs fora da janela');
    }
    const noticeId = typeof body.noticeId === 'string' && body.noticeId ? body.noticeId.slice(0, 128) : enviada;
    if (!(await guard.claimOnce(`agora:notice:${noticeId}`, 60 * 60 * 24))) {
      return responderSucesso(res, { aceito: true, duplicado: true }, 'Webhook NCS já processado.', 200);
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  verifyAgoraSignature,
  summarizeNcsBodyForLog,
  processAgoraNcsWebhookAsync,
  processIntelbrasTelephonyWebhookAsync,
};
