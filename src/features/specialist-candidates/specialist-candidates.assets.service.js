'use strict';

/**
 * Uploads e anexos da candidatura: contrato, fotos e áudios de avaliação,
 * persistência de ficheiros em disco e toggles de foto.
 */
const fs = require('fs');
const path = require('path');
const { SpecialistPrivateProfile } = require('../../models');
const AppError = require('../../utils/AppError');
const { persistAdminAuditLog } = require('../admin/helpers/adminAudit.helper');
const { toApiCandidate, cloneJson } = require('./specialist-candidates.mapper');
const { emptyProc, emptyOnb } = require('./specialist-candidates.helpers');
const { findCandidateOrThrow } = require('./specialist-candidates.shared');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'specialist-candidates');

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function persistUploadedFile(candidateId, kind, body = {}) {
  const fileUrl = `${body.file_url || body.url || ''}`.trim();
  const fileName = `${body.file_name || body.filename || ''}`.trim();
  const base64Raw = body.base64 || body.file_base64 || body.content_base64;

  if (base64Raw) {
    ensureUploadsDir();
    const ext = `${body.ext || 'bin'}`.replace(/^\./, '');
    const safeKind = `${kind}`.replace(/[^a-z0-9_-]/gi, '');
    const fname = fileName || `${safeKind}_${candidateId.slice(0, 8)}_${Date.now()}.${ext}`;
    const fpath = path.join(UPLOADS_DIR, fname);
    const buf = Buffer.from(`${base64Raw}`, 'base64');
    if (!buf.length) throw new AppError('Conteúdo base64 inválido.', 400, null, true);
    fs.writeFileSync(fpath, buf);
    return { fileUrl: `/uploads/specialist-candidates/${fname}`, fileName: fname };
  }

  return { fileUrl: fileUrl || null, fileName: fileName || null };
}

async function uploadCandidateAsset(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const kind = `${body.kind || body.tipo || ''}`.trim().toLowerCase();
  const { fileUrl, fileName } = persistUploadedFile(id, kind, body);

  if (!kind) throw new AppError('Informe `kind`: contrato, foto34, foto11, audio.', 400, null, true);

  const onb = { ...(row.onb || emptyOnb()) };

  if (kind === 'contrato') {
    onb.contratoArquivo = fileName || fileUrl || `contrato_${row.id.slice(0, 8)}.pdf`;
    onb.contratoUrl = fileUrl || null;
    if (row.specialist_id && fileUrl) {
      const priv = await SpecialistPrivateProfile.findOne({ where: { specialist_id: row.specialist_id } });
      if (priv) await priv.update({ contrato_url: fileUrl, contrato_assinado_em: new Date() });
    }
  } else if (kind === 'foto34') {
    onb.foto34 = true;
    onb.foto34Url = fileUrl || null;
  } else if (kind === 'foto11') {
    onb.foto11 = true;
    onb.foto11Url = fileUrl || null;
  } else if (kind === 'audio' && body.proc) {
    const proc = cloneJson(row.proc, emptyProc());
    if (!Array.isArray(proc.aval.audios)) proc.aval.audios = [];
    proc.aval.audios.push(body.audio || { dur: body.dur || '0:00', url: fileUrl });
    await row.update({ proc, onb });
    return toApiCandidate(await row.reload());
  } else {
    throw new AppError('Tipo de upload inválido.', 400, null, true);
  }

  await row.update({ onb });

  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_UPLOAD',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    metadata: { kind },
    httpCtx,
  });

  return toApiCandidate(await row.reload());
}

async function removeContrato(actorUserId, id, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const onb = { ...(row.onb || emptyOnb()), contratoArquivo: null, contratoUrl: null };
  await row.update({ onb });
  if (row.specialist_id) {
    const priv = await SpecialistPrivateProfile.findOne({ where: { specialist_id: row.specialist_id } });
    if (priv) await priv.update({ contrato_url: null, contrato_assinado_em: null });
  }
  await persistAdminAuditLog({
    admin_id: actorUserId,
    action: 'ADMIN_CANDIDATE_CONTRACT_REMOVED',
    target_entity: 'SpecialistCandidate',
    target_id: id,
    httpCtx,
  });
  return toApiCandidate(await row.reload());
}

async function toggleFoto(actorUserId, id, body = {}, httpCtx = {}) {
  const row = await findCandidateOrThrow(id);
  const key = `${body.key || ''}`.trim();
  if (!['foto34', 'foto11'].includes(key)) {
    throw new AppError('Informe key: foto34 ou foto11.', 400, null, true);
  }
  const onb = { ...(row.onb || emptyOnb()) };
  onb[key] = !onb[key];
  await row.update({ onb });
  return toApiCandidate(await row.reload());
}

module.exports = {
  UPLOADS_DIR,
  ensureUploadsDir,
  persistUploadedFile,
  uploadCandidateAsset,
  removeContrato,
  toggleFoto,
};
