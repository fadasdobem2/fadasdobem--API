'use strict';

/**
 * Edição em planilha no servidor (Maturacao/42): porte de `correctSpreadsheetPayment` (`features/finance/payment-spreadsheet-correction.ts`), que corrige
 * UM campo de um pagamento ou de um movimento dele: data, cliente, valor, minutos, forma, conta, confirmação, total cobrado, taxa, titular,
 * autorização e observação. Só Financeiro e Administração. As frases e o resultado são os do front; o preço e a compra vêm da tabela REAL.
 * O texto-guia de cada função de apoio está nos módulos `pagamentos-correcao.js`, `pagamentos-preco.js`, `pagamentos-correcao-movimento.js`.
 */

const L = require('./pagamentos-livro');
const P = require('./pagamentos-preco');
const Lc = require('./pagamentos-lancamento');
const D = require('./pagamentos-datas');
const C = require('./pagamentos-correcao');
const { corrigirMovimento } = require('./pagamentos-correcao-movimento');
const { validarComplementoDoPagamento } = require('./pagamentos-complemento');
const b = require('./financeiro-base');

const { erro } = L;
const CAMPOS = ['paidAt', 'clientId', 'amount', 'minutes', 'method', 'bank', 'confirmation', 'grossAmount', 'actualFee', 'payerName', 'authorization', 'note'];
const FORMAS = ['PIX', 'Cartão de crédito', 'Transferência', 'Depósito', 'Dinheiro'];
const rotuloDeConfirmacao = (p) => (p.status === 'Cancelado' ? 'Cancelado' : p.confirmation === 'Confirmado' ? 'Confirmado' : L.recebimentoConfirmado(p) ? 'Informado' : 'A confirmar');

/**
 * `correctSpreadsheetPayment({ payments, consultations, role, paymentId, movementId, field, value, actor, now, pricing, pricingHistory, clients, clientProfiles })`.
 * `papel`: perfil do ator; `clientes`: `{ id: nome }` das clientes que EXISTEM (o servidor confere o cadastro).
 */
function corrigirNaPlanilha({ payments, consultations, role, paymentId, movementId, field, value, actor, now, pricing, pricingHistory, clients, clientProfiles = {} }) {
  if (role !== 'administradora' && role !== 'assistente') erro('Edição em planilha disponível para administradora e assistente.');
  L.validarNome(actor, 'Responsável');
  L.validarEscolha(field, CAMPOS, 'Campo');
  const p = payments.find((x) => x.id === paymentId);
  if (!p) erro('Pagamento não localizado.');
  if (p.status === 'Cancelado') erro('Este pagamento está cancelado.');
  if (movementId) {
    if (!['paidAt', 'amount', 'note'].includes(field)) erro('Este dado pertence ao pagamento de origem.');
    const m = (p.movements || []).find((x) => x.id === movementId);
    if (!m) erro('Movimento não localizado.');
    if (field === 'paidAt' && value === D.entradaDeData(m.occurredAt)) return p;
    return corrigirMovimento(p, movementId, { amount: field === 'amount' ? Lc.lerDinheiro(value) : m.amount, occurredAt: field === 'paidAt' ? D.dataDaEntrada(value) : m.occurredAt, note: field === 'note' ? value : m.note }, actor, now, { payments, consultations, profile: clientProfiles[p.clientId] });
  }
  const contexto = { consultations, profiles: clientProfiles, history: pricingHistory };
  let proximo = p;
  const campos = { amount: p.amount, grossAmount: L.bruto(p), method: p.method, bank: p.bank, payerName: p.payerName, authorization: p.authorization, note: p.note, purchase: p.purchase, cashUnitValue: p.cashUnitValue, paidAt: p.paidAt };
  const auditar = (acao, detalhe, remendo) => ({ ...p, ...remendo, updatedBy: actor, updatedAt: now, audit: [...L.trilhaDeAuditoria(p), L.eventoDeAuditoria(acao, detalhe, actor, now)] });
  if (field === 'amount' || field === 'bank') {
    try { proximo = C.corrigirCelula(p, field, value, actor, now, pricing, contexto); } catch (e) { if (field === 'amount' && e && e.message && e.message.includes('minutos comprados')) erro('Informe os minutos na coluna Min. e tente o valor novamente.'); throw e; }
  } else if (field === 'clientId') {
    const id = String(value).trim();
    if (!/^\d{1,10}$/.test(id) || Number(id) < 1 || Number(id) > 2147483647) erro('ID da cliente: informe um número de 1 a 2147483647, sem cortar dígitos.');
    if (id === p.clientId) return p;
    if (!clients[id]) erro('Cliente não localizada. Confira o ID.');
    const financia = consultations.some((i) => (i.billing && i.billing.funding && i.billing.funding.some((l) => l.paymentId === p.id))
      || (i.billing && i.billing.tariff && i.billing.tariff.paymentIds && i.billing.tariff.paymentIds.includes(p.id)) || (i.billing && i.billing.tariff && i.billing.tariff.creditLots && i.billing.tariff.creditLots.some((l) => l.paymentId === p.id)));
    if (p.linkedConsultationId || financia || (p.movements && p.movements.length)) erro('Pagamento com consulta ou movimentações: confira o vínculo antes de trocar a cliente.');
    proximo = auditar('Pagamento corrigido', `cliente ${p.clientId} · ${p.client} → ${id} · ${clients[id]}`, { clientId: id, client: clients[id] });
  } else if (field === 'confirmation') {
    const confirmacao = L.validarEscolha(value, ['Confirmado', 'A confirmar'], 'Confirmação');
    if (rotuloDeConfirmacao(p) === confirmacao) return p;
    if (confirmacao === 'A confirmar' && p.movements && p.movements.length) erro('Há movimentações registradas para este recebimento confirmado.');
    proximo = auditar(confirmacao === 'Confirmado' ? 'Recebimento confirmado' : 'Pagamento corrigido', `recebimento: ${rotuloDeConfirmacao(p)} → ${confirmacao}`, { confirmation: confirmacao, status: confirmacao === 'A confirmar' ? 'Em conferência' : p.status === 'Corrigido' ? 'Corrigido' : 'Informado' });
  } else if (field === 'actualFee') {
    if (p.method !== 'Cartão de crédito') erro('Taxa disponível para cartão.');
    const taxa = Lc.lerDinheiro(value);
    if (!Number.isFinite(taxa) || taxa < 0 || taxa > L.bruto(p)) erro('Informe uma taxa entre zero e o total cobrado.');
    if (p.actualFee === taxa && p.feeCheckedAt) return p;
    proximo = auditar('Taxa conferida', `taxa ${L.taxa(p).toFixed(2)} → ${taxa.toFixed(2)}; líquido ${(Math.round((L.bruto(p) - taxa) * 100) / 100).toFixed(2)}`, { actualFee: taxa, feeCheckedAt: now, feeCheckedBy: actor });
  } else {
    if (field === 'paidAt') campos.paidAt = /^\d{4}-\d{2}-\d{2}$/.test(value) ? D.dataDoDia(value, p, now) : D.dataDaEntrada(value);
    if (field === 'note') campos.note = L.validarObservacao(value) || undefined;
    if (field === 'payerName') campos.payerName = L.validarNome(value, 'Em nome de quem');
    if (field === 'authorization') campos.authorization = L.validarTexto(value, { rotulo: 'Autorização', max: 100 }) || undefined;
    if (field === 'minutes') {
      if (!/^\d+$/.test(value.trim())) erro('Informe os minutos comprados.');
      const minutos = Number(value);
      if (minutos === (p.purchase && p.purchase.minutes)) return p;
      campos.purchase = P.validarCompra({ amount: p.amount, minutes: minutos, table: 'custom' }, p.amount);
      campos.cashUnitValue = undefined;
    }
    if (field === 'grossAmount') {
      if (p.method !== 'Cartão de crédito') erro('Total cobrado disponível para cartão.');
      const bruto = Lc.lerDinheiro(value);
      if (!Number.isFinite(bruto) || bruto < p.amount) erro('O cobrado deve ser igual ou maior que o valor para consultas.');
      campos.grossAmount = bruto;
    }
    if (field === 'method') {
      campos.method = L.validarEscolha(value, FORMAS, 'Forma de pagamento');
      if (campos.method === p.method) return p;
      if (campos.method === 'Dinheiro') campos.bank = 'Caixa'; else if (campos.bank === 'Caixa' || !campos.bank) campos.bank = 'Mercado Pago';
      campos.grossAmount = p.amount;
      if (!p.purchase || p.purchase.table !== 'custom') {
        const em = D.dataPaga(p); const aplicavel = b.precoVigente(pricingHistory, em);
        const referencia = P.referenciaDePreco(p.amount, p.clientId, em, aplicavel, contexto, p, campos.method);
        campos.purchase = referencia.purchase; campos.cashUnitValue = referencia.cashUnitValue;
      }
    }
    proximo = C.aplicarCorrecao(p, campos, actor, now);
    if (proximo !== p && ['paidAt', 'minutes', 'note', 'payerName', 'authorization'].includes(field)) {
      const chave = field === 'minutes' ? 'purchase' : field;
      proximo = { ...p, [chave]: campos[chave], ...(field === 'minutes' ? { cashUnitValue: undefined } : {}), status: proximo.status, updatedBy: proximo.updatedBy, updatedAt: proximo.updatedAt, audit: proximo.audit };
    }
  }
  if (proximo !== p) validarComplementoDoPagamento(payments, payments.map((x) => (x.id === p.id ? proximo : x)), consultations);
  return proximo;
}

module.exports = { corrigirNaPlanilha, CAMPOS };
