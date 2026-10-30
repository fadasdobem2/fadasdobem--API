'use strict';

/**
 * Emissão de token RTC Agora para o utilizador autenticado (cliente ou tarólogo)
 * de uma sessão VOZ/VIDEO, com validação de titularidade, canal e UID, além da
 * política de mídia que o front deve aplicar no SDK.
 */
const { Session, Client, Specialist } = require('../../models');
const AppError = require('../../utils/AppError');
const agoraClient = require('../../providers/agora/agora.client');
const {
  clampExpires,
  parseUidFlexible,
  maskTokenPreview,
  mediaPolicyForModality,
} = require('./sessions.shared');

/** @param {{ role?: string, expiresInSeconds?: number|string }} opts */
async function getRtcTokenForAuthenticatedUser(sessionId, authenticatedUserId, opts = {}) {
  const sid = `${sessionId || ''}`.trim();
  const session = sid ? await Session.findByPk(sid, { paranoid: true }) : null;

  if (!session) {
    throw new AppError('Sessão não encontrada.', 404, null, true);
  }

  const modalityUp = `${session.modality || ''}`.trim().toUpperCase();
  const providUp = `${session.telecom_provider || ''}`.trim().toUpperCase();

  if (providUp !== 'AGORA') {
    /**
     * Após a desativação do módulo telecom (Intelbras/WideVoice), todas as sessões com motor
     * de tempo real correm em Agora.io. Sessões antigas com `telecom_provider != 'AGORA'`
     * não conseguem mais emitir token — devem ser revistas via dashboard.
     */
    throw new AppError(
      'Esta sessão não está configurada para Agora RTC. Modalidades VOZ e VIDEO novas usam Agora.io exclusivamente.',
      400,
      { code: 'SESSION_NOT_AGORA' },
      true
    );
  }

  const [clientProf, specialistProf] = await Promise.all([
    Client.findOne({
      where: { id: session.client_id },
      attributes: ['id', 'user_id'],
      paranoid: true,
    }),
    Specialist.findOne({
      where: { id: session.specialist_id },
      attributes: ['id', 'user_id'],
      paranoid: true,
    }),
  ]);

  if (!clientProf?.user_id || !specialistProf?.user_id) {
    throw new AppError('Não foi possível resolver usuários ligados à sessão.', 500, null, true);
  }

  const uidRequester = authenticatedUserId;
  if (clientProf.user_id !== uidRequester && specialistProf.user_id !== uidRequester) {
    throw new AppError('Acesso não autorizado a esta sessão.', 403, null, true);
  }

  const channelRaw =
    `${session.provider_channel_id || ''}`.trim() || `${session.agora_channel_id || ''}`.trim();
  if (!channelRaw) {
    throw new AppError(
      'Canal não definido (provider_channel_id ou agora_channel_id legado).',
      400,
      null,
      true
    );
  }

  const rawUidStored =
    clientProf.user_id === uidRequester ? session.agora_uid_client : session.agora_uid_specialist;
  const rtcUidNum = parseUidFlexible(rawUidStored);
  if (rtcUidNum === null) {
    throw new AppError(
      'UID Agora não atribuído para o seu papel (agora_uid_*).',
      400,
      null,
      true
    );
  }

  /**
   * Consulta 1-a-1: cliente e especialista precisam de áudio (e normalmente vídeo).
   * O token RTC usa sempre `RtcRole.PUBLISHER` para ambos; `role` na query é legado e ignorado.
   */
  const roleWant = `${opts.role || ''}`.toLowerCase();
  if (roleWant === 'audience' || roleWant === 'subscriber') {
    console.log(
      '[Agora:RTC] aviso: query `role=audience|subscriber` ignorada — consulta 1-a-1 usa sempre publisher.'
    );
  }
  const rtcRole = 'publisher';

  const expiresSecs = clampExpires(opts.expiresInSeconds);

  let pack;
  try {
    pack = agoraClient.generateRtcToken(channelRaw, rtcUidNum, rtcRole, expiresSecs);
  } catch (e) {
    const code =
      typeof e.statusCode === 'number' ? e.statusCode : e.code === 'AGORA_RTC_CONFIG_MISSING' ? 503 : 502;
    throw new AppError(
      typeof e.message === 'string' && e.message.trim() ? e.message : 'Falha ao gerar token Agora.',
      code >= 400 && code < 600 ? code : 502,
      null,
      true
    );
  }

  const appId = `${process.env.AGORA_APP_ID || ''}`.trim();
  const mediaPolicy = mediaPolicyForModality(modalityUp);
  console.log('[Agora:RTC] token emitido', {
    sessionId: sid,
    channel: channelRaw,
    rtcRole,
    uid: rtcUidNum,
    expiresSecs,
    appIdPreview: appId ? `${appId.slice(0, 8)}…` : null,
    tokenPreview: maskTokenPreview(pack.token),
    modality: modalityUp,
    media_policy: mediaPolicy,
  });
  return {
    token: pack.token,
    /** Canal Agora (`cname`) — preferível no front Renan */
    channel_name: pack.channelName,
    channelName: pack.channelName,
    uid: pack.uid,
    app_id: appId,
    appId,
    expires_at_unix: pack.expiresAtUnix,
    expiresAtUnix: pack.expiresAtUnix,
    /** Sempre `publisher` (1-a-1) — mesmo UID do cliente ou da taróloga conforme quem pede o token */
    role: rtcRole,
    roleUsed: rtcRole,
    telecom_status: session.telecom_status,
    telecomStatus: session.telecom_status,
    modality: modalityUp,
    /**
     * Política de mídia que a UI deve aplicar no SDK Agora:
     *  - `audio: 'forced_on'` → mic obrigatório, sem botão de mute lógico (ou mute apenas visual).
     *  - `video: 'forced_on'` (VIDEO) → câmara obrigatória, sem botão para desligar vídeo.
     *  - `video: 'disabled'` (VOZ)   → não pedir câmara ao browser; não criar `localVideoTrack`.
     */
    media_policy: mediaPolicy,
    mediaPolicy,
  };
}

module.exports = { getRtcTokenForAuthenticatedUser };
