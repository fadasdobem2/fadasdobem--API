'use strict';

/**
 * Datas do pagamento no servidor (Maturacao/42): porte de `domain/payment-dates.ts` (`paymentPaidAt`, `knownPaymentPaidAt`, `paymentRegisteredAt`,
 * `paymentDayInput`, `paymentDateInput`, `paymentDateFromDayInput`, `paymentDateFromInput`) e de `correctMissingPaymentDates`
 * (`finance/consultation-payment-reconciliation-model.ts`, item 2: a conciliação de datas de migração, que muda `informedAt`).
 * Sem Intl/ICU: o fuso de São Paulo é fixo em -03:00 (sem horário de verão desde 17/02/2019; os registros daqui são de 2026).
 */

const L = require('./pagamentos-livro');
const R = require('./pagamentos-regras');

const { erro } = L;
const SP_MS = 3 * 3600000;

/** `validKnownDate`. */
const dataConhecida = (v) => { if (!v) return undefined; try { R.dataDoPagamento(v); return v; } catch { return undefined; } };
/** `knownPaymentPaidAt`. */
function dataPagaConhecida(p) {
  const v = dataConhecida(p.paidAt);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T06:00:00-03:00` : v;
}
/** `paymentRegisteredAt`. */
function dataDoLancamento(p) {
  const evento = (p.audit || []).find((e) => e.action === 'Pagamento informado');
  return dataConhecida(p.informedAt) || dataConhecida(evento && evento.createdAt);
}
/** `paymentPaidAt`. */
const dataPaga = (p) => { const v = p.paidAt || p.informedAt; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T06:00:00-03:00` : v; };
/** `paymentDateInput(timestamp)` (hora de São Paulo `AAAA-MM-DDTHH:mm`); texto vazio se o instante é inválido. */
function entradaDeData(instante) {
  const ms = instante instanceof Date ? instante.getTime() : Date.parse(instante);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms - SP_MS).toISOString().slice(0, 16);
}
/** `paymentDayInput`. */
function entradaDeDia(instante) {
  if (typeof instante === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(instante)) return instante;
  return entradaDeData(instante).slice(0, 10);
}
/** `paymentDateFromDayInput(value, previous, now)` (calendário real). */
function dataDoDia(valor, anterior, agora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) erro('Informe a data do pagamento.');
  R.dataDoPagamento(valor);
  if (anterior && anterior.paidAt && valor === entradaDeDia(dataPagaConhecida(anterior) || '')) return anterior.paidAt;
  const hoje = entradaDeDia(new Date(Date.parse(agora)));
  if (valor === hoje) return agora;
  return valor;
}
/** `paymentDateFromInput(value, now)`. */
function dataDaEntrada(valor) {
  const instante = `${valor}:00-03:00`;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(valor) || !Number.isFinite(new Date(instante).getTime()) || entradaDeData(instante) !== valor) erro('Informe a data e hora do pagamento.');
  return new Date(`${valor.slice(0, 10)}T${valor.slice(11)}:00-03:00`).toISOString();
}

/**
 * `reconciliationRevision`: o servidor NÃO usa a revisão do navegador (a concorrência é do `expectedVersion`); a assinatura da conta lida do banco
 * vale como revisão. `correctMissingPaymentDates(state, input, revision, role, actor, at)` com a revisão sempre conferida.
 */
function corrigirDatasDaMigracao(estado, entrada, papel, ator, em) {
  if (papel !== 'administradora' && papel !== 'assistente') erro('Somente o Financeiro ou a Administração corrige datas.');
  const p = estado.payments.find((x) => x.id === entrada.id);
  if (!p) erro('Pagamento não encontrado.');
  L.validarNome(ator, 'Responsável'); const evidencia = L.validarObservacao(entrada.evidence, 'Referência conferida', true);
  if (!Number.isFinite(Date.parse(em))) erro('Data da revisão inválida.');
  const falta = { paid: !dataPagaConhecida(p), registered: !dataDoLancamento(p) };
  if (!entrada.paidAt && !entrada.informedAt) erro('Informe ao menos uma data esclarecida.');
  if ((entrada.paidAt && !falta.paid) || (entrada.informedAt && !falta.registered)) erro('A data já existe. Preserve o dado conhecido e reabra o registro.');
  if (entrada.paidAt) R.dataDoPagamento(entrada.paidAt);
  if (entrada.informedAt) { R.dataDoPagamento(entrada.informedAt); if (/^\d{4}-\d{2}-\d{2}$/.test(entrada.informedAt)) erro('Informe data e hora do lançamento.'); }
  const detalhe = `Migração: datas esclarecidas. Pagamento: ${p.paidAt || 'não disponível'} → ${entrada.paidDisplayDate || entrada.paidAt || p.paidAt || 'não disponível'}${entrada.paidPrecision === 'date' ? ' (horário não informado)' : ''}. Lançamento: ${p.informedAt || 'não disponível'} → ${entrada.registeredDisplayDate || entrada.informedAt || p.informedAt || 'não disponível'}. Referência: ${evidencia}`;
  const proximo = {
    ...p, ...(entrada.paidAt ? { paidAt: entrada.paidAt } : {}), ...(entrada.informedAt ? { informedAt: entrada.informedAt } : {}),
    dateCorrections: { ...p.dateCorrections, ...(entrada.paidAt ? { paidAt: { precision: entrada.paidPrecision || (/^\d{4}-\d{2}-\d{2}$/.test(entrada.paidAt) ? 'date' : 'datetime'), by: ator, at: em, evidence: evidencia } } : {}), ...(entrada.informedAt ? { informedAt: { precision: 'datetime', by: ator, at: em, evidence: evidencia } } : {}) },
    updatedAt: em, updatedBy: ator, audit: [...(p.audit || []), { id: `migration-date:${p.id}:${em}`, action: 'Pagamento corrigido', detail: detalhe, actor: ator, createdAt: em }],
  };
  return { ...estado, payments: estado.payments.map((x) => (x.id === proximo.id ? proximo : x)) };
}

module.exports = { dataPagaConhecida, dataDoLancamento, dataPaga, entradaDeData, entradaDeDia, dataDoDia, dataDaEntrada, corrigirDatasDaMigracao };
