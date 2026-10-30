'use strict';

/**
 * Gestão administrativa do funil de candidaturas: listagem/resumo/detalhe,
 * criação manual, edição, movimentação de estado, espera, decisão, reabertura,
 * envio de convite e wizard.
 */
const { Op } = require('sequelize');
const { sequelize, SpecialistCandidate } = require('../../models');
const AppError = require('../../utils/AppError');
const { persistAdminAuditLog } = require('../admin/helpers/adminAudit.helper');
const { normalizeEmail } = require('../auth/auth.constants');
const mailService = require('../../providers/mail/mail.service');
const { ESTADOS, FUNNEL_COLUMNS, ONBOARDING_TOKEN_TTL_DAYS } = require('./specialist-candidates.constants');
const { toApiCandidate, cloneJson } = require('./specialist-candidates.mapper');
const { generateOnboardingToken, emptyProc, emptyOnb } = require('./specialist-candidates.helpers');
const { CATEGORIA_ORACULISTA } = require('../trabalhe-conosco/trabalhe-conosco.constants');
const { findCandidateOrThrow, assertNotFinal, assertEmailAvailable } = require('./specialist-candidates.shared');

async function updateWizardSection(actorUserId, id, section, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  assertNotFinal(row);

  const f2 = cloneJson(row.f2 || {}, {});

  if (section === 'perfil-publico') {
    Object.assign(f2, body);
    if (body.perfilPublico) Object.assign(f2, body.perfilPublico);
  } else if (section === 'cadastro-privado') {
    const payload = body.cadastro || body;
    f2.cadastro = { ...(f2.cadastro || {}), ...payload };
  } else if (section === 'pagamento') {
    const payload = body.pagamento || body;
    f2.pagamento = { ...(f2.pagamento || {}), ...payload };
  } else {
    throw new AppError('Secção do wizard inválida.', 400, null, true);
  }

  await row.update({ f2 });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_WIZARD_UPDATE',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    metadata: { section },
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function iniciarProcesso(actorUserId, id, httpCtx = {}) {
  return patchCandidateEstado(actorUserId, id, { target: 'em_analise' }, httpCtx);
}

function resolveFunnelColumn(colKey) {
  const col = FUNNEL_COLUMNS.find((c) => c.key === colKey);
  if (!col) return null;
  if (colKey === 'nova') {
    return {
      estado: 'nova',
      [Op.or]: [{ triagem: 'pendente' }, { triagem: null }],
    };
  }
  if (colKey === 'em_espera') {
    return { estado: 'nova', triagem: 'em_espera' };
  }
  if (colKey === 'historico') {
    return { estado: { [Op.in]: ['reprovada', 'arquivada'] } };
  }
  return { estado: colKey };
}

function buildSearchWhere(q) {
  const term = `${q || ''}`.trim();
  if (term.length < 1) return null;
  const like = `%${term}%`;
  return {
    [Op.or]: [
      { apelido: { [Op.iLike]: like } },
      { nome_civil: { [Op.iLike]: like } },
      { email: { [Op.iLike]: like } },
      sequelize.where(sequelize.cast(sequelize.col('f1'), 'text'), { [Op.iLike]: like }),
    ],
  };
}

function applyQuarantineFilter(where, query = {}) {
  const mode = `${query.quarentena || ''}`.trim().toLowerCase();
  const clause =
    mode === 'true'
      ? sequelize.literal("(meta IS NOT NULL AND (meta->>'quarentena') = 'true')")
      : mode === 'all'
        ? null
        : sequelize.literal("(meta IS NULL OR COALESCE(meta->>'quarentena', 'false') <> 'true')");

  if (!clause) return;
  where[Op.and] = [...(where[Op.and] || []), clause];
}

async function listCandidatesAdmin(query = {}) {
  let limit = parseInt(`${query.limit ?? 100}`, 10);
  let offset = parseInt(`${query.offset ?? 0}`, 10);
  if (!Number.isFinite(limit)) limit = 100;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  limit = Math.min(Math.max(limit, 1), 250);

  const where = {};
  const col = `${query.col || query.column || query.estado || ''}`.trim();
  if (col) Object.assign(where, resolveFunnelColumn(col) || {});

  const st = `${query.estado || ''}`.trim();
  if (st && ESTADOS.includes(st) && !col) where.estado = st;

  applyQuarantineFilter(where, query);

  const searchWhere = buildSearchWhere(query.q || query.search);
  if (searchWhere) {
    where[Op.and] = [...(where[Op.and] || []), searchWhere];
  }

  const { count, rows } = await SpecialistCandidate.findAndCountAll({
    where,
    paranoid: true,
    order: [['chegou_em', 'DESC']],
    limit,
    offset,
  });

  return {
    items: rows.map(toApiCandidate),
    count: rows.length,
    total: count,
    limit,
    offset,
  };
}

async function summaryCandidatesAdmin() {
  const rows = await SpecialistCandidate.findAll({
    where: {
      deleted_at: null,
      [Op.and]: [
        sequelize.literal("(meta IS NULL OR COALESCE(meta->>'quarentena', 'false') <> 'true')"),
      ],
    },
    attributes: ['estado', 'triagem'],
    paranoid: true,
  });

  const counts = {
    nova: 0,
    em_analise: 0,
    aprovada: 0,
    em_onboarding: 0,
    em_espera: 0,
    historico: 0,
  };

  rows.forEach((r) => {
    const plain = r.get({ plain: true });
    const api = { estado: plain.estado, triagem: plain.triagem };
    FUNNEL_COLUMNS.forEach((col) => {
      if (col.match(api)) counts[col.key] += 1;
    });
  });

  return { columns: counts, total: rows.length };
}

async function getCandidateAdmin(id) {
  const row = await findCandidateOrThrow(id);
  return toApiCandidate(row);
}

async function createCandidateManual(actorUserId, body = {}, httpCtx = {}) {
  const apelido = `${body.apelido || ''}`.trim();
  if (!apelido) throw new AppError('Informe o apelido.', 400, null, true);

  const emailRaw = body.email || body.f1?.email;
  if (emailRaw) await assertEmailAvailable(emailRaw);

  const f1 = {
    apresentacao: body.f1?.apresentacao || '—',
    oraculos: body.oraculos || body.f1?.oraculos || '—',
    atendeHa: body.f1?.atendeHa || '—',
    estudaHa: body.f1?.estudaHa || '—',
    disponibilidade: body.f1?.disponibilidade || '—',
    video: body.f1?.video || '—',
    email: emailRaw || '—',
    whatsapp: body.whatsapp || body.f1?.whatsapp || '—',
    comoChegou: body.origem || body.f1?.comoChegou || 'Cadastro manual',
    equipamento: body.f1?.equipamento || '—',
    redes: body.f1?.redes || '—',
    indicadaPor: body.f1?.indicadaPor || '—',
    ...(body.f1 && typeof body.f1 === 'object' ? body.f1 : {}),
  };

  const row = await SpecialistCandidate.create({
    apelido,
    nome_civil: body.nomeCivil || body.nome_civil || null,
    email: emailRaw ? normalizeEmail(emailRaw) : null,
    whatsapp: body.whatsapp || f1.whatsapp || null,
    origem: body.origem || 'Cadastro manual',
    categoria: CATEGORIA_ORACULISTA,
    meta: {},
    estado: 'nova',
    triagem: 'pendente',
    grad: body.grad || 'g3',
    idade: body.idade ?? null,
    f1,
    proc: body.proc && typeof body.proc === 'object' ? cloneJson(body.proc, emptyProc()) : emptyProc(),
    created_by_user_id: actorUserId || null,
  });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_CREATE_MANUAL',
    target_entity: 'SpecialistCandidate',
    target_id: row.id,
    new_value: { apelido, origem: row.origem },
    httpCtx,
  });

  return toApiCandidate(row);
}

async function patchCandidateAdmin(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  assertNotFinal(row);

  const patch = {};
  if (body.apelido != null) patch.apelido = `${body.apelido}`.trim().slice(0, 160);
  if (body.nomeCivil != null || body.nome_civil != null) {
    patch.nome_civil = `${body.nomeCivil ?? body.nome_civil ?? ''}`.trim() || null;
  }
  if (body.grad != null) patch.grad = `${body.grad}`.trim().slice(0, 8) || null;
  if (body.idade != null) {
    const n = parseInt(`${body.idade}`, 10);
    patch.idade = Number.isFinite(n) ? n : null;
  }
  if (body.email != null) {
    const mail = normalizeEmail(body.email);
    if (mail) await assertEmailAvailable(mail, id);
    patch.email = mail || null;
  }
  if (body.whatsapp != null) patch.whatsapp = `${body.whatsapp}`.trim().slice(0, 32) || null;

  if (body.f1 && typeof body.f1 === 'object') {
    patch.f1 = { ...cloneJson(row.f1, {}), ...body.f1 };
    if (body.f1.email) {
      const mail = normalizeEmail(body.f1.email);
      if (mail) await assertEmailAvailable(mail, id);
      patch.email = mail;
    }
  }
  if (body.proc && typeof body.proc === 'object') {
    patch.proc = { ...cloneJson(row.proc, emptyProc()), ...body.proc };
  }
  if (body.f2 && typeof body.f2 === 'object') {
    patch.f2 = { ...cloneJson(row.f2, {}), ...body.f2 };
  }
  if (body.onb && typeof body.onb === 'object') {
    patch.onb = { ...(row.onb || emptyOnb()), ...body.onb };
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError('Nenhum campo válido para actualizar.', 400, null, true);
  }

  await row.update(patch);

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_PATCH',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    new_value: Object.keys(patch),
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function patchCandidateEstado(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const target = `${body.target || body.estado || ''}`.trim();
  if (!target) throw new AppError('Informe `target` / `estado`.', 400, null, true);

  const patch = {};

  if (target === 'em_espera') {
    patch.estado = 'nova';
    patch.triagem = 'em_espera';
  } else if (target === 'nova') {
    patch.estado = 'nova';
    patch.triagem = 'pendente';
    patch.espera_desde = null;
    patch.espera_motivo = null;
    patch.espera_nota = null;
  } else if (target === 'historico') {
    patch.estado = 'arquivada';
    patch.decidida_em = new Date();
    patch.razao = body.razao || row.razao || '—';
    patch.triagem = null;
  } else if (target === 'reprovada' || target === 'arquivada') {
    patch.estado = target;
    patch.decidida_em = new Date();
    patch.razao = body.razao || row.razao || '—';
    patch.triagem = null;
    patch.espera_desde = null;
    patch.espera_motivo = null;
    patch.espera_nota = null;
  } else if (ESTADOS.includes(target)) {
    patch.estado = target;
    if (target !== 'nova') patch.triagem = null;
    if (target === 'em_analise') {
      patch.espera_desde = null;
      patch.espera_motivo = null;
      patch.espera_nota = null;
    }
    if (target === 'aprovada') {
      patch.decidida_em = patch.decidida_em || new Date();
      patch.convite = row.convite || { status: 'aguardando', enviadoPor: '' };
    }
    if (target === 'em_onboarding') {
      patch.onb = row.onb || emptyOnb();
      patch.onb.conviteEnviado = true;
      patch.convite = row.convite || { status: 'em_preenchimento', enviadoPor: 'Manual' };
    }
  } else {
    throw new AppError('Estado/coluna inválido.', 400, null, true);
  }

  await row.update(patch);

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_MOVE',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    new_value: { target, estado: patch.estado },
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function patchCandidateEspera(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  assertNotFinal(row);

  const remove = body.remove === true || body.tirar === true;
  if (remove) {
    await row.update({
      triagem: 'pendente',
      espera_desde: null,
      espera_motivo: null,
      espera_nota: null,
    });
  } else {
    const motivo = `${body.motivo || body.esperaMotivo || ''}`.trim();
    const nota = `${body.nota || body.esperaNota || ''}`.trim();
    if (!motivo) throw new AppError('Informe o motivo da espera.', 400, null, true);
    await row.update({
      estado: 'nova',
      triagem: 'em_espera',
      espera_desde: new Date(),
      espera_motivo: motivo.slice(0, 64),
      espera_nota: nota || null,
    });
  }

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: remove ? 'ADMIN_CANDIDATE_ESPERA_REMOVE' : 'ADMIN_CANDIDATE_ESPERA_SET',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function patchCandidateDecisao(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const kind = `${body.kind || body.decisao || ''}`.trim().toLowerCase();
  const razao = `${body.razao || body.justificativa || ''}`.trim();

  if (!['aprovar', 'reprovar', 'arquivar'].includes(kind)) {
    throw new AppError('Decisão inválida — use aprovar, reprovar ou arquivar.', 400, null, true);
  }

  const patch = {
    decidida_em: new Date(),
    razao: razao || (kind === 'reprovar' ? '—' : null),
    triagem: null,
    espera_desde: null,
    espera_motivo: null,
    espera_nota: null,
  };

  if (kind === 'aprovar') {
    patch.estado = 'aprovada';
    patch.convite = { status: 'aguardando', enviadoPor: '' };
  } else if (kind === 'reprovar') {
    patch.estado = 'reprovada';
  } else {
    patch.estado = 'arquivada';
  }

  await row.update(patch);

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: `ADMIN_CANDIDATE_DECISION_${kind.toUpperCase()}`,
    target_entity: 'SpecialistCandidate',
    target_id: id,
    metadata: razao ? { razao: razao.slice(0, 400) } : null,
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function reabrirCandidate(actorUserId, id, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  if (!['reprovada', 'arquivada', 'aprovada'].includes(row.estado)) {
    throw new AppError('Só candidaturas decididas podem ser reabertas.', 409, null, true);
  }

  await row.update({
    estado: 'em_analise',
    decidida_em: null,
    razao: null,
    convite: null,
    triagem: null,
  });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_REOPEN',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function enviarConvite(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  if (!['aprovada', 'em_onboarding'].includes(row.estado)) {
    throw new AppError('Convite só após aprovação.', 409, null, true);
  }

  const via = `${body.via || body.enviadoPor || 'WhatsApp'}`.trim().slice(0, 64);
  const token = generateOnboardingToken();
  const expires = new Date(Date.now() + ONBOARDING_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const onb = { ...(row.onb || emptyOnb()), conviteEnviado: true };

  await row.update({
    estado: 'em_onboarding',
    onboarding_token: token,
    onboarding_token_expires_at: expires,
    convite: { status: 'em_preenchimento', enviadoPor: via, enviadoEm: new Date().toISOString() },
    onb,
  });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_INVITE_SENT',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    metadata: { via },
    httpCtx,
  });

  const api = toApiCandidate(await row.reload());

  const frontBase = `${process.env.FRONT_PUBLIC_URL || process.env.CORS_ORIGINS?.split(',')[0] || 'http://localhost:3000'}`.replace(/\/$/, '');
  const onboardingLink = `${frontBase}/onboarding?token=${token}`;
  api.onboardingLink = onboardingLink;

  const destEmail = row.email || row.f1?.email;
  if (destEmail && `${destEmail}`.trim() && destEmail !== '—') {
    void mailService.sendCandidateInviteEmail(destEmail, {
      apelido: row.apelido,
      onboardingLink,
    });
  }

  return {
    ...api,
    onboardingToken: token,
  };
}

async function marcarF2Recebido(actorUserId, id, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const onb = { ...(row.onb || emptyOnb()), f2Recebido: true };
  const convite = { ...(row.convite || {}), status: 'recebido' };
  await row.update({ onb, convite, estado: 'em_onboarding' });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_F2_MARKED',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

module.exports = {
  updateWizardSection,
  iniciarProcesso,
  listCandidatesAdmin,
  summaryCandidatesAdmin,
  getCandidateAdmin,
  createCandidateManual,
  patchCandidateAdmin,
  patchCandidateEstado,
  patchCandidateEspera,
  patchCandidateDecisao,
  reabrirCandidate,
  enviarConvite,
  marcarF2Recebido,
};
