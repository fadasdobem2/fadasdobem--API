'use strict';

/**
 * Ouro de COMPRA e LANÇAMENTO (Maturacao/42, item 4): `paymentPricingReference` (a compra/valor do minuto que a tela escolhe) e `createPaymentRecord`
 * REAIS do front sobre contextos sorteados (tabelas de preço com vigência, primeira consulta por histórico, data só do dia ou com hora, edição).
 */

const { AGORA, CLIENTE, semente, dia, tentar, limpar, perfil, consulta } = require('./fabrica');

const VALORES = ['35,00', '44,40', '46,00', '59,20', '67,00', '88,80', '120,00', '159,90', '100,00', '50,55', '74,00', '118,40', '10,00'];
const VAL2 = { id: 'VAL-002', createdAt: '2026-10-05T10:00:00-03:00', effectiveAt: '2026-10-05T10:00:00-03:00', createdBy: 'Laya', changedFields: ['regularPrices', 'regularMinuteValue'], regularMinuteValue: 3.2, regularPrices: [{ minutes: 15, price: 48 }, { minutes: 20, price: 64 }, { minutes: 30, price: 96 }] };
const VAL3 = { id: 'VAL-003', createdAt: '2026-10-12T10:00:00-03:00', effectiveAt: '2026-10-12T10:00:00-03:00', createdBy: 'Laya', changedFields: ['firstConsultationPrices'], firstConsultationPrices: [{ minutes: 15, price: 40 }, { minutes: 30, price: 70 }] };
const HISTORICOS = [[], [], [VAL2], [VAL2, VAL3], [VAL3]];

function gerar(fr, quantos = 700) {
  const cenarios = [];
  const padrao = fr.precos.defaultFinancialSettings;
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(15000 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const historico = pick(HISTORICOS);
    const consultas = r() < 0.5 ? [] : [consulta({ id: `K${n}`, durationSeconds: pick([0, 900, 1200]), status: pick(['Concluída', 'Cancelada', 'Em curso', 'Não houve']), dia: pick([0, 5, 9, 12, 19]) })];
    const perfilCliente = perfil(CLIENTE, { ...(r() < 0.2 ? { hasPriorConsultations: true } : {}), ...(r() < 0.15 ? { paymentProfile: 'Pós-pago' } : {}), ...(r() < 0.1 ? { firstConsultationAt: dia(pick([0, 8])) } : {}), credit: pick([0, 0, 0, 20]) });
    const contexto = { consultations: consultas, profiles: { [CLIENTE]: perfilCliente }, history: historico };
    const em = pick([dia(pick([3, 8, 11, 14, 25])), '2026-10-30T15:00:00.000Z', '2026-10-12', '2026-10-05', '2026-10-30', '2026-10-09T23:59:00-03:00']);
    const metodo = pick(['PIX', 'PIX', 'PIX', 'Cartão de crédito', 'Transferência', 'Dinheiro']);
    const valor = pick(VALORES);
    const numero = Number(valor.replace(',', '.'));
    let editando = null;
    if (r() < 0.3) {
      const base = { method: pick(['PIX', 'Cartão de crédito']), amount: pick(VALORES), bank: 'Itaú', payerName: 'Ana Souza', authorization: '', note: '', ...(r() < 0.3 ? { cashUnitValue: 3.1 } : {}) };
      const criado = tentar(() => fr.registros.createPaymentRecord(base.method === 'Cartão de crédito' ? { ...base, grossAmount: '200,00' } : base, { clientId: CLIENTE, client: 'Ana Souza' }, 'Khloe', dia(2), 'PG-ED', undefined, padrao));
      if (criado.ok) editando = criado.ok;
    }
    const ref = tentar(() => fr.referencia.paymentPricingReference(numero, CLIENTE, em, padrao, contexto, editando, metodo));
    cenarios.push({ tipo: 'referencia', valor: numero, clientId: CLIENTE, em, contexto: limpar(contexto), editando: limpar(editando), metodo, esperado: ref.ok ? { ok: limpar(ref.ok) } : { erro: ref.erro } });

    // lançamento: a tela monta o PaymentInput com a referência que ela mesma calculou
    const refTela = ref.ok;
    const entrada = { method: metodo, amount: valor, bank: metodo === 'Dinheiro' ? 'Caixa' : pick(['Mercado Pago', 'Itaú', 'BB', 'Santander', 'Caixa', 'Nubank']), payerName: pick(['Ana Souza', 'Ana Souza', 'Ana Souza', '', 'x'.repeat(201)]), authorization: pick(['', '123', 'x'.repeat(101)]), note: pick(['', 'Pagou no domingo.', 'a\u0001b']) };
    if (metodo === 'Cartão de crédito') entrada.grossAmount = pick(['', '95,00', '300,00', '10,00', `${valor}`]);
    if (r() < 0.6) entrada.paidAt = pick([em.length === 10 ? em : undefined, '2026-10-28', '2026-02-30', '2026-10-30T10:00:00-03:00'].filter((v) => v !== undefined || true));
    if (refTela && r() < 0.85) { if (refTela.purchase) entrada.purchase = refTela.purchase; if (refTela.cashUnitValue) entrada.cashUnitValue = refTela.cashUnitValue; }
    else if (r() < 0.5) { entrada.purchase = pick([{ table: 'custom', minutes: 20, amount: numero }, { table: 'first', minutes: 15, amount: numero }, { table: 'regular', minutes: 15, amount: 1 }]); }
    else if (r() < 0.3) entrada.cashUnitValue = pick([3, 0, -1]);
    const ator = pick(['Khloe', 'Khloe', '']);
    const agora = pick([AGORA, AGORA, '2026-10-12T15:00:00.000Z']);
    const vinculada = r() < 0.2 ? 'C-1' : undefined;
    const pricing = fr.precos.effectivePricing(historico.length ? historico : [padrao], agora);
    const cliente = { clientId: pick([CLIENTE, CLIENTE, CLIENTE, CLIENTE, '', '0']), client: 'Ana Souza' };
    const cri = tentar(() => fr.registros.createPaymentRecord(entrada, cliente, ator, agora, `PG-${n}`, vinculada, pricing));
    cenarios.push({ tipo: 'criar', entrada: limpar(entrada), cliente, ator, agora, id: `PG-${n}`, vinculada, pricing: limpar(pricing), esperado: cri.ok ? { ok: limpar(cri.ok) } : { erro: cri.erro } });
  }
  return cenarios;
}

module.exports = { gerar };
