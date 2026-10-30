'use strict';

const { DEFAULT_PROC, DEFAULT_ONB } = require('./specialist-candidates.constants');

function cloneJson(val, fallback) {
  if (val == null) return JSON.parse(JSON.stringify(fallback));
  return JSON.parse(JSON.stringify(val));
}

function formatRelativeChegou(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

function formatDateBr(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

/** Serializa registo DB → shape do mock frontend */
function toApiCandidate(row) {
  const plain = typeof row?.toJSON === 'function' ? row.toJSON() : row || {};
  return {
    id: plain.id,
    grad: plain.grad || 'g3',
    apelido: plain.apelido,
    estado: plain.estado,
    triagem: plain.estado === 'nova' ? plain.triagem || 'pendente' : undefined,
    origem: plain.origem,
    nomeCivil: plain.nome_civil || '—',
    idade: plain.idade ?? null,
    chegouEm: formatRelativeChegou(plain.chegou_em),
    chegouEmIso: plain.chegou_em,
    decididaEm: plain.decidida_em ? formatDateBr(plain.decidida_em) : undefined,
    razao: plain.razao || undefined,
    esperaDesde: plain.espera_desde ? formatRelativeChegou(plain.espera_desde) : undefined,
    esperaMotivo: plain.espera_motivo || undefined,
    esperaNota: plain.espera_nota || undefined,
    f1: cloneJson(plain.f1, {}),
    proc: cloneJson(plain.proc, DEFAULT_PROC),
    convite: plain.convite ? cloneJson(plain.convite, null) : null,
    onb: plain.onb ? cloneJson(plain.onb, null) : null,
    f2: plain.f2 ? cloneJson(plain.f2, null) : null,
    orig: plain.f2_original ? cloneJson(plain.f2_original, null) : null,
    specialistId: plain.specialist_id || null,
    userId: plain.user_id || null,
    onboardingToken: plain.onboarding_token || null,
    categoria: plain.categoria || 'oraculista',
    meta: plain.meta ? cloneJson(plain.meta, {}) : {},
    quarentena: Boolean(plain.meta?.quarentena),
  };
}

module.exports = {
  toApiCandidate,
  formatDateBr,
  cloneJson,
};
