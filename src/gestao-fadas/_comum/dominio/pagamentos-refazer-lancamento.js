'use strict';

/**
 * Refazer o LANÇAMENTO de pagamento no servidor (Maturacao/42, item 4): o servidor deixa de aceitar a compra e o valor do minuto que o navegador
 * escolheu; REFAZ `createPaymentRecord` (exigindo registro IGUAL ao do navegador), REFAZ a escolha de preço da tela (`paymentPricingReference` com a tabela
 * REAL e o histórico REAL da cliente) e a conferência de duplicidade, e grava o resultado dele com o instante e o autor do servidor.
 */

const { igual } = require('./pagamentos-igual');
const { PagamentoInvalidoError } = require('./pagamentos-regras');
const Lc = require('./pagamentos-lancamento');
const P = require('./pagamentos-preco');
const Dup = require('./pagamentos-duplicidade');
const D = require('./pagamentos-datas');
const b = require('./financeiro-base');
const { moeda } = require('./pagamentos-livro');
const { comMotivos } = require('./pagamentos-refazer-ocorrencias');

const NAO_CONFERE = 'Não foi possível identificar esta alteração.';
const MSG_PRECO = 'Confira o valor do minuto de referência.';
const recusa = (m = NAO_CONFERE) => { throw new PagamentoInvalidoError(m); };
const igualJson = (a, b2) => JSON.stringify(a ?? null) === JSON.stringify(b2 ?? null);

/** Entrada de texto que a tela montou, descoberta pelo registro: o que `paymentInputFromRecord` devolve mais a compra e o valor do minuto. */
function entradaDoLancamento(p) {
  const e = { ...Lc.entradaDoRegistro(p) };
  if (p.purchase) e.purchase = p.purchase;
  if (p.cashUnitValue !== undefined && p.cashUnitValue !== null) e.cashUnitValue = p.cashUnitValue;
  return e;
}

/** Pagamento Pós-pago concluído, ligado a uma consulta sem cobertura: a tela sugere o valor do minuto da própria consulta (`postpaidConsultationPaymentDefault`). */
function valorDoMinutoPosPago(p, contexto) {
  const alvo = p.linkedConsultationId && contexto.consultations.find((c) => c.id === p.linkedConsultationId && c.clientId === p.clientId);
  if (!alvo || alvo.status !== 'Concluída' || alvo.paymentProfile !== 'Pós-paga') return undefined;
  const acerto = require('./financeiro-cobranca').acerto(alvo, contexto.payments);
  return Number.isFinite(acerto.unitValue) && acerto.unitValue > 0 ? acerto.unitValue : undefined;
}

/** A compra e o valor do minuto têm de ser os que a TELA escolheria (`paymentPricingReference` ou o valor pós-pago), com a tabela e o histórico reais. */
function conferirCompra(p, contexto, pricingPadrao, editando) {
  const momentos = [p.paidAt || p.informedAt, /^\d{4}-\d{2}-\d{2}/.test(p.paidAt || '') ? (p.paidAt || '').slice(0, 10) : D.entradaDeDia(p.paidAt || p.informedAt)];
  const ctx = { consultations: contexto.consultations, profiles: { [p.clientId]: contexto.profile }, history: contexto.history };
  const pos = !editando ? valorDoMinutoPosPago(p, contexto) : undefined;
  const aceita = [...new Set(momentos)].some((em) => {
    const ref = P.referenciaDePreco(p.amount, p.clientId, em, pricingPadrao, ctx, editando, p.method);
    return igualJson(ref.purchase, p.purchase) && igualJson(ref.cashUnitValue, p.cashUnitValue);
  }) || (pos !== undefined && !p.purchase && p.cashUnitValue === pos);
  if (!aceita) recusa(MSG_PRECO);
}

/**
 * `p` = o registro do navegador, `contexto` = `{ payments, consultations, profile, history }` da cliente. Devolve o registro refeito (instante e autor do servidor).
 */
function refazerLancamento(p, ator, agora, contexto) {
  // Lote colado (`batch-paste-dialog.tsx`): depois de `createPaymentRecord` o front acrescenta UM evento "Data conferida: AAAA-MM-DD. ..." com a data literal da planilha.
  const ultimo = (p.audit || []).slice(-1)[0];
  const lote = ultimo && ultimo.action === 'Pagamento informado' && typeof ultimo.detail === 'string' ? /^Data conferida: (\d{4}-\d{2}-\d{2})\. (Operadora confirmou que é outro recebimento\.|Conferência do lote concluída\.)$/.exec(ultimo.detail) : null;
  if (lote && String(p.paidAt).slice(0, 10) !== lote[1]) recusa();
  const sem = lote ? { ...p, audit: p.audit.slice(0, -1) } : p;
  const evento = Dup.eventoDeDuplicidade(sem);
  const semDup = evento ? { ...sem, audit: sem.audit.filter((e) => e !== evento) } : sem;
  const entrada = entradaDoLancamento(p);
  const cliente = { clientId: p.clientId, client: p.client };
  const pricing = b.precoVigente(contexto.history, p.informedAt);
  const montar = (nome, em, precoEm) => Lc.criarPagamento(entrada, cliente, nome, em, p.id, p.linkedConsultationId, b.precoVigente(contexto.history, precoEm));
  const conferido = montar(p.informedBy, p.informedAt, p.informedAt);
  if (!igual(conferido, semDup)) recusa();
  conferirCompra(p, contexto, b.PRECOS_PADRAO, null);
  Dup.conferirDuplicidade(sem, contexto.payments, agora);
  void pricing;
  let refeito = montar(ator.nome, agora, agora);
  if (evento) refeito = { ...refeito, audit: [...refeito.audit, { ...evento, actor: ator.nome, createdAt: agora }] };
  if (lote) refeito = { ...refeito, audit: [...refeito.audit, { ...ultimo, actor: ator.nome, createdAt: agora }] };
  return comMotivos({ ...refeito, ...(p.financialReason && typeof p.financialReason === 'object' ? { financialReason: p.financialReason } : {}) }, p);
}

module.exports = { refazerLancamento, conferirCompra, entradaDoLancamento, MSG_PRECO, moeda };
