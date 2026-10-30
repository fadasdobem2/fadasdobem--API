'use strict';

/**
 * Núcleo puro da apuração do repasse (porta FIEL de `features/finance/real-payout-core.ts`, B; spec 004, etapa 2).
 * Sem I/O: o serviço lê o legado e as `gf_repasse_*` na borda e passa os dados para cá. Dinheiro em centavos inteiros
 * (BigInt), nunca em ponto flutuante: entra o texto DECIMAL e sai o texto "123.45" (R13). Instantes locais de São
 * Paulo chegam como texto, com espaço (tabelas gf_) ou "T" (leitor do legado), e são comparados como texto depois de
 * normalizados, sem fuso (R4). Datas civis "AAAA-MM-DD" também se comparam como texto. A data de referência entra por
 * argumento, como o agora local que separa a consulta em curso: o núcleo não lê o relógio nem gera identificador.
 *
 * Os nomes das funções e dos campos do DTO são os da B de propósito (paridade e conferência lado a lado).
 */

const { createHash } = require('crypto');
const { moneyToCents, centsToMoney, sumCents } = require('./helpers/dinheiro');
const { OPERATIONAL_DAY_START_HOUR, localOperationalDateKey, shiftDateKey } = require('./helpers/datas');
const { legacyLocalDateTime } = require('./helpers/valores-legado');

const ZERO = 0n;
const HALF = 5000n;
const SCALE = 10000n;
const MAX_RATE = 10000n;

/** Percentual DECIMAL(5,2) em centésimos de ponto: "30.00" vira 3000. De 0 a 100; zero é acordo válido. */
function rateHundredths(rate) {
  const m = /^(\d{1,3})\.(\d{2})$/.exec(rate);
  const valor = m ? BigInt(m[1] + m[2]) : null;
  if (valor === null || valor > MAX_RATE) throw new Error(`Percentual inválido: ${rate}`);
  return valor;
}

/** round_half_up(base × percentual / 100), em centavos. A base nunca é negativa (R12). */
function commissionCents(baseCents, rate) {
  if (baseCents < ZERO) throw new RangeError('A base do repasse não pode ser negativa.');
  return (baseCents * rateHundredths(rate) + HALF) / SCALE;
}

/** Instante local com "T", pelo mesmo leitor do DATETIME do legado; formato ou data impossível é erro. Fração zerada é o mesmo instante. */
function localKey(texto) {
  const chave = legacyLocalDateTime(texto);
  if (chave === null) throw new Error(`Instante local inválido: ${texto}`);
  return chave.replace(/\.0+$/, '');
}

// ---- Percentual de cada consulta (R11) ----

function sortedChanges(history) {
  const changes = history.map((item) => ({ from: localKey(item.effectiveFrom), rate: item.rate }));
  changes.sort((a, b) => a.from.localeCompare(b.from));
  changes.forEach((item) => rateHundredths(item.rate));
  for (let i = 1; i < changes.length; i++) {
    if (changes[i].from === changes[i - 1].from) throw new Error(`Duas alterações de percentual em ${changes[i].from}.`);
  }
  return changes;
}

/** Percentual vigente no instante local: antes de quitado_ate não há; depois, a última alteração até ele, ou a abertura. */
function rateAt(settledThrough, openingRate, changes, at) {
  if (at < settledThrough) return null;
  let rate = openingRate;
  for (const item of changes) {
    if (item.from > at) break;
    rate = item.rate;
  }
  return rate;
}

/**
 * Percentual de cada consulta pelo seu início (FR-023, R11). O histórico nunca é editado, então o resultado de uma
 * consulta já iniciada não muda. A consulta fica pendente de conferência quando começou depois de uma alteração no
 * mesmo dia operacional e o mesmo par cliente e tarólogo teve, naquele dia e antes da alteração, uma consulta com
 * outro percentual: pode ser a continuação dela. Sem cliente identificado não há par.
 *
 * agreement: { opening: { settledThrough, rate }, history: [{ rate, effectiveFrom }] }
 * consultations: [{ id, clientId, startedAtLocal }]  ->  Map id -> { status: 'known', rate } | { status: 'not-informed' }
 *   | { status: 'pending-review', reason: 'continuation' }
 */
function consultationRates(agreement, consultations) {
  const settledThrough = localKey(agreement.opening.settledThrough);
  const openingRate = agreement.opening.rate;
  rateHundredths(openingRate);
  // O percentual conferido vale desde quitado_ate; alteração com vigência anterior é do período quitado (PO, 2026-10-24).
  const changes = sortedChanges(agreement.history).filter((change) => change.from >= settledThrough);
  const items = consultations.map((item) => {
    const at = localKey(item.startedAtLocal);
    const rate = rateAt(settledThrough, openingRate, changes, at);
    return { ...item, at, day: localOperationalDateKey(at), rate, hundredths: rate === null ? null : rateHundredths(rate) };
  });

  const result = new Map();
  for (const item of items) {
    if (item.rate === null) {
      result.set(item.id, { status: 'not-informed' });
      continue;
    }
    const continuation = item.clientId !== null && items.some((origin) =>
      origin.clientId === item.clientId && origin.day === item.day && origin.at < item.at && origin.hundredths !== item.hundredths
      && changes.some((change) => origin.at < change.from && change.from <= item.at));
    result.set(item.id, continuation ? { status: 'pending-review', reason: 'continuation' } : { status: 'known', rate: item.rate });
  }
  return result;
}

// ---- Base das consultas legadas (R12) ----

/** Tabela R12, na ordem: vale a primeira linha cujas condições batem todas. Mudar a regra é decisão registrada (VI). */
const LEGACY_BASE_RULES = [
  { when: { cancellation: ['retirado'] }, base: 'zero' },
  { when: { cancellation: ['nenhum', 'pendente', 'mantido'], finished: [true], minutes: [true], amount: [true], bonus: [false], abatement: [false] }, base: 'recorded-amount' },
  // Com bônus, com abatimento, com valor 0 ou nulo, sem minutos, ou "manter pagamento" com bônus: sem valor presumido (FR-025).
  { when: {}, base: 'pending-review' },
];
const RECORDED_AMOUNT_RULE = LEGACY_BASE_RULES.find((rule) => rule.base === 'recorded-amount');

function positiveMoney(valor) {
  return valor !== null && moneyToCents(valor) > ZERO;
}

/** Finalizada pela R4: com fim e com minutagem registrados. */
function finishedConsultation(consultation) {
  return consultation.endedAtLocal !== null && consultation.recordedMinutes !== null;
}

function failedConditions(rule, facts) {
  return Object.entries(rule.when).filter(([chave, aceitos]) => !aceitos.includes(facts[chave])).map(([chave]) => chave);
}

/**
 * Base da consulta legada (FR-024, R12). Nunca usa outro campo do cadastro do tarólogo.
 * consultation: { endedAtLocal, recordedMinutes, recordedAmount, appliedBonusMinutes, recordedAbatement }
 * cancellation: 'pendente' | 'mantido' | 'retirado' | null
 */
function legacyConsultationBase(consultation, cancellation) {
  const facts = {
    cancellation: cancellation ?? 'nenhum',
    finished: finishedConsultation(consultation),
    minutes: (consultation.recordedMinutes ?? 0) > 0,
    amount: positiveMoney(consultation.recordedAmount),
    // vlBonus nulo ou 0 é sem bônus; abatimento nulo ou 0 é sem abatimento.
    bonus: (consultation.appliedBonusMinutes ?? 0) > 0,
    abatement: consultation.recordedAbatement !== null && moneyToCents(consultation.recordedAbatement) !== ZERO,
  };
  const rule = LEGACY_BASE_RULES.find((item) => failedConditions(item, facts).length === 0);
  if (rule.base === 'zero') return { status: 'known', base: '0.00', rule: 'removed' };
  if (rule.base === 'recorded-amount') return { status: 'known', base: consultation.recordedAmount, rule: 'recorded-amount' };
  // O motivo da pendência são as condições da linha de valor_consulta que a consulta não cumpre.
  const reasons = failedConditions(RECORDED_AMOUNT_RULE, facts).filter((chave) => chave !== 'cancellation');
  return { status: 'pending-review', reasons };
}

/**
 * Repasse da consulta (data-model, seção 4): base × percentual, meio para cima em centavos. Retirado vale zero.
 * Sem percentual informado, a consulta é do histórico quitado e não gera valor; pendente de conferência fica sem valor.
 */
function consultationAmount(base, rate) {
  if (rate.status === 'not-informed') return null;
  if (base.status === 'known' && base.rule === 'removed') return '0.00';
  if (base.status !== 'known' || rate.status !== 'known') return null;
  return centsToMoney(commissionCents(moneyToCents(base.base), rate.rate));
}

// ---- Apuração do tarólogo (T039): composição, saldo, período, data prevista, dívidas e versão ----

const DAY_START = `${String(OPERATIONAL_DAY_START_HOUR).padStart(2, '0')}:00:00`;

function compareText(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function nonNegative(centavos) {
  return centavos > ZERO ? centavos : ZERO;
}
function minCents(...valores) {
  return valores.reduce((baixo, valor) => (valor < baixo ? valor : baixo));
}
function normalizedMoney(texto) {
  return centsToMoney(moneyToCents(texto));
}
function negatedMoney(texto) {
  return centsToMoney(-moneyToCents(texto));
}

function isCivilDate(texto) {
  return /^\d{4}-\d{2}-\d{2}$/.test(texto) && shiftDateKey(texto, 0) === texto;
}
function civilDate(texto) {
  if (!isCivilDate(texto)) throw new Error(`Data inválida: ${texto}`);
  return texto;
}

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

// ---- Data prevista (calendário vigente) ----

const WEEKDAYS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];

function weekdayOf(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Só sábado e domingo; não há calendário de feriados bancários, como no protótipo. */
function businessDay(date, policy) {
  if (policy !== 'next-business-day') return date;
  const weekday = weekdayOf(date);
  return weekday === 6 ? shiftDateKey(date, 2) : weekday === 0 ? shiftDateKey(date, 1) : date;
}

function nextMonth(date) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
}

/**
 * Próxima data do calendário maior ou igual a D, como o nextScheduledPayment da v584. Sem política gravada, a data fica.
 * Quando o próximo dia acordado não existe no mês (31/11, 29/02), a data fica sem valor e o caso sinalizado para
 * acordo, sem trocar pelo último dia do mês, pelo dia 1º nem pela ocorrência seguinte.
 */
function expectedPayment(schedule, date) {
  civilDate(date);
  if (schedule === null || schedule === undefined || schedule.kind === 'none') return { date: null, issue: null };
  if (schedule.kind === 'weekday') {
    const target = WEEKDAYS.indexOf(schedule.weekday);
    if (target < 0) throw new Error(`Dia da semana inválido: ${schedule.weekday}`);
    return { date: shiftDateKey(date, (target - weekdayOf(date) + 7) % 7), issue: null };
  }
  if (!schedule.days.length) throw new Error('Calendário por dias do mês sem nenhum dia.');
  const policy = schedule.weekendPolicy ?? 'keep';
  const days = [...schedule.days].sort((a, b) => a - b);
  const candidates = [];
  // Um dia acordado que caiu no fim de semana anterior ainda pode vencer hoje ou amanhã, mesmo vindo do mês anterior.
  if (policy === 'next-business-day') {
    for (const offset of [1, 2]) {
      const nominal = shiftDateKey(date, -offset);
      const effective = businessDay(nominal, policy);
      if (days.includes(Number(nominal.slice(8, 10))) && effective >= date) candidates.push(effective);
    }
  }
  const today = Number(date.slice(8, 10));
  const inMonth = days.find((dia) => dia >= today);
  const nominal = `${inMonth !== undefined ? date.slice(0, 7) : nextMonth(date)}-${String(inMonth ?? days[0]).padStart(2, '0')}`;
  const missing = !isCivilDate(nominal);
  if (!missing) candidates.push(businessDay(nominal, policy));
  candidates.sort(compareText);
  return candidates.length ? { date: candidates[0], issue: null } : { date: null, issue: missing ? 'missing-month-day' : null };
}

// ---- Dívidas (R17): fora do saldo de comissões ----

/** A dívida e as linhas que ela substitui pelo corrects: a correção herda os descontos já registrados na cadeia. */
function debtChain(debt, byId) {
  const ids = new Set([debt.id]);
  for (let id = debt.corrects; id !== null && !ids.has(id); id = (byId.get(id) && byId.get(id).corrects) ?? null) ids.add(id);
  return ids;
}

/** Descontos de parcela de pagamentos válidos para a cadeia; through null conta todos, sem limite de data. */
function deductedCents(transfers, ids, through) {
  let total = ZERO;
  for (const transfer of transfers) {
    if (transfer.status !== 'valido' || (through !== null && transfer.paidOn > through)) continue;
    for (const item of transfer.deductions) if (ids.has(item.debtId)) total += moneyToCents(item.amount);
  }
  return total;
}

/** Data de entrega para ordenar: a real na dívida nova; na de migração, a entrega original ou a referência. */
function debtSortDate(debt) {
  return (debt.origin === 'novo' ? debt.deliveredOn : debt.originalDeliveryOn ?? debt.referenceDate) ?? '';
}

/** Na mesma data, a de migração é a mais antiga: foi entregue antes do corte, e a nova, depois dele. */
function compareDebtAge(a, b) {
  return compareText(debtSortDate(a), debtSortDate(b)) || Number(a.origin === 'novo') - Number(b.origin === 'novo') || compareText(a.id, b.id);
}

/**
 * Dívidas válidas já existentes em D, da mais antiga para a mais nova: a nova a partir da entrega, a de migração sempre,
 * porque foi entregue antes do corte. O saldo devedor desconta os pagamentos válidos até D; o já recuperado, usado na
 * parcela sugerida, conta todos, como o loanBalance da v584, para não sugerir de novo um desconto lançado com data posterior.
 */
function debtLedger(debts, transfers, date, include) {
  const byId = new Map(debts.map((item) => [item.id, item]));
  return debts
    .filter((item) => item.status === 'valido' && (item.origin === 'migracao' || (item.deliveredOn !== null && item.deliveredOn <= date)) && include(item))
    .sort(compareDebtAge)
    .map((debt) => {
      const chain = debtChain(debt, byId);
      const amount = moneyToCents(debt.amount);
      return { debt, balance: nonNegative(amount - deductedCents(transfers, chain, date)), recovered: deductedCents(transfers, chain, null) };
    });
}

/** Saldo devedor de cada dívida em D: o valor menos os descontos de pagamentos válidos até D. */
function debtBalances(debts, transfers, date) {
  civilDate(date);
  return debtLedger(debts, transfers, date, () => true)
    .map(({ debt, balance }) => ({ debtId: debt.id, kind: debt.kind, origin: debt.origin, balance: centsToMoney(balance) }));
}

/** A correção de uma dívida não pode ficar abaixo do que já foi descontado dela, sem limite de data. Igual é aceito. */
function checkDebtCorrection(debts, transfers, debtId, amount) {
  const byId = new Map(debts.map((item) => [item.id, item]));
  const debt = byId.get(debtId);
  if (!debt) throw new Error(`Dívida inexistente: ${debtId}`);
  const deducted = deductedCents(transfers, debtChain(debt, byId), null);
  return moneyToCents(amount) < deducted ? { ok: false, reason: 'below-deducted', deducted: centsToMoney(deducted) } : { ok: true };
}

/**
 * Parcela sugerida, como o suggestedLoanDeductions e o payoutLoanDueAmount da v584: por dívida, as parcelas com data
 * até D menos o já recuperado, limitadas ao saldo devedor, da mais antiga para a mais nova e até o valor a pagar. As
 * datas das parcelas são as acordadas; o calendário de pagamento não entra. A sugestão não baixa a dívida.
 */
function suggestedDeductions(ledger, date, available) {
  const result = [];
  let left = available;
  for (const { debt, recovered } of ledger) {
    const scheduled = debt.installments.reduce((total, item) => (item.date <= date ? total + moneyToCents(item.amount) : total), ZERO);
    const amount = minCents(nonNegative(moneyToCents(debt.amount) - recovered), nonNegative(scheduled - recovered), left);
    left -= amount;
    if (amount > ZERO) result.push({ debtId: debt.id, amount: centsToMoney(amount) });
  }
  return result;
}

/**
 * Linha de A pagar em D (contracts/payouts-http.md). Sem abertura confirmada não há valor (FR-030), mas o saldo
 * devedor, os cancelamentos pendentes e a data prevista seguem visíveis. Dívida de migração só conta pela abertura
 * vigente confirmada; a de outra revisão ou do rascunho fica fora. Com D antes do fim do período quitado, a linha também
 * sai sem valor, com o aviso "quitado até", e os demais tarólogos seguem normais na mesma data (PO, 2026-10-24).
 */
function buildDueRow(input, date, nowLocal) {
  const expected = expectedPayment(input.schedule, date);
  const today = operationalToday(nowLocal);
  const opening = input.opening;
  const confirmed = confirmedOpening(opening);
  const ledger = debtLedger(input.debts, input.transfers, date, (debt) => debt.origin === 'novo' || (confirmed !== null && debt.openingId === confirmed.id));
  const common = {
    tarotId: input.tarotId, name: input.name, expectedDate: expected.date, expectedDateIssue: expected.issue,
    debtBalance: centsToMoney(ledger.reduce((total, item) => total + item.balance, ZERO)),
    pendingCancellationCount: pendingCancellations(input, confirmed, date, today), divergenceCount: input.divergenceCount, opening: openingFlag(opening),
  };
  const settledThrough = confirmed && settledNotice(confirmed, date);
  if (confirmed === null || settledThrough !== null) {
    return { ...common, period: null, due: null, suggestedDeductions: [], net: null, pendingReviewCount: 0, settledThrough };
  }
  const lines = compositionLines(input, confirmed, date, today);
  const totals = compositionTotals(lines, common.pendingCancellationCount);
  const due = moneyToCents(totals.due);
  const suggested = suggestedDeductions(ledger, date, due);
  const net = due - sumCents(suggested.map((item) => item.amount));
  return {
    ...common, period: pendingPeriod(lines), due: totals.due, suggestedDeductions: suggested, net: centsToMoney(net),
    pendingReviewCount: totals.pendingReviewCount, settledThrough: null,
  };
}

// ---- Versão do resultado (R15) ----

function canonicalJson(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonicalJson).join(',')}]`;
  if (valor !== null && typeof valor === 'object') {
    const entries = Object.entries(valor).filter(([, item]) => item !== undefined).sort(([a], [b]) => compareText(a, b));
    return `{${entries.map(([chave, item]) => `${JSON.stringify(chave)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(valor) ?? 'null';
}

/** SHA-256 em hexadecimal do JSON canônico (chaves em ordem). Serve para as linhas da composição e para as de A pagar. */
function payoutVersion(valor) {
  return createHash('sha256').update(canonicalJson(valor)).digest('hex');
}

module.exports = {
  moneyToCents, centsToMoney, commissionCents, consultationRates, legacyConsultationBase, consultationAmount,
  payoutComposition, expectedPayment, debtBalances, checkDebtCorrection, buildDueRow, payoutVersion,
};
