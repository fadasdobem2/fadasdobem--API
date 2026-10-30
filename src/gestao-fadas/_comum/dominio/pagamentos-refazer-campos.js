'use strict';

/**
 * Refazer a CORREÇÃO de campos do pagamento no servidor (Maturacao/42, itens 2, 3 e 4): o navegador mudou valor, forma, conta, data, titular, autorização,
 * observação, compra ou cliente do recebimento. Só duas famílias de funções do front fazem isso: o diálogo "Editar pagamento" (`correctPaymentRecord`) e a
 * edição em planilha (`correctSpreadsheetPayment`, um campo por vez, que usa `correctPaymentCell`). O servidor reconhece QUAL pela igualdade com o registro
 * do navegador (mesma função, mesmo texto de auditoria), confere o preço escolhido com a tabela REAL e grava o resultado DELE. A conciliação de datas de
 * migração (`correctMissingPaymentDates`), que muda `informedAt`, entra aqui também. Nenhum candidato igual: 422 com a frase da recusa do diálogo.
 */

const L = require('./pagamentos-livro');
const { igual, estavel } = require('./pagamentos-igual');
const { PagamentoInvalidoError } = require('./pagamentos-regras');
const Lc = require('./pagamentos-lancamento');
const D = require('./pagamentos-datas');
const C = require('./pagamentos-correcao');
const S = require('./pagamentos-planilha');
const b = require('./financeiro-base');
const { conferirCompra } = require('./pagamentos-refazer-lancamento');

const NAO_CONFERE = 'Não foi possível identificar esta alteração.';
const CAMPOS_DO_VALOR = ['amount', 'grossAmount', 'method', 'bank', 'paidAt', 'payerName', 'authorization', 'note', 'purchase', 'cashUnitValue', 'clientId'];
const bruto = (p) => L.bruto(p);
const valorDe = (p, campo) => (campo === 'grossAmount' ? bruto(p) : p[campo]);
const mudou = (antes, depois, campo) => estavel(valorDe(antes, campo) ?? null) !== estavel(valorDe(depois, campo) ?? null);

/** O registro do navegador mexeu em campos que só as funções de correção mexem? */
const reconhece = (antes, depois) => antes.status !== 'Cancelado' && (CAMPOS_DO_VALOR.some((c) => mudou(antes, depois, c)) || depois.informedAt !== antes.informedAt);

/** Valores de planilha possíveis para cada campo (a data aceita o dia e o dia com hora). */
function candidatosDePlanilha(depois) {
  const lista = [];
  const add = (field, ...valores) => { for (const value of valores) if (value !== undefined && value !== null && value !== '') lista.push({ field, value: String(value) }); };
  add('amount', Lc.textoDoDinheiro(depois.amount)); add('bank', depois.bank); add('clientId', depois.clientId); add('method', depois.method); add('payerName', depois.payerName);
  add('authorization', depois.authorization); add('note', depois.note); add('grossAmount', Lc.textoDoDinheiro(bruto(depois)));
  if (depois.purchase) add('minutes', depois.purchase.minutes);
  if (depois.paidAt) { add('paidAt', /^\d{4}-\d{2}-\d{2}$/.test(depois.paidAt) ? depois.paidAt : '', D.entradaDeDia(depois.paidAt), D.entradaDeData(depois.paidAt)); }
  // Campos esvaziados (autorização, observação) voltam como texto vazio.
  if (!depois.authorization) lista.push({ field: 'authorization', value: '' });
  if (!depois.note) lista.push({ field: 'note', value: '' });
  return lista;
}

/**
 * `ator`: `{ nome, perfil }`; `contexto`: `{ payments, consultations, profile, history, nomes }` (`nomes`: `{ [clientId]: true }` das clientes que existem).
 * Devolve `{ tipo, registro }` ou `null` se a revisão não é uma correção de campos.
 */
function refazerCampos(antes, depois, ator, agora, contexto) {
  if (!reconhece(antes, depois)) return null;
  if (!ator.p.canManageConsultations) return null;
  const pricing = (em) => b.precoVigente(contexto.history, em);
  const clientes = {}; if (contexto.nomes && contexto.nomes[depois.clientId]) clientes[depois.clientId] = depois.client;
  const perfis = { [antes.clientId]: contexto.profile };
  let primeiroErro;
  // 1) migração de datas (muda `informedAt` só quando faltava)
  if (depois.informedAt !== antes.informedAt) {
    const ev = (depois.audit || []).slice(-1)[0];
    const m = ev && /^Migração: datas esclarecidas\. Pagamento: (.*?) → (.*?)( \(horário não informado\))?\. Lançamento: (.*?) → (.*?)\. Referência: ([\s\S]*)$/.exec(ev.detail || '');
    const correcoes = depois.dateCorrections || {};
    const entrada = {
      id: antes.id, evidence: m ? m[6] : '', ...(antes.paidAt !== depois.paidAt ? { paidAt: depois.paidAt } : {}), ...(depois.informedAt !== antes.informedAt ? { informedAt: depois.informedAt } : {}),
      ...(m ? { paidDisplayDate: m[2], registeredDisplayDate: m[5] } : {}), ...(correcoes.paidAt && correcoes.paidAt.precision ? { paidPrecision: correcoes.paidAt.precision } : {}),
    };
    const rodar = (nome, em) => D.corrigirDatasDaMigracao({ payments: contexto.payments.map((p) => (p.id === antes.id ? antes : p)), consultations: contexto.consultations }, entrada, ator.perfil, nome, em).payments.find((p) => p.id === antes.id);
    try { const conferido = rodar(depois.updatedBy, depois.updatedAt); if (igual(conferido, depois)) return { tipo: 'datas-migracao', registro: rodar(ator.nome, agora) }; } catch (e) { if (!(e instanceof PagamentoInvalidoError)) throw e; primeiroErro = e; }
  }
  // 2) diálogo "Editar pagamento"
  const entradaDialogo = { ...Lc.entradaDoRegistro(depois), ...(depois.purchase ? { purchase: depois.purchase } : {}), ...(depois.cashUnitValue !== undefined && depois.cashUnitValue !== null ? { cashUnitValue: depois.cashUnitValue } : {}) };
  const dialogo = (nome, em) => C.corrigirPagamento(antes, entradaDialogo, nome, em, pricing(em));
  try {
    const conferido = dialogo(depois.updatedBy, depois.updatedAt);
    if (igual(conferido, depois)) { conferirCompra(depois, { ...contexto, payments: contexto.payments }, b.PRECOS_PADRAO, antes); return { tipo: 'pagamento-corrigido', registro: dialogo(ator.nome, agora) }; }
  } catch (e) { if (!(e instanceof PagamentoInvalidoError)) throw e; if (!primeiroErro) primeiroErro = e; }
  // 3) planilha, campo a campo
  const base = (nome, em, campo) => ({
    payments: contexto.payments.map((p) => (p.id === antes.id ? antes : p)), consultations: contexto.consultations, role: ator.perfil, paymentId: antes.id, field: campo.field, value: campo.value, actor: nome, now: em,
    pricing: b.PRECOS_PADRAO, pricingHistory: contexto.history.length ? contexto.history : [b.PRECOS_PADRAO], clients: clientes, clientProfiles: perfis,
  });
  for (const campo of candidatosDePlanilha(depois)) {
    try {
      const conferido = S.corrigirNaPlanilha(base(depois.updatedBy, depois.updatedAt, campo));
      if (conferido === antes || !igual(conferido, depois)) continue;
      if (campo.field !== 'minutes') conferirCompra(depois, contexto, b.PRECOS_PADRAO, antes);
      return { tipo: `planilha-${campo.field}`, registro: S.corrigirNaPlanilha(base(ator.nome, agora, campo)) };
    } catch (e) { if (!(e instanceof PagamentoInvalidoError)) throw e; if (!primeiroErro) primeiroErro = e; }
  }
  throw primeiroErro || new PagamentoInvalidoError(NAO_CONFERE);
}

module.exports = { refazerCampos, reconhece, candidatosDePlanilha };
