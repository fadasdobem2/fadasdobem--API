'use strict';

/** Apuração do tarólogo (T039): composição, saldo, período apurado e cancelamentos pendentes. */

const { moneyToCents, centsToMoney, sumCents } = require('./helpers/dinheiro');
const { OPERATIONAL_DAY_START_HOUR, localOperationalDateKey, shiftDateKey } = require('./helpers/datas');
const { ZERO, compareText, nonNegative, minCents, normalizedMoney, negatedMoney } = require('./repasse.core.util');
const { localKey, consultationRates } = require('./repasse.core.percentual');
const { finishedConsultation, legacyConsultationBase, consultationAmount } = require('./repasse.core.base');
const { civilDate } = require('./repasse.core.calendario');
const { payoutVersion } = require('./repasse.core.versao');

const DAY_START = `${String(OPERATIONAL_DAY_START_HOUR).padStart(2, '0')}:00:00`;

function openingFlag(opening) {
  return opening === null ? 'missing' : opening.status === 'confirmada' ? 'confirmed' : 'draft';
}

/** Só a abertura confirmada gera valor (FR-030). */
function confirmedOpening(opening) {
  return opening && opening.status === 'confirmada' ? opening : null;
}

/** Situação de cancelamento por consulta. O banco guarda um pedido por consulta (uq_cancelamentos_consulta). */
function cancellationMap(cancellations) {
  const result = new Map();
  for (const item of cancellations) {
    if (result.has(item.consultationId)) throw new Error(`Dois pedidos de cancelamento para a consulta ${item.consultationId}.`);
    result.set(item.consultationId, item.status);
  }
  return result;
}

/** Dia operacional de hoje pelo agora local que o servidor passa. */
function operationalToday(nowLocal) {
  return localOperationalDateKey(localKey(nowLocal));
}

/**
 * A consulta entra na apuração de D: início de quitado_ate (sem abertura confirmada, sem limite) até antes de D 06:00.
 * A em curso no dia operacional de hoje fica fora até terminar; a sem fim de dias anteriores entra pendente de
 * conferência pela R12 (PO, 2026-10-24). Consulta sem início não tem como ser situada no ciclo.
 */
function inAssessment(item, settledThrough, date, today) {
  if (item.startedAtLocal === null) return false;
  const at = localKey(item.startedAtLocal);
  if ((settledThrough !== null && at < settledThrough) || at >= `${date}T${DAY_START}`) return false;
  return finishedConsultation(item) || localOperationalDateKey(at) !== today;
}

/** Cancelamentos pendentes só das consultas da apuração de D (PO, 2026-10-24); pedido de consulta que não veio na leitura não conta. */
function pendingCancellations(input, opening, date, today) {
  const settledThrough = opening && localKey(opening.settledThrough);
  const consultations = new Map(input.consultations.map((item) => [item.id, item]));
  return input.cancellations.filter((item) => {
    const consultation = consultations.get(item.consultationId);
    return item.status === 'pendente' && consultation !== undefined && inAssessment(consultation, settledThrough, date, today);
  }).length;
}

/** Aviso "quitado até": D 06:00 antes de quitado_ate põe D dentro do período quitado, que não gera valor a pagar (FR-028). */
function settledNotice(opening, date) {
  const settledThrough = localKey(opening.settledThrough);
  return `${date}T${DAY_START}` < settledThrough ? settledThrough : null;
}

function validTransfers(transfers, date) {
  return transfers.filter((item) => item.status === 'valido' && item.paidOn <= date);
}

/** Último dia operacional quitado: o do instante logo antes de quitado_ate. É a data do lote do saldo de abertura. */
function lastSettledDay(settledThrough) {
  const dia = localOperationalDateKey(settledThrough);
  return settledThrough === `${dia}T${DAY_START}` ? shiftDateKey(dia, -1) : dia;
}

function consultationStatus(cancellation, amount) {
  if (cancellation === 'retirado') return 'cancellation-removed';
  if (amount === null) return 'pending-review';
  return cancellation === 'pendente' ? 'cancellation-pending' : cancellation === 'mantido' ? 'cancellation-kept' : 'normal';
}

// Na mesma data: saldo de abertura, consultas pelo início, ajustes, pagamentos e descontos de parcela.
const KIND_ORDER = { 'opening-balance': 0, consultation: 1, adjustment: 2, transfer: 3, repayment: 4 };

function lineTieKeys(line) {
  if (line.kind === 'opening-balance') return [line.openingId];
  if (line.kind === 'consultation') return [localKey(line.startedAtLocal), line.consultationId];
  if (line.kind === 'adjustment') return [line.adjustmentId];
  if (line.kind === 'transfer') return [line.transferId];
  return [line.transferId, line.debtId];
}

/** Ordem só pelos dados, para que a ordem de leitura não mude as linhas nem a versão. */
function compareLines(a, b) {
  const byDate = compareText(a.date, b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (byDate) return byDate;
  const keysA = lineTieKeys(a);
  const keysB = lineTieKeys(b);
  for (let i = 0; i < keysA.length; i++) {
    const byKey = compareText(keysA[i], keysB[i]);
    if (byKey) return byKey;
  }
  return 0;
}

/**
 * Linhas da abertura vigente em D (data-model, seção 4): o saldo remanescente, as consultas da apuração de D (início de
 * quitado_ate até antes de D 06:00, menos a em curso hoje), os ajustes válidos até D (os da abertura vigente e os sem
 * abertura), os pagamentos válidos até D e os descontos de parcela registrados neles. O desconto baixa o saldo de
 * comissões, como as linhas de repayment do extrato da v584: sem isso, a parte da comissão retida para a dívida voltaria
 * a ser cobrada como valor a pagar.
 */
function compositionLines(input, opening, date, today) {
  const settledThrough = localKey(opening.settledThrough);
  const lines = [{ kind: 'opening-balance', openingId: opening.id, date: lastSettledDay(settledThrough), amount: normalizedMoney(opening.remainingBalance) }];

  // Consulta sem início não tem como ser situada no ciclo; ela fica fora e aparece nas divergências da leitura.
  const started = input.consultations.filter((item) => item.startedAtLocal !== null);
  const rates = consultationRates({ opening, history: input.rates }, started);
  const cancellations = cancellationMap(input.cancellations);
  for (const item of started) {
    if (!inAssessment(item, settledThrough, date, today)) continue;
    const at = localKey(item.startedAtLocal);
    const cancellation = cancellations.get(item.id) ?? null;
    const base = legacyConsultationBase(item, cancellation);
    const rate = rates.get(item.id);
    const amount = consultationAmount(base, rate);
    lines.push({
      kind: 'consultation', consultationId: item.id, startedAtLocal: item.startedAtLocal, date: localOperationalDateKey(at), minutes: item.recordedMinutes,
      base: base.status === 'known' ? base.base : null, rate: rate.status === 'known' ? rate.rate : null, amount, status: consultationStatus(cancellation, amount),
    });
  }

  for (const item of input.adjustments) {
    // Só a abertura vigente conta (data-model, seção 3): ajuste de outra revisão fica fora.
    if (item.status !== 'valido' || item.date > date || (item.openingId !== null && item.openingId !== opening.id)) continue;
    lines.push({
      kind: 'adjustment', adjustmentId: item.id, adjustmentKind: item.kind, description: item.description, date: item.date,
      amount: normalizedMoney(item.amount), openingId: item.openingId,
    });
  }

  const debtKinds = new Map(input.debts.map((item) => [item.id, item.kind]));
  for (const item of validTransfers(input.transfers, date)) {
    // Como no protótipo, o pagamento feito só com desconto de parcela não gera linha de pagamento de valor zero.
    if (moneyToCents(item.amount) !== ZERO) {
      lines.push({ kind: 'transfer', transferId: item.id, date: item.paidOn, amount: negatedMoney(item.amount), periodStart: item.periodStart, periodEnd: item.periodEnd });
    }
    for (const deduction of item.deductions) {
      if (moneyToCents(deduction.amount) === ZERO) continue;
      lines.push({
        kind: 'repayment', transferId: item.id, debtId: deduction.debtId, debtKind: debtKinds.get(deduction.debtId) ?? null, date: item.paidOn,
        amount: negatedMoney(deduction.amount),
      });
    }
  }
  return lines.sort(compareLines);
}

function compositionTotals(lines, pendingCancellationCount) {
  const balance = sumCents(lines.map((line) => line.amount));
  return {
    balance: centsToMoney(balance),
    due: centsToMoney(nonNegative(balance)),
    pendingReviewCount: lines.filter((line) => line.kind === 'consultation' && line.status === 'pending-review').length,
    pendingCancellationCount,
  };
}

/**
 * Composição do tarólogo em D (FR-033). A soma das linhas é o saldo; o valor a pagar é o maior entre zero e o saldo, e o
 * saldo devedor fica visível em balance (FR-035). Consulta pendente de conferência entra sem valor e é contada. O agora
 * local separa a consulta em curso hoje; D antes do fim do período quitado sai sem linhas, com o aviso "quitado até".
 */
function payoutComposition(input, date, nowLocal) {
  civilDate(date);
  const today = operationalToday(nowLocal);
  const opening = input.opening;
  const confirmed = confirmedOpening(opening);
  const lastPayment = opening && { paidOn: opening.lastPayment.paidOn, amount: opening.lastPayment.amount, sheetRef: opening.lastPayment.sheetRef };
  const flag = { status: openingFlag(opening), id: (opening && opening.id) ?? null, lastPayment };
  const settledThrough = confirmed && settledNotice(confirmed, date);
  if (confirmed === null || settledThrough !== null) return { version: payoutVersion([]), opening: flag, settledThrough, lines: [], totals: null };
  const lines = compositionLines(input, confirmed, date, today);
  const totals = compositionTotals(lines, pendingCancellations(input, confirmed, date, today));
  return { version: payoutVersion(lines), opening: flag, settledThrough: null, lines, totals };
}

/**
 * Período apurado, como o pendingEntryRange da v584, em centavos: os créditos viram lotes por data, e pagamentos,
 * descontos de parcela e ajustes negativos consomem do mais antigo para o mais novo. O excesso abate os créditos
 * seguintes. O período declarado no pagamento não entra.
 */
function pendingPeriod(lines) {
  const lots = [];
  let first = 0;
  let overpaid = ZERO;
  for (const line of lines) {
    if (line.amount === null) continue;
    const valor = moneyToCents(line.amount);
    if (valor > ZERO) {
      const offset = minCents(valor, overpaid);
      overpaid -= offset;
      if (valor > offset) lots.push({ date: line.date, remaining: valor - offset });
      continue;
    }
    let exit = -valor;
    while (exit > ZERO && first < lots.length) {
      const used = minCents(exit, lots[first].remaining);
      lots[first].remaining -= used;
      exit -= used;
      if (lots[first].remaining === ZERO) first++;
    }
    overpaid += exit;
  }
  const pending = lots.slice(first).filter((lot) => lot.remaining > ZERO);
  return pending.length ? { start: pending[0].date, end: pending[pending.length - 1].date } : null;
}

module.exports = { DAY_START, openingFlag, confirmedOpening, operationalToday, pendingCancellations, settledNotice, compositionLines, compositionTotals, payoutComposition, pendingPeriod };
