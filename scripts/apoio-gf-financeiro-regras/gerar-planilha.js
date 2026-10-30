'use strict';

/**
 * Ouro de PLANILHA e CORREÇÃO de pagamento (Maturacao/42, itens 3 e 4): `correctSpreadsheetPayment` (todos os campos, com e sem movimento, por papel),
 * `correctPaymentRecord` (o diálogo "Editar pagamento", com a referência de preço da tela) REAIS do front sobre bases x movimentos x mudanças.
 */

const { AGORA, CLIENTE, OUTRA, NOME, semente, dia, tentar, limpar, perfil, consulta, BASES, criarBase } = require('./fabrica');

const CAMPOS = ['paidAt', 'clientId', 'amount', 'minutes', 'method', 'bank', 'confirmation', 'grossAmount', 'actualFee', 'payerName', 'authorization', 'note'];
const VALORES = {
  paidAt: ['2026-10-29', '2026-10-30', '2026-10-28T10:30', '2026-02-30', 'ontem', '2026-10-12T10:00', '2026-10-30T10:00'], clientId: [OUTRA, '999999', CLIENTE, 'abc', '0', ''],
  amount: ['100,00', '88,80', '44,40', '120,00', '5,00', '35,00', '0,00', 'x', '1.000,00', '50,55'], minutes: ['15', '30', '7', 'x', '0', ''], method: ['PIX', 'Cartão de crédito', 'Transferência', 'Dinheiro', 'Depósito', 'Cheque'],
  bank: ['Mercado Pago', 'BB', 'Caixa', 'Nubank', 'Itaú Jurídica'], confirmation: ['Confirmado', 'A confirmar', 'Outro'], grossAmount: ['95,00', '88,80', '200,00', '10,00', 'x'], actualFee: ['3,00', '0,00', '500,00', 'x', '-1'],
  payerName: ['Bia Lima', '', 'x'.repeat(201), 'a\u0001b'], authorization: ['999', '', 'x'.repeat(101)], note: ['Nova nota.', '', 'x'.repeat(4001), 'a\u0001b'],
};
const mov = (id, kind, amount, bank, credit, extra = {}) => ({ id, kind, amount, bankEffect: bank, creditEffect: credit, occurredAt: '2026-10-29T15:00:00.000Z', recordedAt: '2026-10-29T15:00:00.000Z', actor: 'Clara', note: 'ok', operationSignature: '{}', ruleVersion: 1, ...extra });
const MOVIMENTOS = [[], [mov('m1', 'refund', 10, -10, -10)], [mov('m1', 'dispute', 30, 0, 0)], [mov('m1', 'refund', 20, -20, -20, { creditSnapshot: { source: 'remaining-credit', unitValue: 2.96, minutesEffect: -6, before: { minutes: 30, amount: 88.8 }, after: { minutes: 24, amount: 68.8 } } })]];

function gerar(fr, quantos = 340) {
  const cenarios = [];
  const clientes = { [CLIENTE]: NOME[CLIENTE], [OUTRA]: NOME[OUTRA] };
  const padrao = fr.precos.defaultFinancialSettings;
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(21000 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const base = BASES[n % BASES.length];
    let p = criarBase(fr, base, CLIENTE, `PG-${n}`, dia(pick([0, 3, 8])));
    const movs = pick(MOVIMENTOS);
    if (movs.length) p = { ...p, movements: movs };
    if (r() < 0.04) p = { ...p, status: 'Cancelado' };
    if (r() < 0.15) p = { ...p, linkedConsultationId: 'K1' };
    const consultas = r() < 0.5 ? [] : [consulta({ id: 'K1', durationSeconds: 900, dia: 3, billing: { tariff: { table: 'regular', source: 'purchase', unitValue: 2.96, resolvedAt: dia(3), paymentIds: [p.id] } } })];
    const outros = r() < 0.5 ? [criarBase(fr, BASES[0], CLIENTE, `PG-${n}-b`, dia(1))] : [];
    const pagamentos = [p, ...outros];
    const historico = pick([[], [], [{ id: 'VAL-002', createdAt: '2026-10-05T10:00:00-03:00', effectiveAt: '2026-10-05T10:00:00-03:00', createdBy: 'Laya', changedFields: ['regularPrices'], regularPrices: [{ minutes: 15, price: 48 }, { minutes: 30, price: 96 }] }]]);
    const perfis = { [CLIENTE]: perfil(CLIENTE, {}) };
    for (let i = 0; i < 6; i += 1) {
      const campo = pick(CAMPOS); const valor = pick(VALORES[campo]);
      const papel = r() < 0.92 ? pick(['administradora', 'assistente']) : pick(['supervisora', 'atendente', 'tarologa']);
      const idMov = movs.length && ['paidAt', 'amount', 'note'].includes(campo) && r() < 0.5 ? 'm1' : undefined;
      const entrada = { payments: pagamentos, consultations: consultas, role: papel, paymentId: p.id, ...(idMov ? { movementId: pick([idMov, idMov, 'zz']) } : {}), field: pick([campo, campo, campo, campo, campo, campo, campo, campo, campo, campo, campo, campo, 'zzz']), value: valor, actor: pick(['Clara', 'Clara', 'Clara', 'Clara', 'Clara', 'Clara', 'Clara', '']), now: AGORA, pricing: padrao, pricingHistory: historico.length ? historico : [padrao], clients: clientes, clientProfiles: perfis };
      const res = tentar(() => fr.planilha.correctSpreadsheetPayment(entrada));
      cenarios.push({ tipo: 'planilha', entrada: limpar(entrada), esperado: res.ok ? { ok: limpar(res.ok === p ? { igual: true } : res.ok) } : { erro: res.erro } });
    }
    // diálogo "Editar pagamento": entrada de texto + referência de preço da tela
    for (let i = 0; i < 6; i += 1) {
      const ent = fr.registros.paymentInputFromRecord(p);
      const mud = pick([{}, { amount: '100,00' }, { amount: '88,80' }, { amount: '120,00' }, { amount: '5,00' }, { method: 'Cartão de crédito', grossAmount: '120,00' }, { method: 'Transferência' }, { method: 'Dinheiro' }, { bank: 'BB' }, { paidAt: '2026-10-28' },
        { payerName: 'Bia' }, { payerName: '' }, { note: 'Nova nota.' }, { authorization: '777' }, { grossAmount: '40,00' }, { amount: '35,00', method: 'PIX' }, { amount: '44,40' }]);
      const entrada = { ...ent, ...mud };
      const contexto = { consultations: consultas, profiles: perfis, history: historico };
      const valorNum = fr.registros.normalizePaymentInput ? tentar(() => fr.registros.normalizePaymentInput(entrada)) : { erro: 'x' };
      let completa = entrada;
      if (valorNum.ok) {
        const ref = tentar(() => fr.referencia.paymentPricingReference(valorNum.ok.amount, p.clientId, p.paidAt || p.informedAt, padrao, contexto, p, entrada.method));
        if (ref.ok) completa = { ...entrada, ...(ref.ok.purchase ? { purchase: ref.ok.purchase } : {}), ...(ref.ok.cashUnitValue ? { cashUnitValue: ref.ok.cashUnitValue } : {}) };
      }
      const pricing = fr.precos.effectivePricing(historico.length ? historico : [padrao], AGORA);
      const res = tentar(() => fr.registros.correctPaymentRecord(p, completa, 'Clara', AGORA, pricing));
      cenarios.push({ tipo: 'registro', antes: limpar(p), entrada: limpar(completa), ator: 'Clara', agora: AGORA, pricing: limpar(pricing), esperado: res.ok ? { ok: limpar(res.ok === p ? { igual: true } : res.ok) } : { erro: res.erro } });
    }
  }
  return cenarios;
}

module.exports = { gerar };
