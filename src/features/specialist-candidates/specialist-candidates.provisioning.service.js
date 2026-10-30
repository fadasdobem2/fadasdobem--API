'use strict';

/**
 * Provisionamento a partir da candidatura: geração de perfil (User + Specialist
 * + perfis privados + oráculos/modalidades/agenda), liberação de acesso e
 * ativação (aprovação da taróloga).
 */
const bcrypt = require('bcryptjs');
const { Op } = require('sequelize');
const {
  sequelize,
  User,
  Specialist,
  SpecialistPrivateProfile,
  SpecialistModality,
  SpecialistOracle,
  SpecialistSchedule,
  Oracle,
} = require('../../models');
const AppError = require('../../utils/AppError');
const { persistAdminAuditLog } = require('../admin/helpers/adminAudit.helper');
const { normalizeEmail, AUTH_CONFIG } = require('../auth/auth.constants');
const { approveOrRejectTarologa } = require('../admin/services/admin.specialists.service');
const mailService = require('../../providers/mail/mail.service');
const { ACCESS_LINK_TTL_HOURS } = require('./specialist-candidates.constants');
const { toApiCandidate, cloneJson } = require('./specialist-candidates.mapper');
const {
  ensureUniqueSlug,
  generateProvisionalPassword,
  agendaMockToScheduleSlots,
  parseModalitiesFromCanais,
  parsePixType,
  emptyOnb,
} = require('./specialist-candidates.helpers');
const { findCandidateOrThrow, assertEmailAvailable } = require('./specialist-candidates.shared');

async function syncOraclesForSpecialist(specialistId, f2, transaction) {
  const names = new Set();
  ['oraculos', 'tarots', 'cartomancia', 'oraculosLista'].forEach((key) => {
    const arr = f2?.[key];
    if (Array.isArray(arr)) arr.forEach((n) => names.add(`${n}`.trim()));
  });
  if (f2?.oraculos && typeof f2.oraculos === 'string') {
    `${f2.oraculos}`.split(/[·,]/).forEach((n) => names.add(n.trim()));
  }

  await SpecialistOracle.destroy({ where: { specialist_id: specialistId }, transaction });

  for (const name of names) {
    if (!name) continue;
    const slugGuess = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    let oracle = await Oracle.findOne({
      where: {
        [Op.or]: [{ name: { [Op.iLike]: name } }, ...(slugGuess ? [{ slug: slugGuess }] : [])],
      },
      transaction,
    });
    if (oracle) {
      await SpecialistOracle.findOrCreate({
        where: { specialist_id: specialistId, oracle_id: oracle.id },
        defaults: { specialist_id: specialistId, oracle_id: oracle.id },
        transaction,
      });
    }
  }
}

async function syncModalities(specialistId, f2, transaction) {
  const mods = parseModalitiesFromCanais(f2?.canais);
  await SpecialistModality.destroy({ where: { specialist_id: specialistId }, transaction });
  for (const modality of mods) {
    await SpecialistModality.create({ specialist_id: specialistId, modality }, { transaction });
  }
}

async function syncSchedule(specialistId, f2, transaction) {
  const slots = agendaMockToScheduleSlots(f2?.agenda);
  await SpecialistSchedule.destroy({ where: { specialist_id: specialistId }, transaction });
  if (slots.length) {
    await SpecialistSchedule.bulkCreate(
      slots.map((s) => ({ ...s, specialist_id: specialistId })),
      { transaction }
    );
  }
}

function resolveAccountEmail(candidate, f2) {
  const fromF2 =
    f2?.cadastro?.emailPessoal ||
    candidate.email ||
    candidate.f1?.email;
  const mail = normalizeEmail(fromF2);
  if (!mail || mail === '—') {
    throw new AppError('E-mail pessoal da candidata não encontrado — preencha F1/F2.', 400, null, true);
  }
  return mail;
}

async function gerarPerfil(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  if (!['em_onboarding', 'aprovada'].includes(row.estado)) {
    throw new AppError('Gerar perfil só após aprovação/onboarding.', 409, null, true);
  }

  const f2 = cloneJson(body.f2 || row.f2 || {}, {});
  if (body.perfilPublico) Object.assign(f2, body.perfilPublico);
  if (body.cadastro) f2.cadastro = { ...(f2.cadastro || {}), ...body.cadastro };
  if (body.pagamento) f2.pagamento = { ...(f2.pagamento || {}), ...body.pagamento };

  const displayName = f2.nomePublico || row.apelido;
  const slug = await ensureUniqueSlug(f2.slug || displayName, row.specialist_id);
  const email = resolveAccountEmail(row, f2);

  let specialistId = row.specialist_id;
  let userId = row.user_id;
  let provisionalPassword = null;

  await sequelize.transaction(async (t) => {
    if (!userId) {
      await assertEmailAvailable(email, row.id);
      provisionalPassword = generateProvisionalPassword();
      const password_hash = await bcrypt.hash(provisionalPassword, AUTH_CONFIG.bcryptCostPassword);
      const user = await User.create(
        {
          email,
          password_hash,
          role: 'TAROLOGA',
          is_active: false,
          onboarding_step: 1,
        },
        { transaction: t }
      );
      userId = user.id;
    }

    const pix = f2.pagamento || {};
    const cad = f2.cadastro || {};
    const comissao = cad.comissoes?.padrao ?? cad.comissoes?.padrao ?? null;

    if (!specialistId) {
      const spec = await Specialist.create(
        {
          user_id: userId,
          display_name: displayName,
          bio: f2.textoPerfil || f2.subtitulo || null,
          slug,
          candidate_id: row.id,
          registration_approval_status: 'PENDING',
          status: 'OFFLINE',
          chave_pix: pix.pixChave || null,
          chave_pix_type: parsePixType(pix.pixTipo),
          titular_pix_nome: cad.nomeCivil || row.nome_civil || displayName,
          commission_percent_default: comissao != null ? Number(comissao) : null,
          experience_years: null,
        },
        { transaction: t }
      );
      specialistId = spec.id;
    } else {
      await Specialist.update(
        {
          display_name: displayName,
          bio: f2.textoPerfil || f2.subtitulo || null,
          slug,
          chave_pix: pix.pixChave || null,
          chave_pix_type: parsePixType(pix.pixTipo),
          titular_pix_nome: cad.nomeCivil || row.nome_civil || displayName,
          commission_percent_default: comissao != null ? Number(comissao) : null,
        },
        { where: { id: specialistId }, transaction: t }
      );
    }

    await syncOraclesForSpecialist(specialistId, f2, t);
    await syncModalities(specialistId, f2, t);
    await syncSchedule(specialistId, f2, t);

    const privatePayload = {
      specialist_id: specialistId,
      nome_civil: cad.nomeCivil || row.nome_civil || null,
      cpf: cad.cpf ? `${cad.cpf}`.replace(/\D/g, '').slice(0, 14) : null,
      rg: cad.rg || null,
      data_nascimento: cad.nascimento || cad.data_nascimento || null,
      endereco: {
        cep: cad.cep,
        logradouro: cad.logradouro,
        numero: cad.numero,
        complemento: cad.complemento,
        cidade: cad.cidade,
        uf: cad.uf,
      },
      contato_emergencia: {
        nome: cad.emergNome,
        telefone: cad.emergTel,
        parentesco: cad.emergParentesco,
      },
      dados_bancarios: {
        banco: pix.banco,
        agencia: pix.agencia,
        conta: pix.conta,
        tipo: pix.tipo,
        pixTipo: pix.pixTipo,
        pixChave: pix.pixChave,
      },
    };

    const [priv, created] = await SpecialistPrivateProfile.findOrCreate({
      where: { specialist_id: specialistId },
      defaults: privatePayload,
      transaction: t,
    });
    if (!created) {
      await priv.update(privatePayload, { transaction: t });
    }

    const emailInst =
      cad.emailInstitucional ||
      `${slug.replace(/-/g, '')}@fadasdobem.com.br`.slice(0, 320);

    const onb = {
      ...(row.onb || emptyOnb()),
      perfilGerado: true,
      emailInstitucional: emailInst,
      f2Recebido: row.onb?.f2Recebido ?? Boolean(row.f2),
    };

    await row.update(
      {
        f2,
        user_id: userId,
        specialist_id: specialistId,
        estado: 'em_onboarding',
        onb,
      },
      { transaction: t }
    );
  });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_PROFILE_GENERATED',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    new_value: { specialist_id: specialistId, user_id: userId },
    httpCtx,
  });

  const result = toApiCandidate(await row.reload());
  if (provisionalPassword) {
    result.provisionalPassword = provisionalPassword;
  }
  return result;
}

async function liberarAcesso(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  if (!row.specialist_id || !row.user_id) {
    throw new AppError('Gere o perfil antes de liberar acesso.', 409, null, true);
  }

  const password =
    body.password ||
    body.senhaProvisoria ||
    generateProvisionalPassword();
  const password_hash = await bcrypt.hash(`${password}`, AUTH_CONFIG.bcryptCostPassword);

  const expires = new Date(Date.now() + ACCESS_LINK_TTL_HOURS * 60 * 60 * 1000);

  const user = await User.findByPk(row.user_id, { attributes: ['id', 'email'] });

  await sequelize.transaction(async (t) => {
    await User.update({ password_hash, is_active: false }, { where: { id: row.user_id }, transaction: t });
    const onb = {
      ...(row.onb || emptyOnb()),
      acessoLiberado: true,
      acessoExpiraEm: expires.toISOString(),
    };
    await row.update({ onb }, { transaction: t });
  });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_ACCESS_GRANTED',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    httpCtx,
  });

  const destEmail = user?.email || row.email;
  if (destEmail) {
    void mailService.sendCandidateAccessEmail(destEmail, {
      apelido: row.apelido,
      email: destEmail,
      password,
      expiresAt: expires.toLocaleString('pt-BR'),
    });
  }

  return {
    ...toApiCandidate(await row.reload()),
    provisionalPassword: password,
    accessExpiresAt: expires.toISOString(),
  };
}

async function ativarPerfil(actorUserId, id, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  if (!row.specialist_id) {
    throw new AppError('Gere o perfil antes de activar.', 409, null, true);
  }

  await approveOrRejectTarologa(actorUserId, row.specialist_id, { approved: true }, httpCtx);

  const onb = { ...(row.onb || emptyOnb()), ativado: true };
  await row.update({ onb, estado: 'em_onboarding' });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_ACTIVATED',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    new_value: { specialist_id: row.specialist_id },
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

module.exports = {
  syncOraclesForSpecialist,
  syncModalities,
  syncSchedule,
  resolveAccountEmail,
  gerarPerfil,
  liberarAcesso,
  ativarPerfil,
};
