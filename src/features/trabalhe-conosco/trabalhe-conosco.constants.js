'use strict';

const CATEGORIA_ORACULISTA = 'oraculista';
const CATEGORIA_OUTRAS_AREAS = 'outras_areas';

const JOB_ESTADOS = Object.freeze(['novo', 'em_analise', 'aprovado', 'reprovado', 'arquivado']);

/** Envio mais rápido que isto (ms) → quarentena antibot */
const FORM_MIN_ELAPSED_MS = 10_000;

/** Formulário aberto há mais que isto (ms) → quarentena */
const FORM_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const CV_MAX_BYTES = 5 * 1024 * 1024;
const CV_ALLOWED_EXT = new Set(['pdf', 'doc', 'docx']);

const UPLOADS_JOBS_DIR = 'job-applications';

/** Versão do aceite LGPD no formulário público */
const LGPD_CONSENT_VERSION = 'trabalhe-conosco-v1';

/** Dias até expurgo de reprovados/arquivados (LGPD) */
const RETENTION_REJECTED_DAYS = Math.max(
  30,
  parseInt(`${process.env.TC_RETENTION_REJECTED_DAYS || '180'}`, 10) || 180
);

/** Dias até expurgo de registos em quarentena antiga */
const RETENTION_QUARANTINE_DAYS = Math.max(
  30,
  parseInt(`${process.env.TC_RETENTION_QUARANTINE_DAYS || '90'}`, 10) || 90
);

module.exports = {
  CATEGORIA_ORACULISTA,
  CATEGORIA_OUTRAS_AREAS,
  JOB_ESTADOS,
  FORM_MIN_ELAPSED_MS,
  FORM_MAX_AGE_MS,
  CV_MAX_BYTES,
  CV_ALLOWED_EXT,
  UPLOADS_JOBS_DIR,
  LGPD_CONSENT_VERSION,
  RETENTION_REJECTED_DAYS,
  RETENTION_QUARANTINE_DAYS,
};
