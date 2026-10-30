'use strict';

const AppError = require('../../utils/AppError');
const { assertMobileWhatsapp } = require('./trabalhe-conosco.antibot');
const { buildF1FromPublicBody } = require('./trabalhe-conosco.f1-builder');
const { assertTrabalheConoscoEmail } = require('./trabalhe-conosco.email');
const { assertLgpdConsent } = require('./trabalhe-conosco.lgpd');

function requireField(value, label) {
  const v = `${value ?? ''}`.trim();
  if (!v) throw new AppError(`${label} é obrigatório.`, 400, null, true);
  return v;
}

function validateOraculistaF1(body = {}) {
  assertLgpdConsent(body);

  const built = buildF1FromPublicBody(body);
  const { f1, apelido, email, whatsapp, telefone } = built;

  assertTrabalheConoscoEmail(email);
  requireField(telefone, 'Telefone');
  requireField(f1.apresentacao, 'Apresentação');
  requireField(f1.oraculos, 'Artes oraculares');
  requireField(f1.atendeHa, 'Tempo como oraculista');
  requireField(f1.estudaHa, 'Tempo de estudo');
  requireField(f1.sitesAtuais, 'Sites/apps onde trabalha');
  requireField(f1.disponibilidade, 'Disponibilidade');
  requireField(f1.equipamento, 'Equipamentos');
  requireField(f1.video, 'Atendimento por vídeo');
  requireField(f1.comoChegou, 'Como chegou');

  const nomeSocial = `${body.nomeSocial ?? body.nome_social ?? f1._raw?.nomeSocial ?? ''}`.trim();
  if (!nomeSocial && !apelido) {
    throw new AppError('Informe nome social ou nome esotérico.', 400, null, true);
  }

  const wa = assertMobileWhatsapp(whatsapp, { required: true });
  built.whatsapp = wa;

  const met = f1.metodologia || {};
  requireField(met.estiloAtendimento, 'Estilo de atendimento');
  requireField(met.inicioConsulta, 'Como começa as consultas');
  requireField(met.tempoConsulta, 'Tempo médio de consulta');

  return built;
}

function validateJobApplication(body = {}) {
  assertLgpdConsent(body);

  const nomeCompleto = requireField(body.nomeCompleto ?? body.nome_completo, 'Nome completo');
  assertTrabalheConoscoEmail(body.email);
  const email = `${body.email ?? ''}`.trim().toLowerCase();
  const whatsappRaw = body.whatsapp ?? body.whatsApp;
  const whatsapp = whatsappRaw ? assertMobileWhatsapp(whatsappRaw, { required: false }) : null;

  const curriculo = body.curriculo || body.cv || {};
  const hasCv =
    Boolean(curriculo.base64 || curriculo.file_base64 || curriculo.content_base64) ||
    Boolean(`${curriculo.url || curriculo.file_url || ''}`.trim());

  if (!hasCv) {
    throw new AppError('Anexe o currículo (PDF ou DOC).', 400, null, true);
  }

  const areas = body.areaInteresse ?? body.area_interesse;
  const areaList = Array.isArray(areas) ? areas : areas ? [`${areas}`] : [];

  return {
    nomeCompleto,
    email,
    whatsapp,
    cidade: `${body.cidade ?? ''}`.trim() || null,
    areaInteresse: areaList.map((a) => `${a}`.trim()).filter(Boolean),
    cargoDesejado: `${body.cargoDesejado ?? body.cargo_desejado ?? ''}`.trim() || null,
    nivel: `${body.nivel ?? ''}`.trim() || null,
    linkedin: `${body.linkedin ?? ''}`.trim() || null,
    portfolioSite: `${body.portfolioSite ?? body.portfolio_site ?? ''}`.trim() || null,
    apresentacao: `${body.apresentacao ?? ''}`.trim() || null,
    comoChegou: `${body.comoChegou ?? body.como_chegou ?? ''}`.trim() || null,
    curriculo,
    payload: body.payload && typeof body.payload === 'object' ? body.payload : { _raw: body._raw || {} },
  };
}

module.exports = {
  validateOraculistaF1,
  validateJobApplication,
};
