'use strict';

/**
 * Pagamentos de cliente, REGRAS no servidor (Maturacao/41). Porte do CÓDIGO do front do suspiro, sem relógio nem banco:
 *   - lançamento novo: `createPaymentRecord` e `normalizePaymentInput` (`finance/payment-records.ts`), `validateText`/`validateName`/
 *     `validateChoice` (`domain/input-validation.ts`), `validatePaymentDate` (`domain/payment-dates.ts`);
 *   - correção: `applyPaymentCorrection` e `correctPaymentCell` (mesmo arquivo): forma preservada com movimentos, piso do valor pelas
 *     movimentações, transferência de saldo e devolução em minutos preservam a compra original;
 *   - quem pode confirmar o recebimento: `applyPaymentReviewBatch` (`finance/payment-manual-review.ts:20`) e
 *     `correctSpreadsheetPayment` (`finance/payment-spreadsheet-correction.ts:20`), ambos `canManageFinancialValues`;
 *   - pagamento cancelado: `correctPaymentRecord` ("não pode ser alterado") e `paymentFrom` de `financial-occurrences.ts` ("está cancelado").
 * O servidor confere o REGISTRO que o navegador montou (os invariantes que as funções do front garantem), nunca refaz o preço: a compra
 * (`purchase`) é escolhida pelo usuário na tela. As mensagens são as `throw new Error` do front. Ouro: `scripts/gerar-ouro-gf-pagamentos-regras.js`.
 */

class PagamentoInvalidoError extends Error { constructor(m, tipo = 'regra') { super(m); this.name = 'PagamentoInvalidoError'; this.tipo = tipo; } }
/** O perfil não pode fazer esta operação (403 no gate; Maturacao/42). */
class PagamentoNegadoError extends Error { constructor(m = 'negado') { super(m); this.name = 'PagamentoNegadoError'; } }
const erro = (m) => { throw new PagamentoInvalidoError(m); };
/** Forma que o front não produz (adulteração): 400 no gate, sem frase da tela. */
const forma = (campo) => { throw new PagamentoInvalidoError(`Dados inválidos: ${campo}`, 'forma'); };

/** Contas bancárias que a tela oferece (`validateChoice` de `normalizePaymentInput`); dinheiro vai ao Caixa. */
const CONTAS = Object.freeze(['Mercado Pago', 'Itaú Jurídica', 'Itaú', 'Santander', 'BB']);
const LIMITES = Object.freeze({ nome: 200, autorizacao: 100, observacao: 4000 });

const centavos = (v) => Math.round(v * 100);
const estavel = (v) => {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
const igual = (a, b) => estavel(a) === estavel(b);

/** `validateText` do front (mensagens `"<rótulo>: <motivo>"`). `texto` é o valor guardado (já aparado pelo front). */
function texto(valor, { rotulo, max, obrigatorio = false, multilinha = false }) {
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

/** `validatePaymentDate`: só a data AAAA-MM-DD ou o instante com fuso, como a tela produz. */
function dataDoPagamento(v) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const d = new Date(`${v}T12:00:00Z`);
    if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== v) erro('Informe uma data de pagamento válida.');
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(new Date(v).getTime())) erro('Informe a data do pagamento.');
  const [a, m, d] = v.slice(0, 10).split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(a, m, 0)).getUTCDate()) erro('Informe uma data de pagamento válida.');
}

const MSG_PRIMEIRA = 'O valor de primeira consulta é exclusivo para Pix.';
const MSG_CARTAO = 'O total cobrado no cartão deve ser igual ou maior que o valor para consultas.';
const MSG_CAIXA = 'O pagamento em dinheiro pertence ao Caixa.';
const MSG_CONFIRMAR = 'Somente Financeiro e Administração podem confirmar recebimentos.';
const MSG_PLANILHA = 'Edição em planilha disponível para administradora e assistente.';

/**
 * Campos do registro que a tela deriva de `normalizePaymentInput` (ordem do front: valor/forma/total do cartão, data, banco, titular,
 * autorização, observação) e a regra da primeira consulta de `createPaymentRecord`. `mudou(campo)` limita a conferência ao que MUDOU
 * (registros antigos ficam como estão); `null` confere tudo (lançamento novo).
 */
function conferirCampos(r, mudou) {
  const m = (campo) => mudou === null || mudou(campo);
  if (m('amount') || m('grossAmount') || m('method')) {
    const bruto = r.grossAmount === undefined ? r.amount : r.grossAmount;
    if (r.method === 'Cartão de crédito') { if (centavos(bruto) < centavos(r.amount)) erro(MSG_CARTAO); } else if (centavos(bruto) !== centavos(r.amount)) forma('grossAmount');
  }
  if (m('paidAt') && r.paidAt !== undefined) dataDoPagamento(r.paidAt);
  if (m('bank') || m('method')) {
    if (r.method === 'Dinheiro') { if (r.bank !== 'Caixa') erro(MSG_CAIXA); } else if (!CONTAS.includes(r.bank)) erro('Banco: selecione uma opção válida.');
  }
  if (m('payerName')) texto(r.payerName, { rotulo: 'Em nome de quem', max: LIMITES.nome, obrigatorio: true });
  if (m('authorization') && r.authorization !== undefined) texto(r.authorization, { rotulo: 'Autorização', max: LIMITES.autorizacao });
  if (m('note') && r.note !== undefined) texto(r.note, { rotulo: 'Observação', max: LIMITES.observacao, multilinha: true });
  if ((m('purchase') || m('method')) && r.purchase && r.purchase.table === 'first' && r.method !== 'PIX') erro(MSG_PRIMEIRA);
}

/** Lançamento NOVO (`POST /payments`): o registro tem de ser o que `createPaymentRecord` devolve. `perfil`: capacidades do ator. */
function conferirLancamento(r, perfil) {
  if (r.status !== 'Informado') forma('status');
  if (r.confirmation !== undefined) { if (!perfil || !perfil.canManageFinancialValues) erro(MSG_CONFIRMAR); forma('confirmation'); }
  if ((r.movements && r.movements.length) || (r.financialOccurrences && r.financialOccurrences.length)) forma('movements');
  if (r.actualFee !== undefined || r.feeCheckedAt !== undefined || r.feeCheckedBy !== undefined) forma('actualFee');
  conferirCampos(r, null);
  if (typeof r.client !== 'string' || !r.client.trim()) erro('Localize a cliente pelo ID antes de salvar.');
  if (r.purchase && r.cashUnitValue !== undefined) forma('cashUnitValue');
  if (!r.purchase && !(Number.isFinite(r.cashUnitValue) && r.cashUnitValue > 0)) erro('Confira o valor do minuto de referência.');
}

const MUDANCAS_FINANCEIRAS = ['amount', 'grossAmount', 'method', 'bank', 'paidAt', 'purchase', 'cashUnitValue', 'confirmation', 'clientId', 'actualFee'];
/** Num pagamento cancelado o front não corrige nada (`correctPaymentRecord`): valor, forma, banco, data, titular, autorização e observação ficam. */
const FIXOS_DO_CANCELADO = [...MUDANCAS_FINANCEIRAS, 'payerName', 'authorization', 'note'];
/** O que \`correctPaymentRecord\` pode mexer: com movimentações, qualquer correção passa pelas recusas de \`applyPaymentCorrection\`. */
const CORRIGIVEIS = ['amount', 'grossAmount', 'method', 'bank', 'paidAt', 'purchase', 'cashUnitValue', 'payerName', 'authorization', 'note'];
const bruto = (r) => (r.grossAmount === undefined ? r.amount : r.grossAmount);
const valorDe = (r, campo) => (campo === 'grossAmount' ? bruto(r) : r[campo]);

/**
 * Revisão de um recebimento existente. `antes` é o guardado, `depois` o que o navegador montou, `perfil` as capacidades do ator.
 * Ordem das recusas = a de `applyPaymentCorrection` (transferência, devolução em minutos, forma, piso).
 */
function conferirRevisao(antes, depois, perfil) {
  const mudou = (campo) => !igual(valorDe(antes, campo), valorDe(depois, campo));
  const p = perfil || {};
  const movimentoNovo = (depois.movements || []).length > (antes.movements || []).length;
  if (antes.status === 'Cancelado') {
    if (movimentoNovo) erro('O pagamento está cancelado.');
    if (FIXOS_DO_CANCELADO.some(mudou)) erro('Este pagamento está cancelado e não pode ser alterado.');
  }
  // Só Financeiro e Administração (`canManageFinancialValues`) confirmam, trocam a cliente do recebimento ou conferem a taxa do cartão.
  if (!p.canManageFinancialValues) {
    if (mudou('confirmation')) erro(depois.confirmation === 'A confirmar' ? MSG_PLANILHA : MSG_CONFIRMAR);
    if (mudou('clientId') || (depois.actualFee !== undefined && !igual(antes.actualFee, depois.actualFee))) erro(MSG_PLANILHA);
  }
  if (mudou('clientId') && (antes.linkedConsultationId || (antes.movements || []).length)) erro('Pagamento com consulta ou movimentações: confira o vínculo antes de trocar a cliente.');
  if (mudou('confirmation') && depois.confirmation === 'A confirmar' && (antes.movements || []).length) erro('Há movimentações registradas para este recebimento confirmado.');
  if (depois.actualFee !== undefined && !igual(antes.actualFee, depois.actualFee)) {
    if (depois.method !== 'Cartão de crédito') erro('Taxa disponível para cartão.');
    if (!Number.isFinite(depois.actualFee) || depois.actualFee < 0 || centavos(depois.actualFee) > centavos(bruto(depois))) erro('Informe uma taxa entre zero e o total cobrado.');
  }
  conferirCampos(depois, mudou);
  const movs = antes.movements || [];
  if (movs.length && CORRIGIVEIS.some(mudou)) {
    const valorMudou = mudou('amount') || mudou('purchase') || mudou('cashUnitValue');
    if (movs.some((x) => x.kind === 'balance-transfer') && (valorMudou || mudou('paidAt'))) erro('Este pagamento originou transferência de saldo. Preserve o valor, a tarifa e a data da compra original.');
    if (movs.some((x) => x.creditSnapshot) && valorMudou) erro('Este pagamento tem devolução de crédito registrada em minutos. Confira a devolução antes de alterar o valor ou os minutos da compra original.');
    {
      if (mudou('method')) erro('Este pagamento já tem movimentações. A forma precisa preservar a modalidade registrada no histórico.');
      {
        const soma = (lista, f) => lista.reduce((s, x) => s + centavos(f(x)), 0);
        const devolvido = soma(movs.filter((x) => x.kind === 'refund'), (x) => x.amount);
        const creditoDevolvido = -soma(movs.filter((x) => x.kind !== 'balance-transfer'), (x) => x.creditEffect);
        const bancoRetirado = -soma(movs, (x) => x.bankEffect);
        const contestado = Math.max(0, ...movs.filter((x) => x.kind === 'dispute').map((x) => centavos(x.amount)));
        if (centavos(bruto(depois)) < Math.max(devolvido, contestado, bancoRetirado) || centavos(depois.amount) < creditoDevolvido) erro('O novo valor não pode ser menor que as movimentações já registradas.');
      }
    }
  }
}

module.exports = { PagamentoInvalidoError, PagamentoNegadoError, CONTAS, LIMITES, MSG_CONFIRMAR, MSG_PLANILHA, conferirLancamento, conferirRevisao, dataDoPagamento };
