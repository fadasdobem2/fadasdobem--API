'use strict';

/**
 * Correção de pagamento no servidor (Maturacao/42): porte de `applyPaymentCorrection`, `correctPaymentRecord` e `correctPaymentCell`
 * (`features/finance/payment-records.ts`) e de `cardGrossAfterAmountChange` (`payment-amounts.ts`). Mesmas recusas (transferência de saldo
 * preserva a compra, devolução em minutos preserva o valor, forma preservada com movimentações, piso do valor) e o MESMO texto de auditoria.
 */

const L = require('./pagamentos-livro');
const P = require('./pagamentos-preco');
const Lc = require('./pagamentos-lancamento');
const D = require('./pagamentos-datas');

const { erro, centavos } = L;
const json = JSON.stringify;

function brutoDepoisDaMudanca(anterior, bruto, proximo) {
  const taxa = (() => { const f = Math.round((Lc.lerDinheiro(bruto) - Lc.lerDinheiro(anterior)) * 100) / 100; return Number.isFinite(f) && f >= 0 ? Lc.textoDoDinheiro(f) : ''; })();
  if (!taxa) return bruto;
  return Lc.textoDoDinheiro((Math.round(Lc.lerDinheiro(proximo) * 100) + Math.round(Lc.lerDinheiro(taxa) * 100)) / 100);
}

/** `applyPaymentCorrection(payment, fields, actor, now)`; `campos`: valores normalizados + banco, titular, autorização, observação, compra, valor do minuto e `paidAt`. */
function aplicarCorrecao(p, campos, ator, agora) {
  const movs = p.movements || [];
  const mudouValorOuCompra = p.amount !== campos.amount || json(p.purchase) !== json(campos.purchase) || p.cashUnitValue !== campos.cashUnitValue;
  if (movs.some((m) => m.kind === 'balance-transfer') && (mudouValorOuCompra || p.paidAt !== campos.paidAt)) erro('Este pagamento originou transferência de saldo. Preserve o valor, a tarifa e a data da compra original.');
  if (movs.some((m) => m.creditSnapshot) && mudouValorOuCompra) erro('Este pagamento tem devolução de crédito registrada em minutos. Confira a devolução antes de alterar o valor ou os minutos da compra original.');
  if (movs.length) {
    if (campos.method !== p.method) erro('Este pagamento já tem movimentações. A forma precisa preservar a modalidade registrada no histórico.');
    const devolvido = movs.filter((m) => m.kind === 'refund').reduce((s, m) => s + Math.round(m.amount * 100), 0);
    const creditoDevolvido = -movs.filter((m) => m.kind !== 'balance-transfer').reduce((s, m) => s + Math.round(m.creditEffect * 100), 0);
    const retirado = -movs.reduce((s, m) => s + Math.round(m.bankEffect * 100), 0);
    const contestado = Math.max(0, ...movs.filter((m) => m.kind === 'dispute').map((m) => Math.round(m.amount * 100)));
    if (Math.round(campos.grossAmount * 100) < Math.max(devolvido, contestado, retirado) || Math.round(campos.amount * 100) < creditoDevolvido) erro('O novo valor não pode ser menor que as movimentações já registradas.');
  }
  const conhecida = D.dataPagaConhecida(p);
  const mudancas = [
    campos.paidAt && (!conhecida || new Date(D.dataPaga({ ...p, paidAt: campos.paidAt })).getTime() !== new Date(conhecida).getTime()) ? `pago em: ${p.paidAt || 'não disponível'} → ${campos.paidAt}` : '',
    json(p.purchase) !== json(campos.purchase) ? `compra: ${p.purchase ? Lc.descricaoDaCompra(p.purchase) : 'minutos não registrados'} → ${campos.purchase ? Lc.descricaoDaCompra(campos.purchase) : 'minutos não registrados'}` : '',
    p.amount !== campos.amount ? `valor ${L.moeda(p.amount)} → ${L.moeda(campos.amount)}` : '',
    (p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount) !== campos.grossAmount ? `total cobrado ${L.moeda(p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount)} → ${L.moeda(campos.grossAmount)}` : '',
    p.method !== campos.method ? `forma ${p.method} → ${campos.method}` : '',
    p.bank !== campos.bank ? `banco ${p.bank || 'não informado'} → ${campos.bank}` : '',
    (p.payerName || p.client) !== (campos.payerName || p.client) ? `titular ${p.payerName || p.client} → ${campos.payerName}` : '',
    (p.authorization || '') !== (campos.authorization || '') ? `autorização ${p.authorization || 'não informada'} → ${campos.authorization || 'não informada'}` : '',
    (p.note || '') !== (campos.note || '') ? `observação: ${p.note || 'sem observação'} → ${campos.note || 'sem observação'}` : '',
  ].filter(Boolean);
  if (!mudancas.length) return p;
  const confirmacao = p.confirmation;
  const taxaMudou = p.amount !== campos.amount || (p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount) !== campos.grossAmount || p.method !== campos.method;
  return {
    ...p, ...campos, confirmation: confirmacao, status: confirmacao === 'A confirmar' || (!confirmacao && p.status === 'Em conferência') ? 'Em conferência' : 'Corrigido',
    ...(taxaMudou ? { actualFee: undefined, feeCheckedAt: undefined, feeCheckedBy: undefined } : {}), updatedAt: agora, updatedBy: ator,
    audit: [...L.trilhaDeAuditoria(p), L.eventoDeAuditoria('Pagamento corrigido', mudancas.join('; '), ator, agora)],
  };
}

/** `correctPaymentRecord(payment, input, actor, now, pricing)`. */
function corrigirPagamento(p, entrada, ator, agora, pricing) {
  if (p.status === 'Cancelado') erro('Este pagamento está cancelado e não pode ser alterado.');
  L.validarNome(ator, 'Atendente');
  const campos = Lc.normalizarEntrada(entrada);
  const valorMudou = campos.amount !== p.amount || campos.method !== p.method;
  const compra = entrada.purchase ? P.compraDaForma(campos.amount, pricing, campos.method, entrada.purchase)
    : valorMudou ? (entrada.cashUnitValue || p.cashUnitValue ? undefined : P.compraDaForma(campos.amount, pricing, campos.method)) : p.purchase;
  const unitario = compra ? undefined : valorMudou ? entrada.cashUnitValue || p.cashUnitValue || (campos.method !== p.method ? P.valorRegular(pricing) : p.purchase ? p.purchase.amount / p.purchase.minutes : 2.96) : p.cashUnitValue;
  if (!Number.isFinite(unitario ?? 1) || (unitario ?? 1) <= 0) erro('Confira o valor do minuto de referência.');
  return aplicarCorrecao(p, { ...campos, paidAt: campos.paidAt || p.paidAt, purchase: compra, cashUnitValue: unitario }, ator, agora);
}

/** `correctPaymentCell(payment, field, value, actor, now, pricing, context)`: `campo` é `amount` ou `bank`. */
function corrigirCelula(p, campo, valor, ator, agora, pricing, contexto) {
  if (p.status === 'Cancelado') erro('Este pagamento está cancelado e não pode ser alterado.');
  L.validarNome(ator, 'Atendente');
  L.validarEscolha(campo, ['amount', 'bank'], 'Campo do pagamento');
  const campos = { amount: p.amount, grossAmount: p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount, method: p.method, bank: p.bank, payerName: p.payerName, authorization: p.authorization, note: p.note, purchase: p.purchase, cashUnitValue: p.cashUnitValue, paidAt: p.paidAt };
  if (campo === 'amount') {
    const anterior = p.amount.toFixed(2); const bruto = (p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount).toFixed(2);
    Object.assign(campos, Lc.normalizarValores({ amount: valor, method: p.method, grossAmount: p.method === 'Cartão de crédito' ? brutoDepoisDaMudanca(anterior, bruto, valor) : undefined }));
  } else {
    if (p.method === 'Dinheiro' && valor !== 'Caixa') erro('O pagamento em dinheiro pertence ao Caixa.');
    campos.bank = p.method === 'Dinheiro' ? 'Caixa' : L.validarEscolha(valor, ['Mercado Pago', 'Itaú Jurídica', 'Itaú', 'Santander', 'BB'], 'Banco');
  }
  if ((campo === 'amount' && campos.amount === p.amount) || (campo === 'bank' && campos.bank === p.bank)) return p;
  if (campo === 'amount') {
    const em = D.dataPaga(p);
    const aplicavel = contexto ? require('./financeiro-base').precoVigente(contexto.history, em) : pricing;
    const referencia = contexto ? P.referenciaDePreco(campos.amount, p.clientId, em, aplicavel, contexto, p, p.method) : undefined;
    campos.purchase = referencia ? referencia.purchase : P.compraDaForma(campos.amount, aplicavel, p.method);
    campos.cashUnitValue = campos.purchase ? undefined : p.purchase && p.purchase.table === 'custom' ? p.purchase.amount / p.purchase.minutes : (referencia && referencia.cashUnitValue) || p.cashUnitValue || (p.purchase ? p.purchase.amount / p.purchase.minutes : 2.96);
  }
  const conferido = aplicarCorrecao(p, campos, ator, agora);
  const detalhe = campo === 'bank' ? `banco ${p.bank || 'não informado'} → ${conferido.bank}`
    : `valor ${L.moeda(p.amount)} → ${L.moeda(conferido.amount)}${p.method === 'Cartão de crédito' ? `; total cobrado ${L.moeda(p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount)} → ${L.moeda(conferido.grossAmount === undefined || conferido.grossAmount === null ? conferido.amount : conferido.grossAmount)}` : ''}`;
  return {
    ...p, ...(campo === 'bank' ? { bank: conferido.bank } : { amount: conferido.amount, purchase: conferido.purchase, cashUnitValue: conferido.cashUnitValue, grossAmount: conferido.grossAmount, actualFee: conferido.actualFee, feeCheckedAt: conferido.feeCheckedAt, feeCheckedBy: conferido.feeCheckedBy }),
    status: conferido.status, confirmation: conferido.confirmation, updatedAt: agora, updatedBy: ator,
    audit: [...L.trilhaDeAuditoria(p), L.eventoDeAuditoria('Pagamento corrigido', detalhe + (campo === 'amount' && conferido.purchase ? `; ${Lc.descricaoDaCompra(conferido.purchase)}` : ''), ator, agora)],
  };
}

module.exports = { aplicarCorrecao, corrigirPagamento, corrigirCelula };
