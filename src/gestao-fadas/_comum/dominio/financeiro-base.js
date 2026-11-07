'use strict';

/**
 * Domínio financeiro da cliente, parte 1 (Maturacao/29 seção 10): porte das funções PURAS do front que a conferência de encerramento e o
 * saldo usam. Cada função cita o arquivo do front; o ouro (`scripts/apoio-gf-financeiro/ouro-financeiro-front.json`) vem do CÓDIGO REAL do
 * front (`scripts/gerar-ouro-gf-financeiro.js`). Valores em REAIS (number) como o registro do front; as contas internas usam centavos
 * inteiros onde o front usa. Nada aqui lê banco nem relógio.
 *   - `domain/consultation-status.ts`, `domain/legacy-bonus-tariff.ts` (recordedConsultationUnitValue), `domain/client-minute-benefits.ts`,
 *     `domain/credit-lots.ts`, `domain/consultation-coverage.ts` (pacotes), `domain/first-consultation-eligibility.ts`,
 *     `domain/payment-dates.ts` (paymentPaidAt), `domain/pricing.ts` (tabela padrão e vigência).
 */

const { minutosDeArredondamento } = require('./credito-arredondamento');

// --- domain/consultation-status.ts ---------------------------------------------------------------------------------------
const PAGA_REPASSE = new Set(['Concluída', 'Cancelada', 'Desistiu']);
const COBERTURA = new Set(['Em curso', 'Finalizada pelo tarólogo', 'Concluída', 'Cancelada', 'Desistiu']);

const contaMinutos = (status) => status === 'Finalizada pelo tarólogo' || PAGA_REPASSE.has(status);
const retemCoberturaDeCancelamento = (item) => item.status === 'Anulada' && Boolean(item.cancellationReview) && item.cancellationReview.status === 'unpaid';
const consomeCobertura = (valor) => (typeof valor === 'string' ? COBERTURA.has(valor) : COBERTURA.has(valor.status) || retemCoberturaDeCancelamento(valor));

// --- domain/legacy-bonus-tariff.ts ---------------------------------------------------------------------------------------
const taxaConhecida = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
/** Um zero registrado é evidência: não se troca por tarifa adivinhada. */
function valorRegistradoDoMinuto(item) {
  return [item.specialPrice && item.specialPrice.unitValue, item.coverage && item.coverage.unitValue, item.billing && item.billing.unitValueOverride,
    item.billing && item.billing.tariff && item.billing.tariff.unitValue, item.minuteValue].find(taxaConhecida);
}

// --- domain/client-minute-benefits.ts ------------------------------------------------------------------------------------
function usoDosBeneficios(item) {
  let restante = Math.max(0, Math.ceil(item.durationSeconds / 60) - (item.benefitConsumptionOrder === 'benefits-first' ? 0 : item.paidMinutesBeforeBenefits || 0));
  return (item.minuteBenefits || []).map((b) => { const minutos = consomeCobertura(item) ? Math.min(restante, b.minutes) : 0; restante -= minutos; return { ...b, usedMinutes: minutos }; });
}
const ehOrigemDeBonus = (item) => item.status === 'Cancelada' || retemCoberturaDeCancelamento(item) || (item.status === 'Concluída' && Boolean(item.bonusGrant) && item.bonusGrant.adjustment === 'partial');
function beneficioDoBonus(item) {
  const g = item.bonusGrant;
  const unitValue = typeof g.unitValue === 'number' && Number.isFinite(g.unitValue) && g.unitValue >= 0 ? g.unitValue
    : valorRegistradoDoMinuto(item) ?? (item.migrationBonusTariff && item.migrationBonusTariff.unitValue) ?? 2.96;
  return { id: `cancellation:${item.id}`, clientId: item.clientId, kind: 'Bônus', minutes: g.minutes, unitValue,
    reason: g.reason || (g.adjustment === 'partial' ? 'Abatimento na consulta anterior' : 'Consulta anterior cancelada'),
    grantedBy: g.grantedBy, grantedAt: g.grantedAt, sourceConsultationId: item.id, payTarologist: true };
}
const idNormalizado = (id) => (id || '').trim().toUpperCase().replace(/^C-/, '');
const usaOrigemDeBonusLegado = (item, b) => Boolean(item.coverage) && item.coverage.kind === 'Bônus' && Boolean(b.sourceConsultationId) && idNormalizado(item.coverage.sourceConsultationId) === idNormalizado(b.sourceConsultationId);
function beneficiosDisponiveis(clientId, perfil, consultas, exceptoId, em = new Date().toISOString()) {
  const concedidos = [...((perfil && perfil.minuteBenefits) || []), ...consultas.filter((i) => i.clientId === clientId && ehOrigemDeBonus(i) && i.bonusGrant && i.bonusGrant.minutes).map(beneficioDoBonus)];
  return concedidos.filter((g) => g.clientId === clientId && Date.parse(g.grantedAt) <= Date.parse(em)).map((g) => {
    let usado = 0; let reservado = 0;
    for (const item of consultas) {
      if (item.id === exceptoId || !consomeCobertura(item)) continue;
      if (usaOrigemDeBonusLegado(item, g)) { usado += g.minutes; continue; }
      const alocacao = (item.minuteBenefits || []).find((v) => v.id === g.id);
      if (!alocacao) continue;
      if (item.status === 'Em curso') reservado += alocacao.minutes;
      else usado += (usoDosBeneficios(item).find((v) => v.id === g.id) || {}).usedMinutes || 0;
    }
    return { ...g, used: usado, reserved: reservado, remaining: Math.max(0, g.minutes - usado - reservado) };
  }).sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
}

// --- domain/credit-lots.ts -----------------------------------------------------------------------------------------------
/** Consome minutos pelo preço da compra; a última fração leva a sobra de arredondamento. */
function alocarLotes(lotes, minutosPedidos, valorReserva = 2.96, arredondamento) {
  let restante = Math.max(0, minutosPedidos); let centavos = 0; let bruto = 0;
  const alocacoes = [];
  for (const lote of lotes) {
    const usados = Math.min(restante, Math.max(0, lote.minutes));
    if (usados <= 0.0000001 || lote.cents <= 0) continue;
    const sobra = Math.max(0, lote.minutes - usados);
    const usadosCents = sobra <= 0.0000001 ? lote.cents : Math.max(0, Math.min(lote.cents, Math.round(usados * lote.unitValue * 100 + lote.cents - lote.minutes * lote.unitValue * 100 + 0.00000001)));
    alocacoes.push({ ...lote, usedMinutes: usados, usedCents: usadosCents });
    centavos += usadosCents; bruto += usados * lote.unitValue; restante -= usados;
    if (restante <= 0.0000001) break;
  }
  // A fração autorizada só existe depois de usados todos os centavos capturados (v706).
  const arredondados = Math.min(Math.max(0, restante), minutosDeArredondamento(lotes, arredondamento));
  restante -= arredondados;
  if (restante > 0.0000001) { centavos += Math.round(restante * valorReserva * 100); bruto += restante * valorReserva; }
  return { amount: centavos / 100, rawAmount: bruto, allocations: alocacoes, roundedMinutes: arredondados, uncoveredMinutes: restante > 0.0000001 ? restante : 0 };
}
function fatiarLotes(lotes, deslocamento, minutos = Infinity) {
  let pula = Math.max(0, deslocamento); let restante = Math.max(0, minutos);
  const escolhidos = [];
  for (const lote of lotes) {
    const pulados = Math.min(pula, lote.minutes); pula -= pulados;
    if (pulados >= lote.minutes || restante <= 0.0000001) continue;
    const centavosPulados = pulados > 0 ? (alocarLotes([lote], pulados).allocations[0] || {}).usedCents || 0 : 0;
    const resto = { ...lote, minutes: lote.minutes - pulados, cents: lote.cents - centavosPulados };
    const toma = Math.min(restante, resto.minutes);
    const aloc = alocarLotes([resto], toma).allocations[0];
    if (aloc) { escolhidos.push({ ...resto, minutes: toma, cents: aloc.usedCents }); restante -= toma; }
  }
  return escolhidos;
}

// --- domain/consultation-coverage.ts (pacotes) ---------------------------------------------------------------------------
const PACOTES = [
  { amount: 35, minutes: 15 }, { amount: 44.4, minutes: 15 }, { amount: 46, minutes: 20 }, { amount: 59.2, minutes: 20 }, { amount: 67, minutes: 30 },
  { amount: 74, minutes: 25 }, { amount: 80, minutes: 30 }, { amount: 88.8, minutes: 30 }, { amount: 118.4, minutes: 40 }, { amount: 120, minutes: 60 },
  { amount: 138, minutes: 60 }, { amount: 159.9, minutes: 60 }, { amount: 161, minutes: 60 }, { amount: 177.6, minutes: 60 },
];
const minutosDoPacoteLegado = (valor) => (PACOTES.find((p) => Math.round(p.amount * 100) === Math.round(valor * 100)) || {}).minutes;
function minutosComprados(valor, valorMinuto = 2.96) {
  if (!Number.isFinite(valor) || valor <= 0) return 0;
  if (Number.isFinite(valorMinuto) && valorMinuto > 0 && Math.abs(valorMinuto - 2.96) > 0.001) return Math.max(0, Math.round(valor / valorMinuto));
  const perto = PACOTES.reduce((c, p) => (Math.abs(p.amount - valor) < Math.abs(c.amount - valor) ? p : c));
  if (Math.abs(perto.amount - valor) <= 1) return perto.minutes;
  return Math.max(0, Math.round(valor / valorMinuto));
}

// --- domain/first-consultation-eligibility.ts ----------------------------------------------------------------------------
function elegibilidadePrimeira(clientId, em, consultas, perfil, horas = 24, exceptoId) {
  const anteriores = consultas.filter((c) => c.clientId === clientId && c.id !== exceptoId && consomeCobertura(c) && Date.parse(c.startedAt) <= Date.parse(em)).map((c) => c.startedAt);
  for (const m of (perfil && perfil.movements) || []) {
    if (m.kind !== 'consulta') continue;
    const [dia, mes, ano] = m.date.split('/');
    if (dia && mes && ano) anteriores.push(`${ano.length === 2 ? `20${ano}` : ano}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}T${m.time || '12:00'}:00-03:00`);
  }
  if (perfil && perfil.firstConsultationAt) anteriores.push(perfil.firstConsultationAt);
  const primeira = anteriores.filter((d) => Number.isFinite(Date.parse(d)) && Date.parse(d) <= Date.parse(em)).sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  const antigoConhecido = (perfil && perfil.hasPriorConsultations && !perfil.firstConsultationAt) || (!primeira && ((perfil && perfil.credit) || 0) !== 0);
  const first = !(perfil && perfil.paymentProfile === 'Pós-pago') && !antigoConhecido && (!primeira || Date.parse(em) - Date.parse(primeira) < horas * 3600000);
  return { first, firstAt: primeira, knownOld: antigoConhecido };
}

// --- domain/payment-dates.ts ---------------------------------------------------------------------------------------------
const pagoEm = (p) => { const v = p.paidAt || p.informedAt; return /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T06:00:00-03:00` : v; };

// --- domain/pricing.ts (tabela padrão VAL-001 e vigência) -----------------------------------------------------------------
const PRECOS_PADRAO = Object.freeze({
  id: 'VAL-001', pixKey: 'pix@fadasdobem.com.br', regularMinuteValue: 2.96, minimumMinutes: 15, firstConsultationWindowHours: 24,
  regularPrices: [{ minutes: 15, price: 44.4 }, { minutes: 20, price: 59.2 }, { minutes: 25, price: 74 }, { minutes: 30, price: 88.8 }, { minutes: 40, price: 118.4 }, { minutes: 60, price: 159.9, referencePrice: 177.6 }],
  firstConsultationPrices: [{ minutes: 15, price: 35 }, { minutes: 20, price: 46 }, { minutes: 30, price: 67, label: 'O mais pedido' }, { minutes: 60, price: 120, label: 'Ideal para leituras mais detalhadas' }],
  createdAt: '2026-09-01T10:39:00-03:00', effectiveAt: '2026-09-01T10:39:00-03:00', createdBy: 'Laya',
});
function valorDoMinuto(v) {
  if (Number.isFinite(v.regularMinuteValue) && v.regularMinuteValue > 0) return v.regularMinuteValue;
  const base = v.regularPrices.find((o) => o.minutes === v.minimumMinutes) || v.regularPrices[0];
  return base && base.minutes > 0 && base.price > 0 ? base.price / base.minutes : 2.96;
}
function precoVigente(historico, em = new Date().toISOString()) {
  const aplicaveis = historico.filter((v) => new Date(v.effectiveAt).getTime() <= new Date(em).getTime())
    .sort((a, b) => new Date(a.effectiveAt).getTime() - new Date(b.effectiveAt).getTime() || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return aplicaveis.reduce((atual, v) => {
    if (!v.changedFields) return { ...v, regularMinuteValue: valorDoMinuto(v) };
    const remendo = Object.fromEntries(v.changedFields.map((campo) => [campo, v[campo]]));
    return { ...atual, ...remendo, id: v.id, createdAt: v.createdAt, createdBy: v.createdBy, effectiveAt: v.effectiveAt, changedFields: v.changedFields };
  }, PRECOS_PADRAO);
}

module.exports = {
  contaMinutos, retemCoberturaDeCancelamento, consomeCobertura, taxaConhecida, valorRegistradoDoMinuto, usoDosBeneficios, ehOrigemDeBonus, beneficioDoBonus,
  usaOrigemDeBonusLegado, beneficiosDisponiveis, alocarLotes, fatiarLotes, minutosDoPacoteLegado, minutosComprados, elegibilidadePrimeira, pagoEm,
  PRECOS_PADRAO, valorDoMinuto, precoVigente, idNormalizado,
};
