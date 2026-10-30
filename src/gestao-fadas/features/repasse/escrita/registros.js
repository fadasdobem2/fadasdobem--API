'use strict';

/**
 * Leitura dos registros de repasse DENTRO da transação de gravação (porte de `readCommissionRates`, `readPaymentSchedules`,
 * `readDebts`, `readAdjustments` e `readOpenings` de `db/finance-store.ts`). Devolve o registro com os nomes da B
 * (`rate`, `effectiveFrom`, `registeredBy`...), que é o que vai para `gf_auditoria.depois` e o que a repetição compara.
 * Linha fora do formato (a B usa zod `.strict()`) é erro: nunca se devolve valor presumido.
 */

const { RepasseStoreError } = require('./erro');
const { debtsInBodyOrder } = require('../repasse.dto');
const sql = require('./sql');

const RATE = /^\d{1,3}\.\d{2}$/;
const MONEY = /^-?\d{1,18}\.\d{2}$/;
const CIVIL = /^\d{4}-\d{2}-\d{2}$/;
const LOCAL = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function dado(condicao, onde) {
  if (!condicao) throw new RepasseStoreError(`malformed-row:${onde}`);
}
const texto = (v, re, onde) => {
  dado(typeof v === 'string' && (!re || re.test(v)), onde);
  return v;
};
const textoOuNulo = (v, re, onde) => (v === null || v === undefined ? null : texto(v, re, onde));
/** BIGINT em milissegundos: número ou texto, inteiro positivo seguro. */
function instante(v, onde) {
  const n = typeof v === 'number' ? v : /^\d+$/.test(`${v}`) ? Number(v) : NaN;
  dado(Number.isSafeInteger(n) && n > 0, onde);
  return n;
}
const instanteOuNulo = (v, onde) => (v === null || v === undefined ? null : instante(v, onde));

/** `execute` devolve `[linhas, campos]`; só as linhas importam. */
async function linhas(ex, consulta, valores) {
  const [resultado] = await ex.execute(consulta, valores);
  return Array.isArray(resultado) ? resultado : [];
}

function agrupar(itens, chave) {
  const grupos = new Map();
  for (const item of itens) {
    const k = String(item[chave]);
    if (grupos.has(k)) grupos.get(k).push(item);
    else grupos.set(k, [item]);
  }
  return grupos;
}

const registrado = (r) => ({ registeredBy: texto(r.registrado_por, null, 'registrado_por'), registeredAt: instante(r.registrado_em, 'registrado_em'), operationKey: texto(r.operation_key, null, 'operation_key') });

async function lerPercentuais(ex, tarotId) {
  return (await linhas(ex, sql.COMMISSION_RATES, [tarotId])).map((r) => ({
    id: texto(r.id, null, 'id'), tarotId: texto(r.tarot_id, null, 'tarot_id'), rate: texto(r.percentual, RATE, 'percentual'),
    effectiveFrom: texto(r.vigente_desde, LOCAL, 'vigente_desde'), reason: textoOuNulo(r.motivo, null, 'motivo'), ...registrado(r),
  }));
}

function calendarioDe(r) {
  if (r.tipo === 'weekday') return { kind: 'weekday', weekday: r.dia_semana };
  if (r.tipo === 'monthdays') return { kind: 'monthdays', days: String(r.dias_mes).split(',').map(Number), weekendPolicy: r.politica_fim_semana ?? null };
  return { kind: r.tipo };
}

async function lerCalendarios(ex, tarotId) {
  return (await linhas(ex, sql.PAYMENT_SCHEDULES, [tarotId])).map((r) => ({
    id: texto(r.id, null, 'id'), tarotId: texto(r.tarot_id, null, 'tarot_id'), schedule: calendarioDe(r),
    effectiveFrom: texto(r.vigente_desde, LOCAL, 'vigente_desde'), reason: textoOuNulo(r.motivo, null, 'motivo'), ...registrado(r),
  }));
}

async function lerDividas(ex, tarotId) {
  const dividas = await linhas(ex, sql.DEBTS, [tarotId]);
  const parcelas = agrupar(await linhas(ex, sql.INSTALLMENTS, [tarotId]), 'divida_id');
  return dividas.map((r) => ({
    id: texto(r.id, null, 'id'), tarotId: texto(r.tarot_id, null, 'tarot_id'), kind: r.tipo, origin: r.origem, openingId: r.abertura_id ?? null,
    amount: texto(r.valor, MONEY, 'valor'), originalDeliveryOn: textoOuNulo(r.entrega_original, CIVIL, 'entrega_original'),
    deliveredOn: textoOuNulo(r.entregue_em, CIVIL, 'entregue_em'), referenceDate: textoOuNulo(r.referencia_data, CIVIL, 'referencia_data'),
    status: r.situacao, corrects: r.corrige_id ?? null, correctionReason: r.motivo_correcao ?? null, sheetRef: r.planilha_referencia ?? null, note: r.observacao ?? null,
    installments: (parcelas.get(r.id) ?? []).map((p) => ({ sequence: Number(p.sequencia), date: texto(p.data, CIVIL, 'parcela.data'), amount: texto(p.valor, MONEY, 'parcela.valor') })),
    ...registrado(r),
  }));
}

async function lerAjustes(ex, tarotId) {
  return (await linhas(ex, sql.ADJUSTMENTS, [tarotId])).map((r) => ({
    id: texto(r.id, null, 'id'), tarotId: texto(r.tarot_id, null, 'tarot_id'), kind: r.tipo, amount: texto(r.valor, MONEY, 'valor'), description: texto(r.descricao, null, 'descricao'),
    date: texto(r.data, CIVIL, 'data'), periodStart: texto(r.periodo_inicio, CIVIL, 'periodo_inicio'), periodEnd: texto(r.periodo_fim, CIVIL, 'periodo_fim'),
    openingId: r.abertura_id ?? null, status: r.situacao, corrects: r.corrige_id ?? null, correctionReason: r.motivo_correcao ?? null, ...registrado(r),
  }));
}

async function lerAberturas(ex, tarotId) {
  const aberturas = await linhas(ex, sql.OPENINGS, [tarotId]);
  const diferencas = agrupar(await linhas(ex, sql.DIFFERENCES, [tarotId]), 'abertura_id');
  const dividas = await lerDividas(ex, tarotId);
  const ajustes = await lerAjustes(ex, tarotId);
  return aberturas.map((r) => ({
    id: texto(r.id, null, 'id'), tarotId: texto(r.tarot_id, null, 'tarot_id'), revision: Number(r.revisao), status: r.situacao,
    corrects: r.corrige_revisao === null || r.corrige_revisao === undefined ? null : Number(r.corrige_revisao),
    correctsId: r.corrige_id ?? null, correctionReason: r.motivo_correcao ?? null,
    lastPayment: { paidOn: texto(r.ultimo_pagamento_data, CIVIL, 'ultimo_pagamento_data'), amount: texto(r.ultimo_pagamento_valor, MONEY, 'ultimo_pagamento_valor'), sheetRef: texto(r.planilha_referencia, null, 'planilha_referencia') },
    settledThrough: texto(r.quitado_ate, LOCAL, 'quitado_ate'), remainingBalance: texto(r.saldo_remanescente, MONEY, 'saldo_remanescente'),
    balanceNote: r.saldo_composicao ?? null, migrationCut: texto(r.corte_migracao, LOCAL, 'corte_migracao'), rate: texto(r.percentual_conferido, RATE, 'percentual_conferido'),
    enteredBy: texto(r.lancado_por, null, 'lancado_por'), enteredAt: instante(r.lancado_em, 'lancado_em'),
    confirmedBy: r.confirmado_por ?? null, confirmedAt: instanteOuNulo(r.confirmado_em, 'confirmado_em'), operationKey: texto(r.operation_key, null, 'operation_key'),
    differences: (diferencas.get(r.id) ?? []).map((p) => ({
      id: p.id, description: p.descricao, amount: p.valor ?? null, resolvedAt: instanteOuNulo(p.resolvida_em, 'resolvida_em'), resolvedBy: p.resolvida_por ?? null,
    })),
    debts: debtsInBodyOrder({ id: r.id, operationKey: r.operation_key }, dividas),
    adjustments: ajustes.filter((a) => a.openingId === r.id),
  }));
}

/** O registro de `id` na lista; ausente é `not-found` (`only` da B). */
function somente(itens, id) {
  const item = itens.find((candidato) => candidato.id === id);
  if (!item) throw new RepasseStoreError('not-found');
  return item;
}

module.exports = { linhas, lerPercentuais, lerCalendarios, lerDividas, lerAjustes, lerAberturas, somente };
