'use strict';

/**
 * Endpoints públicos de candidatura de oraculista (Trabalhe Conosco):
 * submissão do Formulário 1, leitura do onboarding por token e Formulário 2.
 */
const { SpecialistCandidate } = require('../../models');
const AppError = require('../../utils/AppError');
const { normalizeEmail, assertEmailFormat } = require('../auth/auth.constants');
const { cloneJson } = require('./specialist-candidates.mapper');
const { emptyProc, emptyOnb } = require('./specialist-candidates.helpers');
const { CATEGORIA_ORACULISTA } = require('../trabalhe-conosco/trabalhe-conosco.constants');
const { evaluateAntibot, publicSuccessMessage } = require('../trabalhe-conosco/trabalhe-conosco.antibot');
const { validateOraculistaF1 } = require('../trabalhe-conosco/trabalhe-conosco.validation');
const { buildF1FromPublicBody } = require('../trabalhe-conosco/trabalhe-conosco.f1-builder');
const { buildLgpdMeta, isLgpdConsentGiven } = require('../trabalhe-conosco/trabalhe-conosco.lgpd');
const { assertTrabalheConoscoEmail } = require('../trabalhe-conosco/trabalhe-conosco.email');
const { assertEmailAvailable } = require('./specialist-candidates.shared');

/** POST público — Formulário 1 oraculista (Trabalhe Conosco) */
async function submitPublicF1(body = {}, httpCtx = {}) {
  const antibot = evaluateAntibot(body, httpCtx);

  const emailRaw = `${body.email ?? body.f1?.email ?? ''}`.trim();
  if (emailRaw) {
    assertTrabalheConoscoEmail(emailRaw);
  }

  let built;
  try {
    built = validateOraculistaF1(body);
  } catch (err) {
    if (antibot.quarentena) {
      built = buildF1FromPublicBody(body);
    } else {
      throw err;
    }
  }

  const { apelido, nomeCivil, email, whatsapp, origem, f1 } = built;

  if (!antibot.quarentena) {
    assertEmailFormat(email);
    assertTrabalheConoscoEmail(email);
    await assertEmailAvailable(email);
  }

  const lgpdMeta = isLgpdConsentGiven(body) ? buildLgpdMeta(body, httpCtx) : {};

  const row = await SpecialistCandidate.create({
    apelido: `${apelido}`.slice(0, 160),
    nome_civil: nomeCivil ? `${nomeCivil}`.slice(0, 160) : null,
    email: email ? normalizeEmail(email) : null,
    whatsapp: whatsapp ? `${whatsapp}`.slice(0, 32) : null,
    origem: `${origem || 'Site'}`.slice(0, 64),
    categoria: CATEGORIA_ORACULISTA,
    meta: { ...antibot.meta, ...lgpdMeta },
    estado: 'nova',
    triagem: antibot.quarentena ? null : 'pendente',
    grad: 'g3',
    f1: {
      ...f1,
      _meta: {
        ...(f1._meta || {}),
        quarentena: antibot.quarentena,
        categoria: CATEGORIA_ORACULISTA,
      },
    },
    proc: emptyProc(),
  });

  return {
    id: row.id,
    quarentena: antibot.quarentena,
    message: publicSuccessMessage(antibot.quarentena),
  };
}

async function getPublicOnboardingByToken(token) {
  const tok = `${token || ''}`.trim();
  if (!tok) throw new AppError('Token inválido.', 400, null, true);

  const row = await SpecialistCandidate.findOne({
    where: { onboarding_token: tok },
    paranoid: true,
  });
  if (!row) throw new AppError('Link de onboarding inválido ou expirado.', 404, null, true);
  if (row.onboarding_token_expires_at && new Date(row.onboarding_token_expires_at) < new Date()) {
    throw new AppError('Link de onboarding expirado.', 410, null, true);
  }
  if (['reprovada', 'arquivada'].includes(row.estado)) {
    throw new AppError('Esta candidatura não está mais activa.', 410, null, true);
  }

  return {
    apelido: row.apelido,
    token: tok,
    expiresAt: row.onboarding_token_expires_at,
    f2Submitted: Boolean(row.onb?.f2Recebido),
  };
}

async function submitPublicF2(token, body = {}) {
  const tok = `${token || ''}`.trim();
  const row = await SpecialistCandidate.findOne({ where: { onboarding_token: tok }, paranoid: true });
  if (!row) throw new AppError('Link inválido.', 404, null, true);
  if (row.onboarding_token_expires_at && new Date(row.onboarding_token_expires_at) < new Date()) {
    throw new AppError('Link expirado.', 410, null, true);
  }

  const f2 = cloneJson(body, {});
  const onb = { ...(row.onb || emptyOnb()), f2Recebido: true, conviteEnviado: true };
  const convite = { ...(row.convite || {}), status: 'recebido' };

  await row.update({
    f2,
    f2_original: cloneJson(body, {}),
    onb,
    convite,
    estado: 'em_onboarding',
  });

  return { ok: true, id: row.id };
}

module.exports = { submitPublicF1, getPublicOnboardingByToken, submitPublicF2 };
