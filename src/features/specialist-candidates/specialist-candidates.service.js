'use strict';

/**
 * Fachada do serviço de candidaturas de oraculistas.
 *
 * Dividido por responsabilidade — controllers (admin e público) continuam
 * importando `specialist-candidates.service` sem mudanças.
 *
 *   - specialist-candidates.shared.js               → lookup/validação de candidata
 *   - specialist-candidates.admin.service.js        → funil (listar/mover/decidir/convite)
 *   - specialist-candidates.provisioning.service.js → gerar perfil / liberar acesso / ativar
 *   - specialist-candidates.assets.service.js       → uploads (contrato/fotos/áudio)
 *   - specialist-candidates.public.service.js       → formulários públicos (F1/F2)
 */
const admin = require('./specialist-candidates.admin.service');
const provisioning = require('./specialist-candidates.provisioning.service');
const assets = require('./specialist-candidates.assets.service');
const publicApi = require('./specialist-candidates.public.service');

module.exports = {
  // admin — funil
  listCandidatesAdmin: admin.listCandidatesAdmin,
  summaryCandidatesAdmin: admin.summaryCandidatesAdmin,
  getCandidateAdmin: admin.getCandidateAdmin,
  createCandidateManual: admin.createCandidateManual,
  patchCandidateAdmin: admin.patchCandidateAdmin,
  patchCandidateEstado: admin.patchCandidateEstado,
  patchCandidateEspera: admin.patchCandidateEspera,
  patchCandidateDecisao: admin.patchCandidateDecisao,
  reabrirCandidate: admin.reabrirCandidate,
  enviarConvite: admin.enviarConvite,
  marcarF2Recebido: admin.marcarF2Recebido,
  updateWizardSection: admin.updateWizardSection,
  iniciarProcesso: admin.iniciarProcesso,
  // provisionamento
  gerarPerfil: provisioning.gerarPerfil,
  liberarAcesso: provisioning.liberarAcesso,
  ativarPerfil: provisioning.ativarPerfil,
  // assets
  uploadCandidateAsset: assets.uploadCandidateAsset,
  removeContrato: assets.removeContrato,
  toggleFoto: assets.toggleFoto,
  UPLOADS_DIR: assets.UPLOADS_DIR,
  ensureUploadsDir: assets.ensureUploadsDir,
  // público
  submitPublicF1: publicApi.submitPublicF1,
  getPublicOnboardingByToken: publicApi.getPublicOnboardingByToken,
  submitPublicF2: publicApi.submitPublicF2,
};
