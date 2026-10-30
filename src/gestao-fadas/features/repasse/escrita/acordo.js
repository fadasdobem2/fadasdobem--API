'use strict';

/** Gravações do ACORDO: percentual e calendário (só inclusão; o `antes` da auditoria é o que vigorava por último). */

const { lerPercentuais, lerCalendarios, somente } = require('./registros');
const sql = require('./sql');

function criarAcordo({ deps, exigirTarologo, executar }) {
  return {
    percentual: (entrada) => executar({
      action: 'payout.agreement.set', entity: 'payout.commission', operationKey: entrada.operationKey, actor: entrada.actor,
      request: { tarotId: entrada.tarotId, rate: entrada.rate, reason: entrada.reason },
      check: () => exigirTarologo(entrada.tarotId),
      apply: async (ex, agora) => {
        const before = (await lerPercentuais(ex, entrada.tarotId)).pop() ?? null;
        const id = deps.novoId();
        await ex.execute(sql.INSERT_COMMISSION, [id, entrada.tarotId, entrada.rate, entrada.effectiveFrom, entrada.reason, entrada.actor.accountId, agora, entrada.operationKey]);
        return { result: somente(await lerPercentuais(ex, entrada.tarotId), id), before, reason: entrada.reason };
      },
    }),

    calendario: (entrada) => {
      const { schedule } = entrada;
      return executar({
        action: 'payout.agreement.set', entity: 'payout.schedule', operationKey: entrada.operationKey, actor: entrada.actor,
        request: { tarotId: entrada.tarotId, schedule, reason: entrada.reason },
        check: () => exigirTarologo(entrada.tarotId),
        apply: async (ex, agora) => {
          const before = (await lerCalendarios(ex, entrada.tarotId)).pop() ?? null;
          const id = deps.novoId();
          await ex.execute(sql.INSERT_SCHEDULE, [
            id, entrada.tarotId, schedule.kind, schedule.kind === 'weekday' ? schedule.weekday : null, schedule.kind === 'monthdays' ? schedule.days.join(',') : null,
            schedule.kind === 'monthdays' ? schedule.weekendPolicy : null, entrada.effectiveFrom, entrada.reason, entrada.actor.accountId, agora, entrada.operationKey,
          ]);
          return { result: somente(await lerCalendarios(ex, entrada.tarotId), id), before, reason: entrada.reason };
        },
      });
    },
  };
}

module.exports = { criarAcordo };
