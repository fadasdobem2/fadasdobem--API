'use strict';

/**
 * Reconciliação do fecho econômico: sessões `COMPLETED` com tarólogo e sem `economics_settled_at`
 * (processo caiu ou o fecho falhou depois do COMPLETED). O fecho é idempotente (trava a sessão,
 * confere `economics_settled_at` e usa chaves de idempotência no razão), então rodar várias vezes,
 * ou em paralelo com o fecho normal, nunca duplica cobrança nem comissão.
 */
const { Op } = require('sequelize');
const { Session } = require('../../models');
const { finalizeSessionEconomicsAfterTelecomCompletion } = require('./sessions.economics');
const { maybeApplyTechnicalFloorStrict, refreshBillableMinutesAtClose } = require('./sessions.lifecycle');

/**
 * @param {{ limit?: number, minAgeMs?: number }} [opts] `minAgeMs`: espera mínima após `ended_at`
 *   (evita disputar com o fecho em andamento; mesmo assim é seguro por idempotência).
 * @returns {Promise<{ found: number, settled: number, failed: number, failures: Array<{id:string,error:string}> }>}
 */
async function reconcileUnsettledCompletedSessions(opts = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 500);
  const minAgeMs = opts.minAgeMs === undefined ? 60000 : Math.max(0, Number(opts.minAgeMs) || 0);

  const where = {
    telecom_status: 'COMPLETED',
    economics_settled_at: { [Op.is]: null },
    specialist_id: { [Op.ne]: null },
  };
  if (minAgeMs > 0) {
    where[Op.and] = [
      { [Op.or]: [{ ended_at: { [Op.is]: null } }, { ended_at: { [Op.lte]: new Date(Date.now() - minAgeMs) } }] },
    ];
  }

  const rows = await Session.findAll({
    where,
    attributes: ['id'],
    order: [['ended_at', 'ASC']],
    limit,
    paranoid: true,
  });

  const out = { found: rows.length, settled: 0, failed: 0, failures: [] };
  for (const r of rows) {
    try {
      await refreshBillableMinutesAtClose(r.id).catch(() => {});
      await maybeApplyTechnicalFloorStrict(r.id);
      await finalizeSessionEconomicsAfterTelecomCompletion(r.id);
      out.settled += 1;
    } catch (e) {
      out.failed += 1;
      out.failures.push({ id: r.id, error: `${e?.message || e}` });
      console.error('[sessions:reconcile] fecho falhou:', r.id, e?.message || e);
    }
  }
  if (out.found > 0) {
    console.log('[sessions:reconcile]', { found: out.found, settled: out.settled, failed: out.failed });
  }
  return out;
}

module.exports = { reconcileUnsettledCompletedSessions };
