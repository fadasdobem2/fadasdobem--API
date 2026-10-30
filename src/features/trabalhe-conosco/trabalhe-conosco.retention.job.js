'use strict';

const { purgeStaleTrabalheConoscoRecords } = require('./trabalhe-conosco.retention.service');
const { withDistributedLock } = require('../../providers/redis/distributed-lock');

/** 5 min cobre o expurgo; muito menor que o intervalo (24h). */
const LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Expurgo LGPD de currículos Trabalhe Conosco — diário.
 * Em N instâncias, só uma corre por tick (lock distribuído). Sem Redis → instância única.
 */
function scheduleTrabalheConoscoRetentionJob() {
  const tick = () =>
    withDistributedLock('job:trabalhe-conosco-retention', LOCK_TTL_MS, () =>
      purgeStaleTrabalheConoscoRecords()
    )
      .then((r) => {
        if (!r || r.ran === false) return; // não fomos o dono do lock neste tick
        r = r.result ?? r;
        if (r.purgedCandidates || r.purgedJobs) {
          console.info(
            `[trabalhe-conosco.retention] expurgados: ${r.purgedCandidates} candidatas, ${r.purgedJobs} vagas`
          );
        }
      })
      .catch((err) => {
        console.warn('[trabalhe-conosco.retention] falha no expurgo:', err.message);
      });

  tick();
  return setInterval(tick, 24 * 60 * 60 * 1000);
}

module.exports = {
  scheduleTrabalheConoscoRetentionJob,
};
