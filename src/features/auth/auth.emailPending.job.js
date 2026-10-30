const { syncEmailPendingReviewFlags } = require('./auth.service');
const { withDistributedLock } = require('../../providers/redis/distributed-lock');

/** 5 min cobre a duração do job; muito menor que o intervalo (6h) → lock liberto bem antes do próximo tick. */
const LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * JOB R7 — elevação de marcação para contas há +7 dias sem confirmação de e-mail.
 * Em N instâncias, só uma corre por tick (lock distribuído). Sem Redis → instância única.
 */
function scheduleEmailPendingReviewJob() {
  const tick = () =>
    withDistributedLock('job:email-pending-review', LOCK_TTL_MS, () =>
      syncEmailPendingReviewFlags()
    ).catch(() => {
      /* evita derrubar o processo; logs podem acrescentarse em produção */
    });
  tick();
  return setInterval(tick, 6 * 60 * 60 * 1000);
}

module.exports = {
  scheduleEmailPendingReviewJob,
};
