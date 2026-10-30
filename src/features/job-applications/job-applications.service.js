'use strict';

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { JobApplication, sequelize } = require('../../models');
const AppError = require('../../utils/AppError');
const { normalizeEmail } = require('../auth/auth.constants');
const {
  CV_MAX_BYTES,
  CV_ALLOWED_EXT,
  UPLOADS_JOBS_DIR,
  CATEGORIA_OUTRAS_AREAS,
  JOB_ESTADOS,
} = require('../trabalhe-conosco/trabalhe-conosco.constants');
const { evaluateAntibot, publicSuccessMessage } = require('../trabalhe-conosco/trabalhe-conosco.antibot');
const { validateJobApplication } = require('../trabalhe-conosco/trabalhe-conosco.validation');
const { buildLgpdMeta, isLgpdConsentGiven } = require('../trabalhe-conosco/trabalhe-conosco.lgpd');
const { assertTrabalheConoscoEmail } = require('../trabalhe-conosco/trabalhe-conosco.email');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', UPLOADS_JOBS_DIR);

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function persistCurriculo(applicationId, curriculo = {}) {
  const base64Raw = curriculo.base64 || curriculo.file_base64 || curriculo.content_base64;
  const url = `${curriculo.url || curriculo.file_url || ''}`.trim();

  if (url) {
    return { curriculo_url: url, curriculo_nome: curriculo.file_name || curriculo.filename || null };
  }

  if (!base64Raw) {
    return { curriculo_url: null, curriculo_nome: null };
  }

  const ext = `${curriculo.ext || 'pdf'}`.replace(/^\./, '').toLowerCase();
  if (!CV_ALLOWED_EXT.has(ext)) {
    throw new AppError('Formato de currículo inválido — use PDF, DOC ou DOCX.', 400, null, true);
  }

  const buf = Buffer.from(`${base64Raw}`, 'base64');
  if (!buf.length) throw new AppError('Currículo inválido.', 400, null, true);
  if (buf.length > CV_MAX_BYTES) {
    throw new AppError('Currículo excede 5 MB.', 400, null, true);
  }

  ensureUploadsDir();
  const fname =
    `${curriculo.file_name || curriculo.filename || ''}`.trim() ||
    `cv_${applicationId.slice(0, 8)}_${Date.now()}.${ext}`;
  const safeName = fname.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.writeFileSync(path.join(UPLOADS_DIR, safeName), buf);

  return {
    curriculo_url: `/uploads/${UPLOADS_JOBS_DIR}/${safeName}`,
    curriculo_nome: safeName,
  };
}

async function assertJobEmailAvailable(email) {
  const mail = normalizeEmail(email);
  const dup = await JobApplication.findOne({
    where: {
      email: mail,
      estado: { [Op.notIn]: ['reprovado', 'arquivado'] },
    },
    attributes: ['id'],
  });
  if (dup) {
    throw new AppError('Já existe candidatura activa com este e-mail.', 409, null, true);
  }
}

function formatRelativeChegou(date) {
  if (!date) return '—';
  const d = date instanceof Date ? date : new Date(date);
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'hoje';
  if (days === 1) return 'há 1 dia';
  return `há ${days} dias`;
}

function toApiJob(row) {
  const plain = typeof row?.toJSON === 'function' ? row.toJSON() : row || {};
  return {
    id: plain.id,
    categoria: plain.categoria,
    nomeCompleto: plain.nome_completo,
    email: plain.email,
    whatsapp: plain.whatsapp,
    cidade: plain.cidade,
    areaInteresse: plain.area_interesse || [],
    cargoDesejado: plain.cargo_desejado,
    nivel: plain.nivel,
    linkedin: plain.linkedin,
    portfolioSite: plain.portfolio_site,
    curriculoUrl: plain.curriculo_url,
    curriculoNome: plain.curriculo_nome,
    apresentacao: plain.apresentacao,
    comoChegou: plain.como_chegou,
    payload: plain.payload || {},
    meta: plain.meta || {},
    estado: plain.estado,
    chegouEm: formatRelativeChegou(plain.chegou_em),
    chegouEmIso: plain.chegou_em,
    decididaEm: plain.decidida_em,
    razao: plain.razao,
    quarentena: Boolean(plain.meta?.quarentena),
  };
}

async function submitPublicJobApplication(body = {}, httpCtx = {}) {
  const antibot = evaluateAntibot(body, httpCtx);

  const emailRaw = `${body.email ?? ''}`.trim();
  if (emailRaw) {
    assertTrabalheConoscoEmail(emailRaw);
  }

  let validated;
  try {
    validated = validateJobApplication(body);
  } catch (err) {
    if (antibot.quarentena) {
      validated = {
        nomeCompleto: `${body.nomeCompleto ?? body.nome_completo ?? 'Quarentena'}`.trim(),
        email: `${body.email ?? 'quarentena@invalid.local'}`.trim(),
        whatsapp: null,
        cidade: null,
        areaInteresse: [],
        cargoDesejado: null,
        nivel: null,
        linkedin: null,
        portfolioSite: null,
        apresentacao: null,
        comoChegou: null,
        curriculo: {},
        payload: { _incomplete: true },
      };
    } else {
      throw err;
    }
  }

  if (!antibot.quarentena) {
    assertTrabalheConoscoEmail(validated.email);
    await assertJobEmailAvailable(validated.email);
  }

  const lgpdMeta = isLgpdConsentGiven(body) ? buildLgpdMeta(body, httpCtx) : {};

  const row = await JobApplication.create({
    categoria: CATEGORIA_OUTRAS_AREAS,
    nome_completo: validated.nomeCompleto.slice(0, 160),
    email: normalizeEmail(validated.email),
    whatsapp: validated.whatsapp,
    cidade: validated.cidade,
    area_interesse: validated.areaInteresse,
    cargo_desejado: validated.cargoDesejado,
    nivel: validated.nivel,
    linkedin: validated.linkedin,
    portfolio_site: validated.portfolioSite,
    apresentacao: validated.apresentacao,
    como_chegou: validated.comoChegou,
    payload: validated.payload,
    meta: { ...antibot.meta, ...lgpdMeta },
    estado: 'novo',
  });

  if (!antibot.quarentena && validated.curriculo) {
    const files = persistCurriculo(row.id, validated.curriculo);
    await row.update(files);
  }

  return {
    id: row.id,
    quarentena: antibot.quarentena,
    message: publicSuccessMessage(antibot.quarentena),
  };
}

async function listJobsAdmin(query = {}) {
  let limit = parseInt(`${query.limit ?? 50}`, 10);
  let offset = parseInt(`${query.offset ?? 0}`, 10);
  limit = Math.min(Math.max(Number.isFinite(limit) ? limit : 50, 1), 250);
  offset = Math.max(Number.isFinite(offset) ? offset : 0, 0);

  const where = { deleted_at: null };
  const st = `${query.estado || ''}`.trim();
  if (st && JOB_ESTADOS.includes(st)) where.estado = st;

  if (`${query.quarentena || ''}`.trim() === 'true') {
    where[Op.and] = [
      ...(where[Op.and] || []),
      sequelize.literal("(meta IS NOT NULL AND (meta->>'quarentena') = 'true')"),
    ];
  } else if (`${query.quarentena || ''}`.trim() !== 'all') {
    where[Op.and] = [
      ...(where[Op.and] || []),
      sequelize.literal("(meta IS NULL OR COALESCE(meta->>'quarentena', 'false') <> 'true')"),
    ];
  }

  const { count, rows } = await JobApplication.findAndCountAll({
    where,
    order: [['chegou_em', 'DESC']],
    limit,
    offset,
  });

  return {
    items: rows.map(toApiJob),
    count: rows.length,
    total: count,
    limit,
    offset,
  };
}

async function getJobAdmin(id) {
  const row = await JobApplication.findByPk(id, { paranoid: true });
  if (!row) throw new AppError('Candidatura não encontrada.', 404, null, true);
  return toApiJob(row);
}

async function patchJobEstado(_actorUserId, id, body = {}) {
  const row = await JobApplication.findByPk(id, { paranoid: true });
  if (!row) throw new AppError('Candidatura não encontrada.', 404, null, true);

  const target = `${body.estado || body.target || ''}`.trim();
  if (!JOB_ESTADOS.includes(target)) {
    throw new AppError('Estado inválido.', 400, null, true);
  }

  const patch = {
    estado: target,
    decidida_em: ['aprovado', 'reprovado', 'arquivado'].includes(target) ? new Date() : null,
    razao: body.razao || body.justificativa || null,
  };

  await row.update(patch);
  return toApiJob(await row.reload());
}

module.exports = {
  submitPublicJobApplication,
  listJobsAdmin,
  getJobAdmin,
  patchJobEstado,
  toApiJob,
};
