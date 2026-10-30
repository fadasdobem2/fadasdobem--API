'use strict';

/**
 * Constantes e helpers puros (sem I/O) partilhados pelos submódulos de sessão:
 * política de mídia por modalidade, elegibilidade de avaliação, mapeamento de
 * motivos de encerramento, geração de UIDs Agora e utilitários numéricos/token.
 */
const { randomInt } = require('crypto');

const SESSION_CREATE_STATUSES = ['SCHEDULED', 'READY'];
const SESSION_MODALITIES_SET = new Set(['TEXTO', 'VOZ', 'VIDEO']);
const AGORA_MAX_UID = 2147483647;

/**
 * Política de mídia por modalidade — usada pelo cliente Renan para configurar tracks
 * (ver `getRtcTokenForAuthenticatedUser` → `media_policy` no payload).
 *
 * | Modalidade | Áudio | Vídeo |
 * | --- | --- | --- |
 * | VOZ   | `forced_on` (mic obrigatório) | `disabled` (nunca pedir câmara) |
 * | VIDEO | `forced_on` (mic obrigatório) | `forced_on` (vídeo não pode ser desligado) |
 */
const SESSION_MEDIA_POLICY = Object.freeze({
  VOZ: Object.freeze({ audio: 'forced_on', video: 'disabled' }),
  VIDEO: Object.freeze({ audio: 'forced_on', video: 'forced_on' }),
});

function mediaPolicyForModality(modality) {
  const m = `${modality || ''}`.trim().toUpperCase();
  return SESSION_MEDIA_POLICY[m] || null;
}

/** Só permite avaliar após ciclo perceptível como “fechado” ou telecom concluída. */
const REVIEW_ELIGIBLE_STATUSES = new Set([
  'ENDED',
  'NO_SHOW_CLIENT',
  'NO_SHOW_SPECIALIST',
  'CANCELLED_BY_CLIENT',
  'CANCELLED_BY_SPECIALIST',
  'CANCELLED_BY_ADMIN',
]);

function sessionAllowsClientReview(sess) {
  if (!sess) return false;
  if (sess.ended_at != null) return true;
  if (`${sess.telecom_status || ''}`.toUpperCase() === 'COMPLETED') return true;
  return REVIEW_ELIGIBLE_STATUSES.has(`${sess.status || ''}`.trim().toUpperCase());
}

/** Heurística NCS/Agora `reason` → `sessions.ended_reason_code` (PostgreSQL ENUM). */
function mapAgoraRtcReasonToEndedReason(reasonRaw) {
  const s = `${reasonRaw ?? ''}`;
  const up = s.trim().toUpperCase();
  if (!up) return 'NORMAL_COMPLETION';
  if (up.includes('NETWORK') || up.includes('CONN') || up.includes('TIMED'))
    return 'NETWORK_ERROR';
  if (up.includes('SDK') || up.includes('SERVER') || up.includes('SERVICE'))
    return 'THIRD_PARTY_SDK_ERROR';
  if (up.includes('PLATFORM') || up.includes('INTERNAL')) return 'PLATFORM_ERROR';
  if (up.includes('QUIT') || up.includes('EXIT') || up.includes('CLIENT') || up.includes('USER_LEFT'))
    return 'CLIENT_DISCONNECT';
  return 'NORMAL_COMPLETION';
}

/**
 * Dois UIDs Agora inteiros distintos (intervalo [1, 2^31-1]).
 * @returns {{ clientUid: number, specialistUid: number }}
 */
function pickDistinctAgoraUids() {
  let a;
  let b;
  do {
    a = randomInt(1, AGORA_MAX_UID);
    b = randomInt(1, AGORA_MAX_UID);
  } while (a === b);
  return { clientUid: a, specialistUid: b };
}

function maskTokenPreview(token) {
  const t = `${token || ''}`;
  if (t.length <= 12) return '(curto)';
  return `${t.slice(0, 8)}…${t.slice(-6)} (${t.length}b)`;
}

function clampExpires(seconds) {
  const n =
    typeof seconds === 'string'
      ? parseInt(seconds, 10)
      : typeof seconds === 'number'
        ? seconds
        : 3600;
  if (!Number.isFinite(n)) return 3600;
  return Math.min(Math.max(Math.trunc(n), 60), 24 * 3600);
}

function parseUidFlexible(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'bigint') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  const n = parseInt(String(raw).trim(), 10);
  return Number.isFinite(n) ? n : null;
}

/** @param {number} n */
function roundMoneySes(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.round(x * 10000) / 10000;
}

module.exports = {
  SESSION_CREATE_STATUSES,
  SESSION_MODALITIES_SET,
  AGORA_MAX_UID,
  SESSION_MEDIA_POLICY,
  mediaPolicyForModality,
  REVIEW_ELIGIBLE_STATUSES,
  sessionAllowsClientReview,
  mapAgoraRtcReasonToEndedReason,
  pickDistinctAgoraUids,
  maskTokenPreview,
  clampExpires,
  parseUidFlexible,
  roundMoneySes,
};
