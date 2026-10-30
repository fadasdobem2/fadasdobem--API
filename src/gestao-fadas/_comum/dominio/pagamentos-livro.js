'use strict';

/**
 * Livro-caixa do pagamento no servidor (Maturacao/42): porte de `features/finance/cash-ledger.ts` (as funções puras que as regras de
 * movimento usam) e das validações de `domain/input-validation.ts`. Valores em REAIS como o registro do front; contas em centavos.
 * Nada aqui lê banco nem relógio: o instante entra por parâmetro. Ouro: `scripts/gerar-ouro-gf-financeiro-regras.js` (código real do front).
 */

const { randomBytes } = require('crypto');
const { PagamentoInvalidoError } = require('./pagamentos-regras');

/** Frase de regra do front (422). */
const erro = (mensagem) => { throw new PagamentoInvalidoError(mensagem); };

const centavos = (v) => Math.round(v * 100);
const arredondar = (v) => centavos(v) / 100;
const bruto = (p) => (p.grossAmount === undefined || p.grossAmount === null ? p.amount : p.grossAmount);
const taxa = (p) => (p.actualFee === undefined || p.actualFee === null ? arredondar(bruto(p) - p.amount) : p.actualFee);
const liquido = (p) => arredondar(bruto(p) - taxa(p));
const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);

const correcaoBruta = (p, m) => (m.receiptGrossCorrection !== undefined && m.receiptGrossCorrection !== null ? m.receiptGrossCorrection
  : (m.receiptCorrection && liquido(p) > 0 ? arredondar(m.receiptCorrection * bruto(p) / liquido(p)) : 0));
const recebimentoConfirmado = (p) => p.status !== 'Cancelado' && (p.confirmation ? p.confirmation === 'Confirmado' : p.status === 'Informado' || p.status === 'Corrigido');
/** `receiptCreditValue`: o principal do banco segue o recibo mesmo depois de parte do saldo mudar de titular. */
const creditoDoRecibo = (p) => Math.max(0, arredondar(p.amount + soma((p.movements || []).filter((m) => m.kind !== 'balance-transfer'), (m) => m.creditEffect)));
const efeitoDaTransferencia = (m, clientId) => (m.kind === 'balance-transfer' && m.balanceTransfer ? (m.balanceTransfer.sourceClientId === clientId ? -m.amount : m.balanceTransfer.targetClientId === clientId ? m.amount : 0) : 0);
const valorParaConsultas = (p) => Math.max(0, arredondar(p.amount + soma(p.movements || [], (m) => (m.kind === 'balance-transfer' ? efeitoDaTransferencia(m, p.clientId) : m.creditEffect))));

/** `outgoingRefundCredit`: quanto do crédito sai junto com uma devolução bancária. */
function creditoDaDevolucao(p, valor) {
  const movs = p.movements || [];
  const disponivelBanco = centavos(bruto(p)) + soma(movs, (m) => centavos(m.bankEffect));
  const restante = centavos(creditoDoRecibo(p));
  if (centavos(valor) === disponivelBanco) return Math.max(0, Math.min(restante, centavos(valor))) / 100;
  const devolucoes = movs.filter((m) => m.kind === 'refund');
  const devolvido = soma(devolucoes, (m) => centavos(m.amount));
  const retirado = -soma(devolucoes, (m) => centavos(m.creditEffect));
  const alvo = Math.round((devolvido + centavos(valor)) * centavos(p.amount) / centavos(bruto(p)));
  return Math.max(0, Math.min(restante, centavos(valor), alvo - retirado)) / 100;
}

/** `paymentDisputeState`. */
function estadoDaContestacao(p, origem) {
  const relacionados = (p.movements || []).filter((m) => m.parentId === origem.id);
  const rejeitada = relacionados.some((m) => m.kind === 'dispute-rejected');
  const aceita = relacionados.some((m) => m.kind === 'dispute-accepted');
  const debitado = -[origem, ...relacionados].reduce((s, m) => s + Math.min(0, centavos(m.bankEffect)), 0);
  const devolvido = relacionados.reduce((s, m) => s + Math.max(0, centavos(m.bankEffect)), 0);
  const retiradaPendente = Math.max(0, centavos(origem.amount) - debitado) / 100;
  const emAberto = Math.max(0, debitado - devolvido) / 100;
  const devolvidaInteira = debitado > 0 && devolvido >= debitado && retiradaPendente === 0;
  return { related: relacionados, rejected: rejeitada, accepted: aceita, pendingWithdrawal: retiradaPendente, outstanding: emAberto, returnedInFull: devolvidaInteira,
    pending: (!rejeitada && !aceita && !devolvidaInteira) || (aceita && retiradaPendente > 0) || (rejeitada && emAberto > 0) };
}
const contestacaoAtiva = (p) => (p.movements || []).slice().reverse().find((m) => m.kind === 'dispute' && estadoDaContestacao(p, m).pending);

// --- domain/input-validation.ts -------------------------------------------------------------------------------------------
/** `validateText`: devolve o texto aparado ou lança a frase `"<rótulo>: <motivo>"`. */
function validarTexto(valor, { rotulo, max, obrigatorio = false, multilinha = false }) {
  const falha = (m) => erro(`${rotulo}: ${m}`);
  if (typeof valor !== 'string') return falha('informe um texto válido.');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(valor)) return falha('há um caractere de controle inválido. Apague e digite novamente o trecho colado.');
  for (const c of valor) { const p = c.codePointAt(0); if (p >= 0xD800 && p <= 0xDFFF) return falha('há um caractere incompleto. Apague e digite novamente o trecho colado.'); }
  if (!multilinha && /[\r\n\t\u2028\u2029]/u.test(valor)) return falha('use uma única linha.');
  const t = valor.trim();
  if (obrigatorio && !t) return falha('preencha este campo.');
  if (Array.from(t).length > max) return falha(`use no máximo ${max} caracteres. O texto não foi cortado.`);
  return t;
}
const validarObservacao = (valor, rotulo = 'Observação', obrigatoria = false) => validarTexto(valor, { rotulo, max: 4000, multilinha: true, obrigatorio: obrigatoria });
const validarNome = (valor, rotulo) => validarTexto(valor, { rotulo, max: 200, obrigatorio: true });
const validarEscolha = (valor, escolhas, rotulo) => { if (typeof valor !== 'string' || !escolhas.includes(valor)) erro(`${rotulo}: selecione uma opção válida.`); return valor; };

// --- consultation-operations.ts (auditoria do pagamento) ------------------------------------------------------------------
/** `paymentAuditEvent`: o id é sorteado (o front usa `Date.now()` e aleatório); a comparação por valor ignora o id. */
const eventoDeAuditoria = (acao, detalhe, ator, em) => ({ id: `payment-audit-${Date.parse(em)}-${randomBytes(4).toString('hex')}`, action: acao, detail: detalhe, actor: ator, createdAt: em });
/** `paymentAuditTrail`. */
function trilhaDeAuditoria(p) {
  if (p.audit && p.audit.length) return p.audit;
  return [eventoDeAuditoria('Pagamento informado', `${moeda(p.amount)} · ${p.method}${p.bank ? ` · ${p.bank}` : ''} · em nome de ${p.payerName || p.client}`, p.informedBy, p.informedAt)];
}

/** `Intl.NumberFormat("pt-BR", 2 casas)`: milhar com ponto, vírgula decimal (sem ICU, determinístico). */
function numero2(v) {
  const c = Math.round(Math.abs(v) * 100);
  const inteiro = String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 || Object.is(v, -0) ? '-' : ''}${inteiro},${String(c % 100).padStart(2, '0')}`;
}
/** `currencyFormatter` (BRL pt-BR): "R$ 1.234,50" com espaço sem quebra, como o ICU entrega. */
const moeda = (v) => `${v < 0 ? '-' : ''}R$ ${numero2(Math.abs(v))}`;

const KINDS = ['refund', 'dispute', 'dispute-debit', 'dispute-rejected', 'dispute-accepted', 'dispute-return', 'payment-missing', 'scheduled-unpaid', 'payment-reconciled'];
const NOTA_AUTOMATICA = (bancoMoveu) => ({
  'balance-transfer': 'Transferência interna de saldo.', refund: 'Devolução à cliente.',
  dispute: bancoMoveu ? 'Estorno por contestação retirado pelo banco.' : 'Contestação registrada.', 'dispute-debit': 'Estorno por contestação retirado pelo banco.',
  'dispute-return': 'Dinheiro devolvido pelo banco após contestação.', 'dispute-rejected': bancoMoveu ? 'Contestação não aceita; dinheiro devolvido pelo banco.' : 'Contestação não aceita.',
  'dispute-accepted': 'Contestação aceita.', 'payment-missing': 'Pagamento não localizado; crédito corrigido sem saída bancária.',
  'scheduled-unpaid': 'Agendamento não compensado; crédito corrigido sem saída bancária.', 'payment-reconciled': 'Pagamento localizado; crédito reconciliado com o lançamento original.',
});

/** `JSON.stringify` do front com a ordem de chaves que o registro do navegador produziu: o servidor reproduz a assinatura recebida. */
const assinatura = (entrada, valorArredondado, ator) => JSON.stringify({ ...entrada, amount: valorArredondado, actor: ator });

module.exports = {
  erro, centavos, arredondar, bruto, taxa, liquido, soma, correcaoBruta, recebimentoConfirmado, creditoDoRecibo, efeitoDaTransferencia, valorParaConsultas, creditoDaDevolucao,
  estadoDaContestacao, contestacaoAtiva, validarTexto, validarObservacao, validarNome, validarEscolha, eventoDeAuditoria, trilhaDeAuditoria, numero2, moeda, KINDS, NOTA_AUTOMATICA, assinatura,
};
