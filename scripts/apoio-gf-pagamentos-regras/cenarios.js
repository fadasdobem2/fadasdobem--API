'use strict';

/**
 * Entradas (sem rodar o front) dos casos de ouro das regras de Pagamentos (Maturacao/41). O gerador roda o CÓDIGO REAL do front sobre elas.
 * Gerador pseudo-aleatório fixo: o mesmo ouro a cada execução. Todo valor é fictício.
 */

let semente = 20261130;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (lista) => lista[Math.floor(aleatorio() * lista.length)];

const METODOS = ['PIX', 'Cartão de crédito', 'Transferência', 'Depósito', 'Dinheiro'];
const BANCOS = ['Mercado Pago', 'Itaú Jurídica', 'Itaú', 'Santander', 'BB', 'BB', 'Mercado Pago', 'Caixa', 'Nubank', ''];
const VALORES = ['44,40', '59,20', '35,00', '46,00', '88,80', '100,00', '159,90', '10,50', '72,30', '35.00'];
const BRUTOS = [undefined, '', '47,70', '44,40', '40,00', '35,00', '99,99', '200,00'];
const NOMES = ['Maria Souza', ' Ana ', '', '   ', 'x'.repeat(200), 'x'.repeat(201), 'a\u0001b', 'João\nSilva', 'Bia 😀'];
const AUTORIZACOES = ['', '123456', 'x'.repeat(100), 'x'.repeat(101), 'a\tb', 'ok\u0007'];
const NOTAS = ['', 'Pagou no domingo.', 'linha 1\nlinha 2', 'x'.repeat(4000), 'x'.repeat(4001), 'a\u0000b'];
const DATAS = [undefined, '2026-10-30', '2026-02-30', '2026-13-01', '2026-10-30T10:00:00-03:00', '2026-10-30T10:00:00Z', '2026-10-30T10:00', 'ontem', '2026-10-29T25:00:00Z', '2026-12-31'];
const COMPRAS = [undefined, undefined, undefined, { table: 'first', minutes: 15, amount: 35 }, { table: 'regular', minutes: 15, amount: 44.4 }, { table: 'custom', minutes: 20, amount: 72.3 }, { table: 'first', minutes: 30, amount: 67 }];
const UNITARIOS = [undefined, undefined, undefined, undefined, 2.96, 3.1, 0, -1];

/** Entradas de `createPaymentRecord`. */
function entradasNovo(n) {
  const lista = [];
  for (let i = 0; i < n; i += 1) {
    const method = sorteio(METODOS);
    const entrada = {
      method, amount: sorteio(VALORES), bank: sorteio(BANCOS), payerName: i % 3 ? 'Maria Souza' : sorteio(NOMES), authorization: i % 4 ? '' : sorteio(AUTORIZACOES),
      note: i % 4 ? '' : sorteio(NOTAS),
    };
    const paidAt = i % 5 ? undefined : sorteio(DATAS);
    if (paidAt !== undefined) entrada.paidAt = paidAt;
    if (method === 'Cartão de crédito' || i % 11 === 0) { const g = sorteio(BRUTOS); if (g !== undefined) entrada.grossAmount = g; }
    const compra = sorteio(COMPRAS); if (compra) entrada.purchase = compra;
    const unit = sorteio(UNITARIOS); if (unit !== undefined) entrada.cashUnitValue = unit;
    lista.push(entrada);
  }
  // Combinações garantidas (limites e regras uma a uma).
  const base = { method: 'PIX', amount: '44,40', bank: 'Mercado Pago', payerName: 'Maria Souza', authorization: '', note: '' };
  lista.push(base, { ...base, method: 'Dinheiro', bank: 'Itaú' }, { ...base, method: 'Cartão de crédito', grossAmount: '47,70' }, { ...base, method: 'Cartão de crédito', grossAmount: '40,00' },
    { ...base, method: 'Transferência', purchase: { table: 'first', minutes: 15, amount: 44.4 } }, { ...base, bank: 'Caixa' }, { ...base, payerName: '' }, { ...base, note: 'x'.repeat(4001) },
    { ...base, authorization: 'x'.repeat(101) }, { ...base, paidAt: '2026-02-30' }, { ...base, paidAt: '2026-10-30T10:00' });
  return lista;
}

const ID_CLIENTE = '12345';
const CLIENTE = 'Ana Souza';

/** Pagamentos-base da revisão, a partir de entradas do front (o gerador as cria com `createPaymentRecord`). */
const BASES = [
  { chave: 'pix', entrada: { method: 'PIX', amount: '100,00', bank: 'Mercado Pago', payerName: 'Ana Souza', authorization: '', note: '' } },
  { chave: 'cartao', entrada: { method: 'Cartão de crédito', amount: '88,80', grossAmount: '95,00', bank: 'Itaú', payerName: 'Ana Souza', authorization: '123', note: '' } },
  { chave: 'dinheiro', entrada: { method: 'Dinheiro', amount: '44,40', bank: 'Caixa', payerName: 'Ana Souza', authorization: '', note: 'Em mãos.' } },
  { chave: 'primeira', entrada: { method: 'PIX', amount: '35,00', bank: 'BB', payerName: 'Ana Souza', authorization: '', note: '', purchase: { table: 'first', minutes: 15, amount: 35 } } },
];

const mov = (id, kind, amount, bankEffect, creditEffect, extra = {}) => ({ id, kind, amount, bankEffect, creditEffect, occurredAt: '2026-10-29T12:00:00-03:00', actor: 'Clara', note: 'ok', ...extra });
/** Movimentações que o front lê em `applyPaymentCorrection` (tipo, valor, efeitos e retrato do crédito). */
const MOVIMENTOS = [
  [], [mov('m1', 'refund', 10, -10, -10)], [mov('m1', 'refund', 60, -60, -60)], [mov('m1', 'dispute', 50, 0, 0)], [mov('m1', 'dispute-debit', 30, -30, -30)],
  [mov('m1', 'balance-transfer', 20, 0, -20)], [mov('m1', 'refund', 10, -10, -10, { creditSnapshot: { minutes: 3 } })], [mov('m1', 'refund', 80, -80, 0)],
];

/** Mudanças de `PaymentInput` sobre o registro (mescladas com `paymentInputFromRecord`). */
const MUDANCAS = [
  {}, { amount: '100,00' }, { amount: '80,00' }, { amount: '50,00' }, { amount: '120,00' }, { amount: '5,00' }, { grossAmount: '95,00' }, { grossAmount: '90,00' }, { grossAmount: '70,00' }, { grossAmount: '40,00' },
  { method: 'PIX' }, { method: 'Cartão de crédito', grossAmount: '120,00' }, { method: 'Transferência' }, { method: 'Dinheiro' }, { bank: 'BB' }, { bank: 'Caixa' }, { bank: 'Nubank' },
  { paidAt: '2026-10-29' }, { paidAt: '2026-10-30T10:00:00-03:00' }, { paidAt: '2026-13-01' }, { paidAt: '2026-10-30T10:00' }, { payerName: 'Bia' }, { payerName: '' }, { payerName: 'a\u0001b' },
  { authorization: '999' }, { authorization: 'x'.repeat(101) }, { note: 'Nova nota.' }, { note: 'x'.repeat(4001) },
  { amount: '120,00', method: 'Cartão de crédito', grossAmount: '130,00' }, { amount: '60,00', paidAt: '2026-10-28' },
  { purchase: { table: 'first', minutes: 15, amount: 35 }, amount: '35,00', method: 'Transferência' },
];

const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];

module.exports = { entradasNovo, BASES, MOVIMENTOS, MUDANCAS, PAPEIS, ID_CLIENTE, CLIENTE, sorteio, aleatorio };
