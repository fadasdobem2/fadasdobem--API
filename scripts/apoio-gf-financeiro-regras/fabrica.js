'use strict';

/**
 * Fábrica dos cenários do ouro de Financeiro (Maturacao/42): pagamentos criados pelo `createPaymentRecord` REAL do front, histórico de movimentos
 * montado pelas funções reais (`recordPaymentMovement`, `recordRemainingCreditRefund`, `recordFinancialOccurrence`...), semente fixa (mulberry32),
 * relógio fixo. Nada aqui usa relógio nem aleatoriedade do ambiente. Todo valor é fictício.
 */

const AGORA = '2026-10-30T15:00:00.000Z';
const CLIENTE = '900100';
const OUTRA = '900200';
const NOME = { [CLIENTE]: 'Ana Souza', [OUTRA]: 'Beta Lima' };

function semente(n) {
  let a = n >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const dia = (n, min = 0) => new Date(Date.parse('2026-10-10T16:00:00.000Z') + n * 86400000 + min * 60000).toISOString();
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const limpar = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

/** Perfil de crédito da cliente (a tela passa o do catálogo; o servidor monta o dele). */
const perfil = (id = CLIENTE, extra = {}) => ({ clientId: id, name: NOME[id] || 'Cliente', paymentProfile: 'Pré-pago', birthDate: '', whatsapp: '', credit: 0, creditUpdatedAt: '', movements: [], neverTarotIds: [], ...extra });

function consulta(o) {
  const inicio = o.startedAt || dia(o.dia || 0, 120);
  const seg = o.durationSeconds ?? 0;
  const status = o.status || 'Concluída';
  return {
    id: o.id, clientId: o.clientId || CLIENTE, client: NOME[o.clientId || CLIENTE], tarotId: 'osiris', tarot: 'Osíris', status, startedAt: inicio,
    endedAt: status === 'Em curso' ? undefined : new Date(Date.parse(inicio) + seg * 1000).toISOString(), durationSeconds: seg,
    paymentProfile: o.paymentProfile || 'Pré-paga', channel: 'WhatsApp', attendant: 'Khloe', observation: '', updatedAt: inicio, audit: [], commissionRate: 30,
    ...(o.coverage ? { coverage: { registeredBy: 'Khloe', registeredAt: inicio, ...o.coverage } } : {}),
    billing: { minimumMinutes: 15, minimumWaived: false, funding: [], ...(o.billing || {}) },
  };
}

/** Pagamentos-base criados pelo front real. `fr.registros` = `payment-records.ts`. */
const BASES = [
  { chave: 'pix100', entrada: { method: 'PIX', amount: '100,00', bank: 'Mercado Pago', payerName: 'Ana Souza', authorization: '', note: '' }, confirma: true },
  { chave: 'pix888', entrada: { method: 'PIX', amount: '88,80', bank: 'BB', payerName: 'Ana Souza', authorization: '', note: '' }, confirma: true },
  { chave: 'pix888-informado', entrada: { method: 'PIX', amount: '88,80', bank: 'Itaú', payerName: 'Ana Souza', authorization: '', note: '' }, confirma: false },
  { chave: 'cartao', entrada: { method: 'Cartão de crédito', amount: '88,80', grossAmount: '95,00', bank: 'Itaú', payerName: 'Ana Souza', authorization: '123', note: '' }, confirma: true },
  { chave: 'transf120', entrada: { method: 'Transferência', amount: '120,00', bank: 'Santander', payerName: 'Ana Souza', authorization: '', note: '' }, confirma: true },
  { chave: 'dinheiro', entrada: { method: 'Dinheiro', amount: '44,40', bank: 'Caixa', payerName: 'Ana Souza', authorization: '', note: '' }, confirma: true },
];

function criarBase(fr, base, clientId = CLIENTE, id = `PG-${base.chave}`, momento = dia(0)) {
  const p = fr.registros.createPaymentRecord(base.entrada, { clientId, client: NOME[clientId] }, 'Khloe', momento, id, undefined, fr.precos.defaultFinancialSettings);
  return base.confirma ? { ...p, confirmation: 'Confirmado' } : p;
}

module.exports = { AGORA, CLIENTE, OUTRA, NOME, semente, dia, tentar, limpar, perfil, consulta, BASES, criarBase };
