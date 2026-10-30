'use strict';

/**
 * Lançamento de pagamento no servidor (Maturacao/42): porte de `normalizePaymentInput`, `createPaymentRecord` e `paymentInputFromRecord`
 * (`features/finance/payment-records.ts`), `parsePaymentMoney` (`payment-amounts.ts`) e `validatePaymentDate` (`domain/payment-dates.ts`).
 * O servidor refaz a função do front com a entrada que o registro do navegador revela e exige o registro IGUAL (ver `pagamentos-refazer-lancamento.js`).
 */

const L = require('./pagamentos-livro');
const P = require('./pagamentos-preco');
const R = require('./pagamentos-regras');

const { erro, centavos, arredondar } = L;
const NUMERICO = 64;

/** `parsePaymentMoney`. */
function lerDinheiro(valor) {
  const cru = valor.replace(/R\$/gi, '').replace(/\s/g, '');
  const normal = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normal)) return NaN;
  const cents = Math.round(Number(normal) * 100);
  return Number.isSafeInteger(cents) ? cents / 100 : NaN;
}
const textoDoDinheiro = (v) => (Number.isFinite(v) ? v.toFixed(2).replace('.', ',') : '');

/** `validatePaymentDate`: devolve a data (ou `undefined`) ou lança a frase do front. */
function validarDataDoPagamento(v) {
  if (v === undefined) return undefined;
  R.dataDoPagamento(v);
  return v;
}

/** `normalizePaymentAmounts`. */
function normalizarValores(entrada) {
  const texto = L.validarTexto(entrada.amount, { rotulo: 'Valor do pagamento', max: NUMERICO, obrigatorio: true });
  const forma = L.validarEscolha(entrada.method, ['PIX', 'Cartão de crédito', 'Transferência', 'Depósito', 'Dinheiro'], 'Forma de pagamento');
  const textoBruto = entrada.grossAmount === undefined ? undefined : L.validarTexto(entrada.grossAmount, { rotulo: 'Total cobrado no cartão', max: NUMERICO });
  const cru = texto.replace(/R\$/gi, '').replace(/\s/g, '');
  const normal = cru.includes(',') ? cru.replace(/\./g, '').replace(',', '.') : cru;
  if (!/^\d+(?:\.\d{1,2})?$/.test(normal) || Number(normal) <= 0 || !Number.isSafeInteger(Math.round(Number(normal) * 100))) erro('Informe um valor de pagamento válido, com até duas casas decimais.');
  const valor = Math.round(Number(normal) * 100) / 100;
  if (entrada.method === 'Cartão de crédito' && entrada.grossAmount !== undefined && !entrada.grossAmount.trim()) erro('Informe o total cobrado no cartão.');
  const brutoCru = (textoBruto && textoBruto.replace(/R\$/gi, '').replace(/\s/g, '')) || normal;
  const brutoNormal = brutoCru.includes(',') ? brutoCru.replace(/\./g, '').replace(',', '.') : brutoCru;
  const bruto = entrada.method === 'Cartão de crédito' ? Math.round(Number(brutoNormal) * 100) / 100 : valor;
  if (entrada.method === 'Cartão de crédito' && (!/^\d+(?:\.\d{1,2})?$/.test(brutoNormal) || !Number.isFinite(bruto) || !Number.isSafeInteger(Math.round(bruto * 100)) || bruto < valor)) erro('O total cobrado no cartão deve ser igual ou maior que o valor para consultas.');
  return { amount: valor, grossAmount: bruto, method: forma };
}

/** `normalizePaymentInput`. */
function normalizarEntrada(entrada) {
  const valores = normalizarValores(entrada);
  return {
    ...valores, paidAt: validarDataDoPagamento(entrada.paidAt),
    bank: entrada.method === 'Dinheiro' ? 'Caixa' : L.validarEscolha(entrada.bank, ['Mercado Pago', 'Itaú Jurídica', 'Itaú', 'Santander', 'BB'], 'Banco'),
    payerName: L.validarNome(entrada.payerName, 'Em nome de quem'),
    authorization: L.validarTexto(entrada.authorization, { rotulo: 'Autorização', max: 100 }) || undefined,
    note: L.validarObservacao(entrada.note) || undefined,
  };
}

/** `paymentInputFromRecord`. */
function entradaDoRegistro(p) {
  return {
    paidAt: p.paidAt, amount: textoDoDinheiro(p.amount), grossAmount: textoDoDinheiro(p.grossAmount === undefined ? p.amount : p.grossAmount), method: p.method, bank: p.bank || 'Mercado Pago',
    payerName: p.payerName || p.client, authorization: p.authorization || '', note: p.note || '',
  };
}

const descricaoDaCompra = (c) => `${rotuloDaTabela(c.table)} · ${c.minutes} min por ${L.moeda(c.amount)} · ${L.moeda(c.amount / c.minutes)}/min`;
const rotuloDaTabela = (t) => (t === 'first' ? 'Primeira consulta' : t === 'regular' ? 'Demais consultas' : 'Valor combinado');

/** `createPaymentRecord(input, client, actor, now, id, linkedConsultationId, pricing)`. */
function criarPagamento(entrada, cliente, ator, agora, id, vinculada, pricing) {
  if (!cliente.clientId || !cliente.client) erro('Localize a cliente pelo ID antes de salvar.');
  if (typeof cliente.clientId !== 'string' || !/^\d{1,10}$/.test(cliente.clientId) || Number(cliente.clientId) < 1 || Number(cliente.clientId) > 2147483647) erro('ID da cliente: informe um número de 1 a 2147483647, sem cortar dígitos.');
  L.validarNome(cliente.client, 'Cliente'); L.validarNome(ator, 'Atendente');
  const campos = normalizarEntrada(entrada);
  if (entrada.purchase && entrada.purchase.table === 'first' && campos.method !== 'PIX') erro('O valor de primeira consulta é exclusivo para Pix.');
  const compra = entrada.cashUnitValue ? undefined : P.compraDaForma(campos.amount, pricing, campos.method, entrada.purchase);
  const unitario = compra ? undefined : entrada.cashUnitValue || P.valorRegular(pricing);
  if (!Number.isFinite(unitario ?? 1) || (unitario ?? 1) <= 0) erro('Confira o valor do minuto de referência.');
  const audit = [L.eventoDeAuditoria('Pagamento informado', `${L.moeda(campos.amount)} · ${campos.method} · ${campos.bank} · em nome de ${campos.payerName}${campos.method === 'Cartão de crédito' ? ` · cobrado ${L.moeda(campos.grossAmount)} · taxa calculada ${L.moeda(campos.grossAmount - campos.amount)}` : ''}`, ator, agora)];
  if (vinculada) audit.push(L.eventoDeAuditoria('Pagamento vinculado', 'Vinculado à consulta ao lançar o pagamento.', ator, agora));
  if (compra) audit.push(L.eventoDeAuditoria('Preço da compra', descricaoDaCompra(compra), ator, agora));
  return { id, ...cliente, ...campos, paidAt: campos.paidAt || agora, purchase: compra, cashUnitValue: unitario, informedAt: agora, informedBy: ator, status: 'Informado', linkedConsultationId: vinculada, audit };
}

module.exports = { lerDinheiro, textoDoDinheiro, validarDataDoPagamento, normalizarValores, normalizarEntrada, entradaDoRegistro, descricaoDaCompra, criarPagamento };
