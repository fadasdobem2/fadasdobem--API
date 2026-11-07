'use strict';

/** Acordo (percentual e calendário): leitura do DTO, rótulos, corpos de gravação e histórico. */

const { dateKeyLabel } = require('./helpers/datas');
const { paymentScheduleLabel } = require('./helpers/calendario-pagamento');
const { isRecord, RATE, LOCAL_MOMENT, isPayoutPerson } = require('./repasse.model.comum');

// O padrão do contrato quando não há percentual registrado nem abertura vigente.
const DEFAULT_RATE = '30.00';
const WEEKDAYS = new Set(['segunda', 'terca', 'quarta', 'quinta', 'sexta']);
const POLICIES = new Set(['keep', 'next-business-day']);

function isPayoutSchedule(valor) {
  if (!isRecord(valor)) return false;
  if (valor.kind === 'none') return true;
  if (valor.kind === 'weekday') return typeof valor.weekday === 'string' && WEEKDAYS.has(valor.weekday);
  return valor.kind === 'monthdays' && Array.isArray(valor.days) && valor.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31)
    && typeof valor.weekendPolicy === 'string' && POLICIES.has(valor.weekendPolicy);
}


const isRegistered = (valor) => isRecord(valor) && typeof valor.since === 'string' && LOCAL_MOMENT.test(valor.since)
  && (valor.reason === null || typeof valor.reason === 'string') && isPayoutPerson(valor.by) && typeof valor.recordedAt === 'string';

const isSince = (valor) => valor === null || (typeof valor === 'string' && LOCAL_MOMENT.test(valor));

/** Confere a forma do DTO do acordo; devolve o próprio corpo ou null. */
function parseAgreement(body) {
  if (!isRecord(body) || !isRecord(body.commission) || !isRecord(body.schedule)) return null;
  const { commission, schedule } = body;
  if (typeof commission.current !== 'string' || !RATE.test(commission.current) || !isSince(commission.since) || !Array.isArray(commission.history)) return null;
  if (!commission.history.every((item) => isRegistered(item) && typeof item.value === 'string' && RATE.test(item.value))) return null;
  if (!(schedule.current === null || isPayoutSchedule(schedule.current)) || !isSince(schedule.since) || !Array.isArray(schedule.history)) return null;
  if (!schedule.history.every((item) => isRegistered(item) && isPayoutSchedule(item.schedule))) return null;
  return body;
}

/** "30.00" como a tela o diz: "30%", "35,5%", com o símbolo colado ao valor e sem casas zeradas. Só texto, sem conta. */
function rateLabel(rate) {
  const [inteiro, fracao = ''] = rate.split('.');
  const decimais = fracao.replace(/0+$/, '');
  return `${inteiro}${decimais ? `,${decimais}` : ''}%`;
}

/** O valor inicial do campo aprovado (`CommissionRateField`, numérico). */
const rateFieldValue = (rate) => Number(rate);

/**
 * O número do campo como a taxa do contrato ("35.00"), ou null fora de 0 a 100 ou com mais de 2 casas. O campo aprovado
 * entrega um número; com até 2 casas conferidas, `toFixed(2)` devolve exatamente o decimal digitado, e o servidor
 * confere a taxa de novo, em texto (ver repasse.validacao.js).
 */
function rateFromField(valor) {
  if (!Number.isFinite(valor) || valor < 0 || valor > 100) return null;
  const centesimos = Math.round(valor * 100);
  if (Math.abs(centesimos - valor * 100) > 1e-6) return null;
  return valor.toFixed(2);
}

/** O campo aprovado usa null para "A combinar"; o contrato, `{ kind: 'none' }`. */
function scheduleFromField(valor) {
  if (valor === null) return { kind: 'none' };
  if (valor.kind === 'weekday') return { kind: 'weekday', weekday: valor.weekday };
  return { kind: 'monthdays', days: [...valor.days], weekendPolicy: valor.weekendPolicy ?? 'keep' };
}

function scheduleToField(valor) {
  if (valor === null || valor.kind === 'none') return null;
  if (valor.kind === 'weekday') return { kind: 'weekday', weekday: valor.weekday };
  return { kind: 'monthdays', days: [...valor.days], weekendPolicy: valor.weekendPolicy };
}

/** O que a tela recusa antes de enviar, com as regras do servidor. */
const scheduleProblem = (valor) => (valor.kind === 'monthdays' && valor.days.length === 0 ? 'Escolha ao menos um dia do mês.' : null);

/** O rótulo do calendário, o mesmo do Financeiro de exemplo. Sem registro é "a combinar". */
const scheduleLabel = (valor) => paymentScheduleLabel(scheduleToField(valor) ?? undefined);

// Pelo conteúdo, sem depender da ordem das chaves da resposta.
const scheduleKey = (valor) => (valor.kind === 'weekday' ? `weekday:${valor.weekday}`
  : valor.kind === 'monthdays' ? `monthdays:${valor.days.join(',')}:${valor.weekendPolicy}` : 'none');
const sameSchedule = (a, b) => scheduleKey(a) === scheduleKey(b);

/** Só o que mudou em relação ao acordo lido vai ao servidor; o calendário sem registro equivale a "A combinar". */
function agreementChanges(agreement, form) {
  const atual = agreement.schedule.current ?? { kind: 'none' };
  return {
    commission: form.rate === agreement.commission.current ? null : form.rate,
    schedule: sameSchedule(form.schedule, atual) ? null : form.schedule,
  };
}

const withReason = (motivo) => (motivo.trim() ? { reason: motivo.trim() } : {});
const commissionBody = (rate, reason, operationKey) => ({ rate, ...withReason(reason), operationKey });
const scheduleBody = (schedule, reason, operationKey) => ({ schedule, ...withReason(reason), operationKey });

/**
 * A chave de cada gravação. Um pedido que ficou sem resposta é reenviado com a mesma chave, e o servidor devolve a
 * resposta guardada sem gravar de novo; depois de uma resposta, ou com outro corpo, a chave é nova.
 */
function operationKeys(make) {
  let pending = null;
  return {
    next(body) {
      const texto = JSON.stringify(body);
      if (!pending || pending.body !== texto) pending = { body: texto, key: make() };
      return pending.key;
    },
    settle() {
      pending = null;
    },
  };
}

/** "2026-10-24T14:32:10" como a tela o diz: "24/10/2026 às 14:32". */
const localMomentLabel = (local) => `${dateKeyLabel(local.slice(0, 10))} às ${local.slice(11, 16)}`;

const historyLength = (agreement) => agreement.commission.history.length + agreement.schedule.history.length;

/** Entre o acordo da última leitura e o da última gravação, o mais novo (histórico mais longo; no empate, a leitura). */
function newestAgreement(read, written) {
  return written !== null && historyLength(written) > historyLength(read) ? written : read;
}

/** Quem gravou, pelo nome da conta; sem nome, como as telas do repasse o dizem. */
const personName = (by) => (by && by.displayName) ?? 'Conta não identificada';

/**
 * As alterações do acordo, da mais nova à mais antiga, cada uma com o valor anterior: o item que vem antes (contrato).
 * Antes da primeira alteração do percentual valia o conferido na abertura vigente ou, sem abertura, o padrão de 30%.
 * Antes do primeiro calendário, nenhum.
 */
function agreementHistory(agreement, opening) {
  const rates = agreement.commission.history.map((item, index, all) => ({
    id: `rate-${index}`, field: 'Percentual de repasse', since: item.since,
    before: rateLabel(index ? all[index - 1].value : (opening && opening.rate) ?? DEFAULT_RATE), after: rateLabel(item.value),
    reason: item.reason, actorName: personName(item.by), recordedAt: item.recordedAt,
  }));
  const schedules = agreement.schedule.history.map((item, index, all) => ({
    id: `schedule-${index}`, field: 'Calendário de pagamento', since: item.since,
    before: scheduleLabel(index ? all[index - 1].schedule : null), after: scheduleLabel(item.schedule),
    reason: item.reason, actorName: personName(item.by), recordedAt: item.recordedAt,
  }));
  return [...rates, ...schedules].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
}

module.exports = {
  DEFAULT_RATE, isPayoutSchedule, parseAgreement, rateLabel, rateFieldValue, rateFromField, scheduleFromField, scheduleToField,
  scheduleProblem, scheduleLabel, agreementChanges, commissionBody, scheduleBody, operationKeys, localMomentLabel, newestAgreement,
  personName, agreementHistory,
};
