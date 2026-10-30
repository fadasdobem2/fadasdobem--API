'use strict';

/**
 * Regras PURAS do acordo e da abertura de repasse (porta FIEL de `features/finance/real-payout-agreement.ts` e
 * `real-payout-opening.ts`, B; spec 004, I9, T045). Sem I/O. Dinheiro nunca passa por ponto flutuante: o campo
 * ("1.234,56") vira o texto do contrato ("1234.56") por texto, e as somas e a divisão das parcelas são em centavos
 * inteiros (BigInt). As GRAVAÇÕES não existem nesta API (ver repasse.service.js, TODO): aqui ficam a leitura do DTO,
 * os rótulos e a validação/montagem do corpo que a escrita futura vai usar.
 */

const { moneyToCents, centsToMoney, sumMoney } = require('./helpers/dinheiro');
const { isAgendaDate, saoPauloTimestamp, shiftDateKey, dateKeyLabel } = require('./helpers/datas');
const { paymentScheduleLabel, nextScheduledPayment } = require('./helpers/calendario-pagamento');

const ZERO = 0n;
const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

// ============================== Acordo (percentual e calendário) ==============================

// O padrão do contrato quando não há percentual registrado nem abertura vigente.
const DEFAULT_RATE = '30.00';
const RATE = /^\d{1,3}\.\d{2}$/;
const LOCAL_MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;
const WEEKDAYS = new Set(['segunda', 'terca', 'quarta', 'quinta', 'sexta']);
const POLICIES = new Set(['keep', 'next-business-day']);

function isPayoutSchedule(valor) {
  if (!isRecord(valor)) return false;
  if (valor.kind === 'none') return true;
  if (valor.kind === 'weekday') return typeof valor.weekday === 'string' && WEEKDAYS.has(valor.weekday);
  return valor.kind === 'monthdays' && Array.isArray(valor.days) && valor.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31)
    && typeof valor.weekendPolicy === 'string' && POLICIES.has(valor.weekendPolicy);
}

const isPayoutPerson = (valor) => isRecord(valor) && typeof valor.accountId === 'string' && (valor.displayName === null || typeof valor.displayName === 'string');

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

// ============================== Abertura (Saldo Migrado) ==============================

const MAX_PAYOUT_LOAN_INSTALLMENTS = 1000;
const payoutLoanFrequencyLabels = { payment: 'A cada pagamento', weekly: 'Semanal', monthly: 'Mensal', custom: 'Datas escolhidas' };

const MONEY = /^-?\d{1,18}\.\d{2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['rascunho', 'confirmada', 'descartada']);
const ADJUSTMENTS = new Set(['bonus', 'outro', 'desconto']);

const isText = (v) => typeof v === 'string';
const isMoney = (v) => isText(v) && MONEY.test(v);
const isDay = (v) => isText(v) && DAY.test(v);
const isInstallment = (v) => isRecord(v) && isDay(v.date) && isMoney(v.amount);
const isDebt = (v) => isRecord(v) && isText(v.id) && (v.kind === 'loan' || v.kind === 'advance') && isMoney(v.remaining)
  && (v.originalDeliveryOn === null || isDay(v.originalDeliveryOn)) && isText(v.sheetRef) && isText(v.status)
  && (v.corrects === null || isText(v.corrects)) && Array.isArray(v.installments) && v.installments.every(isInstallment);
const isAdjustment = (v) => isRecord(v) && isText(v.id) && isText(v.kind) && ADJUSTMENTS.has(v.kind) && isMoney(v.amount)
  && isText(v.description) && isDay(v.date);
const isDifference = (v) => isRecord(v) && isText(v.id) && isText(v.description) && (v.amount === null || isMoney(v.amount))
  && (v.resolvedAt === null || isText(v.resolvedAt)) && (v.resolvedBy === null || isPayoutPerson(v.resolvedBy));

function isOpening(v) {
  if (!isRecord(v) || !isText(v.id) || !isText(v.tarotId) || !Number.isInteger(v.revision) || !isText(v.status) || !STATUSES.has(v.status)) return false;
  if (!(v.corrects === null || Number.isInteger(v.corrects)) || !(v.correctionReason === null || isText(v.correctionReason))) return false;
  const ultimo = v.lastPayment;
  if (!isRecord(ultimo) || !isDay(ultimo.paidOn) || !isMoney(ultimo.amount) || !isText(ultimo.sheetRef)) return false;
  if (!isText(v.settledThrough) || !LOCAL_MOMENT.test(v.settledThrough) || !isText(v.migrationCut) || !LOCAL_MOMENT.test(v.migrationCut)) return false;
  if (!isMoney(v.remainingBalance) || !(v.remainingBalanceNote === null || isText(v.remainingBalanceNote)) || !isText(v.rate) || !RATE.test(v.rate)) return false;
  if (!Array.isArray(v.openAdjustments) || !v.openAdjustments.every(isAdjustment) || !Array.isArray(v.debts) || !v.debts.every(isDebt)) return false;
  if (!Array.isArray(v.differences) || !v.differences.every(isDifference)) return false;
  return isPayoutPerson(v.enteredBy) && isText(v.enteredAt) && (v.confirmedBy === null || isPayoutPerson(v.confirmedBy)) && (v.confirmedAt === null || isText(v.confirmedAt));
}

/** Confere a forma do DTO `{ current, draft, revisions[] }`; devolve o corpo ou null. */
function parseOpenings(body) {
  if (!isRecord(body) || !('current' in body) || !('draft' in body) || !Array.isArray(body.revisions)) return null;
  const valido = (body.current === null || isOpening(body.current)) && (body.draft === null || isOpening(body.draft)) && body.revisions.every(isOpening);
  return valido ? body : null;
}

// Cada revisão só avança (rascunho, depois confirmada ou descartada) e novas só se somam: a soma diz qual leitura é a mais nova.
const progress = (dados) => dados.revisions.reduce((soma, item) => soma + (item.status === 'rascunho' ? 1 : 2), 0);

/** Entre a última leitura e a feita logo depois de uma gravação, a mais nova; no empate, a leitura. */
function newestOpenings(read, written) {
  return written !== null && progress(written) > progress(read) ? written : read;
}

// --- o dinheiro ---

const FIELD_MONEY = /^\d+(?:\.\d{3})*(?:,\d{1,2})?$/;

/** "1.234,5" como o contrato o quer ("1234.50"), ou null. Só o saldo e a pendência aceitam sinal (`signed`). */
function moneyFromField(texto, { signed = false } = {}) {
  const compacto = texto.trim().replace(/\s/g, '');
  const negativo = signed && compacto.startsWith('-');
  const digitos = negativo ? compacto.slice(1) : compacto;
  if (!FIELD_MONEY.test(digitos)) return null;
  const [inteiro, fracao = ''] = digitos.replace(/\./g, '').split(',');
  const normalizado = inteiro.replace(/^0+(?=\d)/, '');
  if (normalizado.length > 18) return null;
  const valor = `${normalizado}.${fracao.padEnd(2, '0')}`;
  return negativo && valor !== '0.00' ? `-${valor}` : valor;
}

/** O texto do contrato no campo: "-1234.50" vira "-1234,50". */
const moneyToField = (valor) => valor.replace('.', ',');

// --- as parcelas de uma dívida da migração ---

const blankDebt = (key, firstDate = '') =>
  ({ key, kind: 'advance', remaining: '', originalDeliveryOn: '', sheetRef: '', count: '1', frequency: 'payment', firstDate, edited: null });

const scheduleFieldKey = (schedule) => JSON.stringify(schedule);
// As parcelas editadas valem enquanto o valor, a quantidade, o início e a frequência forem os mesmos, e o calendário
// também, quando é dele que saem as datas ("A cada pagamento").
const planKey = (debt, schedule) =>
  JSON.stringify([debt.remaining, debt.count, debt.firstDate, debt.frequency, debt.frequency === 'payment' ? scheduleFieldKey(schedule) : null]);

// As datas da programação, como o editor aprovado v553 as gera, sem o valor.
function planDates(count, firstDate, frequency, schedule) {
  const dates = [];
  const year = Number(firstDate.slice(0, 4));
  const month = Number(firstDate.slice(5, 7)) - 1;
  const anchorDay = Number(firstDate.slice(8, 10));
  let paymentDate = firstDate;
  for (let index = 0; index < count; index++) {
    if (frequency === 'custom') dates.push(index === 0 ? firstDate : '');
    else if (frequency === 'weekly') dates.push(shiftDateKey(firstDate, index * 7));
    else if (frequency === 'monthly') {
      const alvo = new Date(`${firstDate}T12:00:00Z`);
      alvo.setUTCFullYear(year, month + index + 1, 0);
      alvo.setUTCDate(Math.min(anchorDay, alvo.getUTCDate()));
      dates.push(alvo.toISOString().slice(0, 10));
    } else {
      const proxima = schedule ? nextScheduledPayment(schedule, paymentDate) : null;
      if (!proxima) return null;
      dates.push(proxima);
      paymentDate = shiftDateKey(proxima, 1);
    }
  }
  return dates;
}

/** As parcelas na tela: as editadas, ou as geradas dividindo o restante em centavos, com o centavo a mais nas últimas. */
function debtPlan(debt, schedule) {
  const remaining = moneyFromField(debt.remaining);
  const count = Number(debt.count);
  let rows = [];
  let error = null;
  if (debt.edited && debt.edited.plan === planKey(debt, schedule)) rows = debt.edited.rows;
  else if (remaining === null || moneyToCents(remaining) <= ZERO) error = 'Informe o valor que faltava devolver para conferir as parcelas.';
  else if (!Number.isInteger(count) || count < 1 || count > MAX_PAYOUT_LOAN_INSTALLMENTS) error = `Informe de 1 a ${MAX_PAYOUT_LOAN_INSTALLMENTS} parcelas.`;
  else if (BigInt(count) > moneyToCents(remaining)) error = 'Cada parcela precisa ter pelo menos R$ 0,01.';
  else if (!isAgendaDate(debt.firstDate)) error = 'Escolha a data do primeiro desconto.';
  else {
    const dates = planDates(count, debt.firstDate, debt.frequency, schedule);
    if (dates === null) error = 'Não foi possível definir todas as datas pelo calendário de pagamento. Escolha Datas escolhidas e informe as datas combinadas.';
    else {
      const total = moneyToCents(remaining);
      const size = BigInt(count);
      const base = total / size;
      const extra = Number(total % size);
      rows = dates.map((date, index) => ({ date, amount: moneyToField(centsToMoney(base + (index >= count - extra ? 1n : ZERO))) }));
    }
  }
  const amounts = rows.map((row) => moneyFromField(row.amount));
  const total = amounts.every((a) => a !== null) ? sumMoney(amounts) : null;
  return { rows, error, total, remaining, balanced: total !== null && remaining !== null && total === remaining };
}

/** Uma data ou um valor de parcela editado, como no editor v553: mudar uma data passa a "Datas escolhidas". */
function editInstallment(debt, schedule, index, field, valor) {
  const rows = debtPlan(debt, schedule).rows.map((row, at) => (at === index ? { ...row, [field]: valor } : { ...row }));
  const next = field === 'date' ? { ...debt, frequency: 'custom', firstDate: index === 0 ? valor : debt.firstDate } : debt;
  return { ...next, edited: { plan: planKey(next, schedule), rows } };
}

/** A frequência escolhida: "Datas escolhidas" mantém as parcelas da tela para editar; as outras geram de novo. */
function chooseFrequency(debt, schedule, frequency) {
  const rows = debtPlan(debt, schedule).rows;
  const next = { ...debt, frequency };
  if (frequency === 'custom' && rows.length) return { ...next, edited: { plan: planKey(next, schedule), rows: rows.map((row) => ({ ...row })) } };
  return frequency === debt.frequency ? next : { ...next, edited: null };
}

// --- o formulário ---

const blankAdjustment = (key) => ({ key, kind: 'bonus', date: '', amount: '', description: '' });
const blankDifference = (key) => ({ key, description: '', amount: '' });

/** O formulário de uma abertura nova: o corte às 6h de hoje (D5) e o percentual em vigor. */
const blankForm = ({ today, rate }) => ({
  lastPaidOn: '', lastAmount: '', lastSheetRef: '', settledDay: '', migrationCut: `${today}T06:00`, rate: rateFieldValue(rate),
  balance: '', balanceNote: '', adjustments: [], debts: [], differences: [], reason: '',
});

/** As dívidas que a revisão mostra: sem as que uma correção na mesma revisão substituiu, na ordem em que vieram. */
const liveDebts = (opening) => opening.debts.filter((debt) => !opening.debts.some((outra) => outra.corrects === debt.id));

/** A correção parte da revisão como foi gravada, com as dívidas na mesma ordem, que a correção pareia por posição. */
function formFromOpening(opening) {
  return {
    lastPaidOn: opening.lastPayment.paidOn, lastAmount: moneyToField(opening.lastPayment.amount), lastSheetRef: opening.lastPayment.sheetRef,
    settledDay: shiftDateKey(opening.settledThrough.slice(0, 10), -1), migrationCut: opening.migrationCut.slice(0, 16), rate: rateFieldValue(opening.rate),
    balance: moneyToField(opening.remainingBalance), balanceNote: opening.remainingBalanceNote ?? '',
    adjustments: opening.openAdjustments.map((item) => ({ key: item.id, kind: item.kind, date: item.date, amount: moneyToField(item.amount.replace('-', '')), description: item.description })),
    debts: liveDebts(opening).map((debt) => {
      const form = {
        key: debt.id, kind: debt.kind, remaining: moneyToField(debt.remaining), originalDeliveryOn: debt.originalDeliveryOn ?? '', sheetRef: debt.sheetRef,
        count: String(debt.installments.length), frequency: 'custom', firstDate: (debt.installments[0] && debt.installments[0].date) ?? '', edited: null,
      };
      return { ...form, edited: { plan: planKey(form, null), rows: debt.installments.map((item) => ({ date: item.date, amount: moneyToField(item.amount) })) } };
    }),
    differences: opening.differences.map((item) => ({ key: item.id, description: item.description, amount: item.amount === null ? '' : moneyToField(item.amount) })),
    reason: '',
  };
}

const shortDay = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** A frase ao lado do último dia operacional quitado. */
const settledThroughLabel = (settledDay) => `Consultas iniciadas até ${shortDay(shiftDateKey(settledDay, 1))} às 6h estão quitadas.`;

const refuse = (problem) => ({ problem });
const trimmed = (texto, max) => {
  const valor = texto.trim();
  return valor.length > 0 && valor.length <= max ? valor : null;
};

/**
 * O corpo do contrato para lançar ou corrigir, sem `operationKey`, ou o que falta, com as regras que o servidor confere
 * de novo: o período quitado antes do corte, o saldo presente (mesmo zero), as parcelas de cada dívida somando o restante
 * e nenhuma antes do dia do corte (D8). O desconto em aberto vai negativo, como o valor com sinal do data-model.
 */
function openingRequest(form, { tarotId, correcting, schedule = null }) {
  const reason = correcting ? trimmed(form.reason, 500) : null;
  if (correcting && reason === null) return refuse('Informe o motivo da correção, com até 500 caracteres.');
  const lastAmount = moneyFromField(form.lastAmount);
  if (!isAgendaDate(form.lastPaidOn) || lastAmount === null) return refuse('Informe a data e o valor do último pagamento.');
  const lastSheetRef = trimmed(form.lastSheetRef, 200);
  if (lastSheetRef === null) return refuse('Informe a linha da planilha do último pagamento.');
  if (!isAgendaDate(form.settledDay)) return refuse('Informe o último dia operacional quitado.');
  const migrationCut = `${form.migrationCut}:00`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(form.migrationCut) || !isAgendaDate(form.migrationCut.slice(0, 10))) return refuse('Informe a data e a hora do corte da migração.');
  const settledThrough = `${shiftDateKey(form.settledDay, 1)}T06:00:00`;
  if (settledThrough >= migrationCut) return refuse('O período quitado precisa terminar antes do corte da migração.');
  const rate = rateFromField(form.rate);
  if (rate === null) return refuse('Informe o percentual conferido entre 0 e 100, com até duas casas decimais.');
  const remainingBalance = moneyFromField(form.balance, { signed: true });
  if (remainingBalance === null) return refuse('Informe o saldo remanescente, mesmo que seja 0,00.');
  const balanceNote = form.balanceNote.trim();
  if (balanceNote.length > 2000) return refuse('A origem do saldo tem até 2000 caracteres.');

  const openAdjustments = [];
  for (const [index, item] of form.adjustments.entries()) {
    const amount = moneyFromField(item.amount);
    const description = trimmed(item.description, 500);
    if (!isAgendaDate(item.date) || amount === null || moneyToCents(amount) <= ZERO || description === null) return refuse(`Confira a data, o valor e a descrição do ajuste ${index + 1}.`);
    openAdjustments.push({ kind: item.kind, amount: item.kind === 'desconto' ? `-${amount}` : amount, description, date: item.date });
  }

  const cutDay = form.migrationCut.slice(0, 10);
  const debts = [];
  for (const [index, debt] of form.debts.entries()) {
    const label = `${debt.kind === 'loan' ? 'do empréstimo' : 'do adiantamento'} ${index + 1}`;
    const plan = debtPlan(debt, schedule);
    if (plan.remaining === null || moneyToCents(plan.remaining) <= ZERO) return refuse(`Informe o valor que faltava devolver ${label}.`);
    const sheetRef = trimmed(debt.sheetRef, 200);
    if (sheetRef === null) return refuse(`Informe a linha da planilha ${label}.`);
    if (debt.originalDeliveryOn && !isAgendaDate(debt.originalDeliveryOn)) return refuse(`Confira a data original da entrega ${label}.`);
    if (!plan.rows.length) return refuse(plan.error ?? `Programe as parcelas ${label}.`);
    const installments = [];
    for (const [at, row] of plan.rows.entries()) {
      const amount = moneyFromField(row.amount);
      if (!isAgendaDate(row.date) || amount === null || moneyToCents(amount) <= ZERO) return refuse(`Confira a data e o valor da parcela ${at + 1} ${label}.`);
      if (row.date < cutDay) return refuse(`A parcela ${at + 1} ${label} não pode ser antes do dia do corte da migração.`);
      installments.push({ date: row.date, amount });
    }
    if (!plan.balanced) return refuse(`A soma das parcelas ${label} precisa ser igual ao valor que faltava devolver.`);
    debts.push({ kind: debt.kind, remaining: plan.remaining, originalDeliveryOn: debt.originalDeliveryOn || null, sheetRef, installments });
  }

  const differences = [];
  for (const [index, item] of form.differences.entries()) {
    const description = trimmed(item.description, 500);
    const amount = item.amount.trim() ? moneyFromField(item.amount, { signed: true }) : null;
    if (description === null || (item.amount.trim() && amount === null)) return refuse(`Confira a descrição e o valor da diferença ${index + 1}.`);
    differences.push({ description, amount });
  }

  return {
    fields: {
      tarotId, lastPayment: { paidOn: form.lastPaidOn, amount: lastAmount, sheetRef: lastSheetRef },
      settledThrough, remainingBalance, remainingBalanceNote: balanceNote || null, migrationCut, rate,
      openAdjustments, debts, differences, ...(reason === null ? {} : { reason }),
    },
  };
}

// --- a leitura de uma revisão ---

function revisionTag(opening, current) {
  if (opening.status === 'descartada') return 'Descartada';
  if (opening.status === 'rascunho') return 'Rascunho';
  return current && current.id === opening.id ? 'Vigente' : 'Substituída';
}

/** Os quatro cartões do resumo: o saldo, os adicionais e os descontos em aberto e as dívidas a recuperar. */
function openingTotals(opening) {
  const valores = opening.openAdjustments.map((item) => item.amount);
  return {
    balance: opening.remainingBalance,
    additions: sumMoney(valores.filter((v) => !v.startsWith('-'))),
    discounts: sumMoney(valores.filter((v) => v.startsWith('-')).map((v) => v.slice(1))),
    debts: sumMoney(liveDebts(opening).map((debt) => debt.remaining)),
  };
}

/** Um instante local do contrato ("2026-10-24T06:00:00") como "24/10/2026 06:00". */
const localMomentText = (local) => `${dateKeyLabel(local.slice(0, 10))} ${local.slice(11, 16)}`;
/** Um instante UTC da resposta como a tela o diz, em São Paulo: "24/10/2026 14:32". */
const momentLabel = (iso) => localMomentText(saoPauloTimestamp(new Date(iso)));
/** O fim do período quitado como a tela o diz: "Quitado até 20/10 às 6h". */
const settledThroughText = (settledThrough) => `${shortDay(settledThrough.slice(0, 10))} às 6h`;

module.exports = {
  DEFAULT_RATE, MAX_PAYOUT_LOAN_INSTALLMENTS, payoutLoanFrequencyLabels,
  isPayoutSchedule, isPayoutPerson, parseAgreement, rateLabel, rateFieldValue, rateFromField, scheduleFromField, scheduleToField,
  scheduleProblem, scheduleLabel, agreementChanges, commissionBody, scheduleBody, operationKeys, localMomentLabel, newestAgreement,
  personName, agreementHistory,
  parseOpenings, newestOpenings, moneyFromField, moneyToField, sumMoney, blankDebt, debtPlan, editInstallment, chooseFrequency,
  blankAdjustment, blankDifference, blankForm, liveDebts, formFromOpening, settledThroughLabel, openingRequest, revisionTag, openingTotals,
  localMomentText, momentLabel, settledThroughText,
};
