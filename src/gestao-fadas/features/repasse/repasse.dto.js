'use strict';

/**
 * Montagem dos DTOs de LEITURA do repasse a partir das linhas das `gf_repasse_*` (nomes de coluna do banco).
 * Porta de `agreementOf`/`openingView`/`currentOf` (real-payouts-http.server.ts) e dos leitores de `db/finance-store.ts`
 * (`readCommissionRates`, `readPaymentSchedules`, `readDebts`, `readOpenings`, `debtsInBodyOrder`). Função pura: o
 * serviço faz as consultas e passa as linhas. O formato é o EXATO do contrato (payouts-http.md):
 *   acordo:   { commission: { current, since, history[] }, schedule: { current, since, history[] } }
 *   abertura: { current, draft, revisions[] }
 *
 * Dado fora do formato (como o zod `.strict()` da B) é erro 500 não operacional: nunca se devolve valor presumido.
 */

const { createHash } = require('crypto');
const AppError = require('../../../utils/AppError');
const { DEFAULT_RATE } = require('./repasse.model');

const RATE = /^\d{1,3}\.\d{2}$/;
const MONEY = /^-?\d{1,18}\.\d{2}$/;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL_DATETIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const WEEKDAYS = ['segunda', 'terca', 'quarta', 'quinta', 'sexta'];
const POLICIES = ['keep', 'next-business-day'];

function dado(condicao, onde) {
  if (!condicao) throw new AppError(`Registro de repasse fora do formato (${onde}).`, 500, { codigo: 'REPASSE_DADO_INVALIDO' }, false);
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** BIGINT (volta como texto) em milissegundos; inteiro positivo seguro. */
function instante(valor, onde) {
  const n = typeof valor === 'number' ? valor : /^\d+$/.test(`${valor}`) ? Number(valor) : NaN;
  dado(Number.isSafeInteger(n) && n > 0, onde);
  return n;
}

const toLocal = (guardado) => guardado.replace(' ', 'T');
const isoOf = (ms) => new Date(ms).toISOString();

/** `by` do contrato. `gf_auth_accounts` não tem model nesta API: o nome fica null (ver relatório; a B resolve o nome). */
const quem = (contaId) => ({ accountId: contaId, displayName: null });

// ---- Acordo ----

function lerPercentual(r) {
  dado(typeof r.id === 'string', 'percentual.id');
  dado(typeof r.percentual === 'string' && RATE.test(r.percentual), 'percentual.percentual');
  dado(typeof r.vigente_desde === 'string' && LOCAL_DATETIME.test(r.vigente_desde), 'percentual.vigente_desde');
  dado(r.motivo === null || typeof r.motivo === 'string', 'percentual.motivo');
  dado(typeof r.registrado_por === 'string', 'percentual.registrado_por');
  return { id: r.id, rate: r.percentual, effectiveFrom: r.vigente_desde, reason: r.motivo, registeredBy: r.registrado_por, registeredAt: instante(r.registrado_em, 'percentual.registrado_em') };
}

function scheduleOf(r) {
  if (r.tipo === 'weekday') {
    dado(WEEKDAYS.includes(r.dia_semana), 'calendario.dia_semana');
    return { kind: 'weekday', weekday: r.dia_semana };
  }
  if (r.tipo === 'monthdays') {
    const days = String(r.dias_mes).split(',').map(Number);
    dado(days.length >= 1 && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 31) && new Set(days).size === days.length, 'calendario.dias_mes');
    dado(r.politica_fim_semana === null || r.politica_fim_semana === undefined || POLICIES.includes(r.politica_fim_semana), 'calendario.politica_fim_semana');
    return { kind: 'monthdays', days, weekendPolicy: r.politica_fim_semana ?? null };
  }
  dado(r.tipo === 'none', 'calendario.tipo');
  return { kind: 'none' };
}

function lerCalendario(r) {
  dado(typeof r.id === 'string', 'calendario.id');
  dado(typeof r.vigente_desde === 'string' && LOCAL_DATETIME.test(r.vigente_desde), 'calendario.vigente_desde');
  dado(r.motivo === null || typeof r.motivo === 'string', 'calendario.motivo');
  dado(typeof r.registrado_por === 'string', 'calendario.registrado_por');
  return { id: r.id, schedule: scheduleOf(r), effectiveFrom: r.vigente_desde, reason: r.motivo, registeredBy: r.registrado_por, registeredAt: instante(r.registrado_em, 'calendario.registrado_em') };
}

/** Mesma ordem do SELECT da B: `vigente_desde, id`. */
const porVigencia = (a, b) => compareText(a.effectiveFrom, b.effectiveFrom) || compareText(a.id, b.id);

/** A abertura vigente: a maior revisão confirmada (data-model, gf_repasse_aberturas). `aberturas` já lidas, por revisão. */
const currentOf = (aberturas) => aberturas.filter((item) => item.status === 'confirmada').at(-1) ?? null;

/**
 * O acordo como o contrato o descreve. O percentual em vigor é o da última alteração com vigência a partir do
 * quitado_ate da abertura vigente; sem nenhuma, o conferido nela, desde o quitado_ate (R11; PO, 2026-10-24). Sem
 * abertura, o da última alteração ou o padrão de 30%. Sem registro, não há calendário.
 * Entrada: linhas cruas de percentuais e calendários e as aberturas JÁ LIDAS (lerAbertura).
 */
function acordoDe({ percentuais, calendarios, aberturas }) {
  const rates = percentuais.map(lerPercentual).sort(porVigencia);
  const schedules = calendarios.map(lerCalendario).sort(porVigencia);
  const opening = currentOf(aberturas);
  const inCycle = opening ? rates.filter((item) => item.effectiveFrom >= opening.settledThrough) : rates;
  const lastRate = inCycle.at(-1);
  const lastSchedule = schedules.at(-1);
  const registered = (item) => ({ since: toLocal(item.effectiveFrom), reason: item.reason, by: quem(item.registeredBy), recordedAt: isoOf(item.registeredAt) });
  return {
    commission: {
      current: (lastRate && lastRate.rate) ?? (opening && opening.rate) ?? DEFAULT_RATE,
      since: lastRate ? toLocal(lastRate.effectiveFrom) : opening ? toLocal(opening.settledThrough) : null,
      history: rates.map((item) => ({ value: item.rate, ...registered(item) })),
    },
    schedule: {
      current: (lastSchedule && lastSchedule.schedule) ?? null,
      since: lastSchedule ? toLocal(lastSchedule.effectiveFrom) : null,
      history: schedules.map((item) => ({ schedule: item.schedule, ...registered(item) })),
    },
  };
}

// ---- Abertura ----

function lerParcela(r) {
  dado(Number.isInteger(Number(r.sequencia)) && Number(r.sequencia) > 0, 'parcela.sequencia');
  dado(typeof r.data === 'string' && CIVIL.test(r.data), 'parcela.data');
  dado(typeof r.valor === 'string' && MONEY.test(r.valor), 'parcela.valor');
  return { sequence: Number(r.sequencia), date: r.data, amount: r.valor };
}

function lerDivida(r, parcelas) {
  dado(typeof r.id === 'string', 'divida.id');
  dado(['loan', 'advance'].includes(r.tipo), 'divida.tipo');
  dado(['migracao', 'novo'].includes(r.origem), 'divida.origem');
  dado(typeof r.valor === 'string' && MONEY.test(r.valor), 'divida.valor');
  dado(['valido', 'substituido'].includes(r.situacao), 'divida.situacao');
  for (const c of ['entrega_original', 'entregue_em', 'referencia_data']) dado(r[c] === null || (typeof r[c] === 'string' && CIVIL.test(r[c])), `divida.${c}`);
  return {
    id: r.id, kind: r.tipo, origin: r.origem, openingId: r.abertura_id ?? null, amount: r.valor,
    originalDeliveryOn: r.entrega_original, deliveredOn: r.entregue_em, referenceDate: r.referencia_data, status: r.situacao,
    corrects: r.corrige_id ?? null, sheetRef: r.planilha_referencia ?? null,
    installments: parcelas.filter((p) => p.divida_id === r.id).map(lerParcela).sort((a, b) => a.sequence - b.sequence),
    registeredAt: instante(r.registrado_em, 'divida.registrado_em'), operationKey: r.operation_key,
  };
}

function lerAjuste(r) {
  dado(typeof r.id === 'string', 'ajuste.id');
  dado(['bonus', 'outro', 'desconto'].includes(r.tipo), 'ajuste.tipo');
  dado(typeof r.valor === 'string' && MONEY.test(r.valor), 'ajuste.valor');
  dado(typeof r.descricao === 'string', 'ajuste.descricao');
  dado(typeof r.data === 'string' && CIVIL.test(r.data), 'ajuste.data');
  return { id: r.id, kind: r.tipo, amount: r.valor, description: r.descricao, date: r.data, openingId: r.abertura_id ?? null };
}

function lerPendencia(r) {
  dado(typeof r.id === 'string' && typeof r.descricao === 'string', 'pendencia');
  dado(r.valor === null || r.valor === undefined || (typeof r.valor === 'string' && MONEY.test(r.valor)), 'pendencia.valor');
  return {
    id: r.id, description: r.descricao, amount: r.valor ?? null,
    resolvedAt: r.resolvida_em === null || r.resolvida_em === undefined ? null : instante(r.resolvida_em, 'pendencia.resolvida_em'),
    resolvedBy: r.resolvida_por ?? null,
  };
}

/** A linha filha da abertura tem uma operation_key própria: a da operação com o tipo e a posição, em SHA-256. */
const childKey = (operationKeyDaOperacao, tipo, indice) => createHash('sha256').update(`${operationKeyDaOperacao}\u0000${tipo}\u0000${indice}`, 'utf8').digest('hex');

/**
 * As dívidas da abertura na ordem do corpo gravado: a i-ésima nasceu com childKey(chave da abertura, "divida", i); uma
 * correção de dívida depois dela, na mesma revisão, herda a posição pela corrige_id. A leitura ordena por registrado_em
 * e id, que não guardam a posição; a tela mostra e corrige nesta ordem, e a correção da abertura pareia por ela (T045).
 */
function debtsInBodyOrder(abertura, dividas) {
  const proprias = dividas.filter((d) => d.openingId === abertura.id);
  const byId = new Map(proprias.map((d) => [d.id, d]));
  const chaves = proprias.map((_, i) => childKey(abertura.operationKey, 'divida', i));
  const posicao = (divida) => {
    let primeira = divida;
    for (let anterior = byId.get(primeira.corrects ?? ''); anterior; anterior = byId.get(primeira.corrects ?? '')) primeira = anterior;
    const em = chaves.indexOf(primeira.operationKey);
    return em < 0 ? chaves.length : em;
  };
  return proprias.map((item) => ({ item, em: posicao(item) })).sort((a, b) => a.em - b.em).map(({ item }) => item);
}

/** Lê uma linha de `gf_repasse_aberturas` já com os filhos (listas de linhas cruas do mesmo tarólogo). */
function lerAbertura(r, { pendencias, dividas, parcelas, ajustes }) {
  dado(typeof r.id === 'string', 'abertura.id');
  dado(Number.isInteger(Number(r.revisao)) && Number(r.revisao) > 0, 'abertura.revisao');
  dado(['rascunho', 'confirmada', 'descartada'].includes(r.situacao), 'abertura.situacao');
  dado(typeof r.ultimo_pagamento_data === 'string' && CIVIL.test(r.ultimo_pagamento_data), 'abertura.ultimo_pagamento_data');
  dado(typeof r.ultimo_pagamento_valor === 'string' && MONEY.test(r.ultimo_pagamento_valor), 'abertura.ultimo_pagamento_valor');
  dado(typeof r.quitado_ate === 'string' && LOCAL_DATETIME.test(r.quitado_ate), 'abertura.quitado_ate');
  dado(typeof r.corte_migracao === 'string' && LOCAL_DATETIME.test(r.corte_migracao), 'abertura.corte_migracao');
  dado(typeof r.saldo_remanescente === 'string' && MONEY.test(r.saldo_remanescente), 'abertura.saldo_remanescente');
  dado(typeof r.percentual_conferido === 'string' && RATE.test(r.percentual_conferido), 'abertura.percentual_conferido');
  const lidas = dividas.map((d) => lerDivida(d, parcelas));
  return {
    id: r.id, tarotId: r.tarot_id, revision: Number(r.revisao), status: r.situacao,
    corrects: r.corrige_revisao === null || r.corrige_revisao === undefined ? null : Number(r.corrige_revisao),
    correctionReason: r.motivo_correcao ?? null,
    lastPayment: { paidOn: r.ultimo_pagamento_data, amount: r.ultimo_pagamento_valor, sheetRef: r.planilha_referencia },
    settledThrough: r.quitado_ate, remainingBalance: r.saldo_remanescente, balanceNote: r.saldo_composicao ?? null, migrationCut: r.corte_migracao,
    rate: r.percentual_conferido, enteredBy: r.lancado_por, enteredAt: instante(r.lancado_em, 'abertura.lancado_em'),
    confirmedBy: r.confirmado_por ?? null,
    confirmedAt: r.confirmado_em === null || r.confirmado_em === undefined ? null : instante(r.confirmado_em, 'abertura.confirmado_em'),
    operationKey: r.operation_key,
    differences: pendencias.filter((p) => p.abertura_id === r.id).map(lerPendencia).sort((a, b) => compareText(a.id, b.id)),
    debts: debtsInBodyOrder({ id: r.id, operationKey: r.operation_key }, lidas.sort((a, b) => a.registeredAt - b.registeredAt || compareText(a.id, b.id))),
    adjustments: ajustes.map(lerAjuste).filter((a) => a.openingId === r.id),
  };
}

/** Uma revisão como a tela a mostra: os campos do formulário, quem lançou e quem confirmou (conta) e quando. */
function openingView(item) {
  return {
    id: item.id, tarotId: item.tarotId, revision: item.revision, status: item.status, corrects: item.corrects, correctionReason: item.correctionReason,
    lastPayment: item.lastPayment, settledThrough: toLocal(item.settledThrough), migrationCut: toLocal(item.migrationCut),
    remainingBalance: item.remainingBalance, remainingBalanceNote: item.balanceNote, rate: item.rate,
    openAdjustments: item.adjustments.map(({ id, kind, amount, description, date }) => ({ id, kind, amount, description, date })),
    debts: item.debts.map((debt) => ({
      id: debt.id, kind: debt.kind, remaining: debt.amount, originalDeliveryOn: debt.originalDeliveryOn, sheetRef: debt.sheetRef, status: debt.status,
      corrects: debt.corrects, installments: debt.installments.map(({ date, amount }) => ({ date, amount })),
    })),
    differences: item.differences.map((d) => ({
      id: d.id, description: d.description, amount: d.amount,
      resolvedAt: d.resolvedAt === null ? null : isoOf(d.resolvedAt), resolvedBy: d.resolvedBy === null ? null : quem(d.resolvedBy),
    })),
    enteredBy: quem(item.enteredBy), enteredAt: isoOf(item.enteredAt),
    confirmedBy: item.confirmedBy === null ? null : quem(item.confirmedBy), confirmedAt: item.confirmedAt === null ? null : isoOf(item.confirmedAt),
  };
}

/** `{ current, draft, revisions[] }`: a vigente, o rascunho aberto e todas as revisões, da 1 em diante. */
function aberturasDe(aberturas) {
  const ordenadas = [...aberturas].sort((a, b) => a.revision - b.revision);
  const view = (item) => (item === null ? null : openingView(item));
  return {
    current: view(currentOf(ordenadas)),
    draft: view(ordenadas.find((item) => item.status === 'rascunho') ?? null),
    revisions: ordenadas.map(openingView),
  };
}

module.exports = { acordoDe, lerAbertura, aberturasDe, openingView, currentOf, debtsInBodyOrder, childKey };
