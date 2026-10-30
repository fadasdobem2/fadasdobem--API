'use strict';

const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const { SpecialistCandidate, JobApplication, sequelize } = require('../../models');
const {
  RETENTION_REJECTED_DAYS,
  RETENTION_QUARANTINE_DAYS,
  UPLOADS_JOBS_DIR,
} = require('./trabalhe-conosco.constants');

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', UPLOADS_JOBS_DIR);

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function unlinkCvIfLocal(url) {
  const u = `${url || ''}`.trim();
  if (!u.startsWith(`/uploads/${UPLOADS_JOBS_DIR}/`)) return;
  const fname = path.basename(u);
  const fpath = path.join(UPLOADS_DIR, fname);
  try {
    if (fs.existsSync(fpath)) fs.unlinkSync(fpath);
  } catch {
    /* ignora falha pontual de I/O */
  }
}

/**
 * Expurgo LGPD — currículos reprovados/arquivados e quarentena antiga.
 * Hard delete após prazo configurável (env TC_RETENTION_*).
 */
async function purgeStaleTrabalheConoscoRecords() {
  const rejectedBefore = daysAgo(RETENTION_REJECTED_DAYS);
  const quarantineBefore = daysAgo(RETENTION_QUARANTINE_DAYS);

  const rejectedCandidates = await SpecialistCandidate.findAll({
    where: {
      estado: { [Op.in]: ['reprovada', 'arquivada'] },
      [Op.or]: [
        { decidida_em: { [Op.lt]: rejectedBefore } },
        { decidida_em: null, chegou_em: { [Op.lt]: rejectedBefore } },
      ],
    },
    attributes: ['id'],
    paranoid: false,
  });

  const quarantineCandidates = await SpecialistCandidate.findAll({
    where: {
      [Op.and]: [
        sequelize.literal("(meta IS NOT NULL AND (meta->>'quarentena') = 'true')"),
        { created_at: { [Op.lt]: quarantineBefore } },
      ],
    },
    attributes: ['id'],
    paranoid: false,
  });

  const rejectedJobs = await JobApplication.findAll({
    where: {
      estado: { [Op.in]: ['reprovado', 'arquivado'] },
      [Op.or]: [
        { decidida_em: { [Op.lt]: rejectedBefore } },
        { decidida_em: null, chegou_em: { [Op.lt]: rejectedBefore } },
      ],
    },
    attributes: ['id', 'curriculo_url'],
    paranoid: false,
  });

  const quarantineJobs = await JobApplication.findAll({
    where: {
      [Op.and]: [
        sequelize.literal("(meta IS NOT NULL AND (meta->>'quarentena') = 'true')"),
        { created_at: { [Op.lt]: quarantineBefore } },
      ],
    },
    attributes: ['id', 'curriculo_url'],
    paranoid: false,
  });

  for (const row of rejectedJobs) unlinkCvIfLocal(row.curriculo_url);
  for (const row of quarantineJobs) unlinkCvIfLocal(row.curriculo_url);

  const candidateIds = [...new Set([...rejectedCandidates, ...quarantineCandidates].map((r) => r.id))];
  const jobIds = [...new Set([...rejectedJobs, ...quarantineJobs].map((r) => r.id))];

  let purgedCandidates = 0;
  let purgedJobs = 0;

  if (candidateIds.length) {
    purgedCandidates = await SpecialistCandidate.destroy({
      where: { id: { [Op.in]: candidateIds } },
      force: true,
    });
  }

  if (jobIds.length) {
    purgedJobs = await JobApplication.destroy({
      where: { id: { [Op.in]: jobIds } },
      force: true,
    });
  }

  return {
    purgedCandidates,
    purgedJobs,
    rejectedBefore,
    quarantineBefore,
  };
}

module.exports = {
  purgeStaleTrabalheConoscoRecords,
};
