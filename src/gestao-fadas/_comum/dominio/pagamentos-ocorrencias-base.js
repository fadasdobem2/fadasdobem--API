'use strict';

/**
 * Ocorrências financeiras no servidor (Maturacao/42), peças comuns: porte das funções auxiliares de `features/finance/financial-occurrences.ts`
 * (`validateActor`, `positiveAmount`, `paymentFrom`, `occurrenceFrom`, `replayed`, `commitCase`, `reasonSnapshot`...) e de
 * `validateFinancialReasonSelection` (`financial-reasons-model.ts`, sem o catálogo de motivos, que é estado do navegador).
 * `estado` = `{ payments, consultations }` como o front. O instante entra por parâmetro.
 */

const L = require('./pagamentos-livro');

const { erro, centavos, arredondar } = L;

const RAIZ_DA_NATUREZA = {
  payment: 'client', refund: 'client', 'client-refund': 'client', 'dispute-pix': 'client', 'dispute-card': 'client', 'scheduled-unpaid': 'client', 'payment-missing': 'client',
  'money-return': 'client', charge: 'client', 'charge-waiver': 'client', payout: 'tarologist', advance: 'tarologist', loan: 'tarologist', 'payout-bonus': 'tarologist',
  'payout-addition': 'tarologist', 'payout-credit': 'tarologist', 'payout-debit': 'tarologist',
};
const ROTULOS = { refund: 'Devolução feita pelo Fadas', 'client-refund': 'Estorno iniciado pela cliente', 'dispute-pix': 'Contestação Pix', 'dispute-card': 'Contestação cartão', 'scheduled-unpaid': 'Agendamento não compensado', 'payment-missing': 'Pagamento não localizado' };
const INICIADORES = ['company', 'client', 'bank', 'unknown'];
const CONCORDANCIAS = ['pending', 'agreed', 'disagreed'];
const DECISOES = ['pending', 'maintain', 'waive'];
const ausente = (tipo) => tipo === 'scheduled-unpaid' || tipo === 'payment-missing';
const tem = (lista, v) => lista.includes(v);

/** `canManageFinancialOccurrences` / `canContactFinancialOccurrences` (papéis do front). */
const podeDecidir = (papel) => papel === 'administradora' || papel === 'assistente';
const podeContatar = (papel) => papel !== 'tarologa';

function validarAtor(ator, papel, em, financeiro = true) {
  L.validarNome(ator, 'Responsável');
  if (financeiro ? !podeDecidir(papel) : !podeContatar(papel)) erro(financeiro ? 'Esta decisão financeira está disponível para assistente e administradora.' : 'Esta ação está disponível para a equipe.');
  if (!Number.isFinite(Date.parse(em))) erro('Informe uma data válida.');
}

function erroDoTextoDoExtrato(v) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > 180) return 'Informe o texto do extrato com até 180 caracteres.';
  if (/[{}]/.test(v.replaceAll('{data}', ''))) return 'Use apenas a data do pagamento como campo variável no texto do extrato.';
  return null;
}
/** `validateFinancialReasonSelection(value, description)` sem o catálogo (o servidor não guarda motivos; o navegador captura o retrato). */
function erroDoMotivo(valor, descricao) {
  if (!valor) return 'Selecione o motivo do movimento.';
  if (!Object.hasOwn(RAIZ_DA_NATUREZA, valor.nature) || RAIZ_DA_NATUREZA[valor.nature] !== valor.scope) return 'O motivo não corresponde a este tipo de movimento.';
  if (valor.id === 'other') return String(descricao).trim() ? null : 'Descreva o ocorrido em Outros.';
  if (typeof valor.name !== 'string' || !valor.name.trim() || !Number.isSafeInteger(valor.version) || valor.version < 1) return 'Selecione um motivo válido.';
  if (valor.statementText !== undefined && erroDoTextoDoExtrato(valor.statementText)) return 'Confira o texto do extrato deste motivo.';
  return null;
}
function retratoDoMotivo(valor, nota, natureza, permiteOcorrencia = false) {
  if (!valor) return undefined;
  const invalido = erroDoMotivo(valor, nota);
  if (invalido || valor.scope !== 'client' || (valor.nature !== natureza && !permiteOcorrencia)) erro(invalido || 'O motivo não corresponde a este tipo de movimento.');
  return { ...valor };
}

function valorPositivo(valor) {
  if (!Number.isFinite(valor) || valor <= 0 || !Number.isSafeInteger(centavos(valor)) || Math.abs(valor * 100 - centavos(valor)) > 0.00001) erro('Informe um valor positivo com até duas casas decimais.');
  return arredondar(valor);
}
function pagamentoDe(estado, id) {
  const p = estado.payments.find((x) => x.id === id);
  if (!p) erro('Pagamento não encontrado. Abra a ficha novamente.');
  if (p.status === 'Cancelado') erro('O pagamento está cancelado.');
  return p;
}
function ocorrenciaDe(p, id) {
  const o = (p.financialOccurrences || []).find((x) => x.id === id);
  if (!o) erro('Ocorrência não encontrada. Abra a ficha novamente.');
  return o;
}
/** `replayed`: a operação já foi aplicada com a MESMA assinatura (devolve true) ou outra (recusa). */
function repetida(o, idOperacao, assinatura) {
  const anterior = (o.commandSignatures || {})[idOperacao];
  if (!anterior) return false;
  if (anterior !== assinatura) erro('Este identificador já pertence a outra operação financeira.');
  return true;
}
function validarIdOperacao(id) { if (!id || String(id).trim().length < 3) erro('Não foi possível identificar a operação.'); }
function consultaDa(estado, p, id) {
  if (!id) return undefined;
  if (p.unidentified || !p.clientId) erro('Identifique a cliente antes de vincular uma consulta.');
  const item = estado.consultations.find((x) => x.id === id && x.clientId === p.clientId);
  if (!item) erro('A consulta precisa pertencer à mesma cliente do pagamento.');
  return item;
}
const trocarPagamento = (estado, p) => ({ ...estado, payments: estado.payments.map((x) => (x.id === p.id ? p : x)) });
function gravarCaso(estado, p, ocorrencia, ator, em) {
  const existia = (p.financialOccurrences || []).some((x) => x.id === ocorrencia.id);
  return trocarPagamento(estado, { ...p, updatedAt: em, updatedBy: ator, financialOccurrences: existia ? p.financialOccurrences.map((x) => (x.id === ocorrencia.id ? ocorrencia : x)) : [...(p.financialOccurrences || []), ocorrencia] });
}
function validarEscolhas(iniciadoPor, concordancia, decisao) {
  if (!tem(INICIADORES, iniciadoPor) || !tem(CONCORDANCIAS, concordancia) || !tem(DECISOES, decisao)) erro('Revise quem iniciou e as decisões registradas.');
}
const movimentosDaOcorrencia = (p, o) => (p.movements || []).filter((m) => m.occurrenceId === o.id);
const creditoPendente = (p, o) => Math.max(0, -movimentosDaOcorrencia(p, o).reduce((s, m) => s + centavos(m.creditEffect), 0)) / 100;

/** Ordem de chaves por `localeCompare` do front (chaves ASCII em camelCase): letras sem caixa primeiro, minúscula antes de maiúscula no empate. */
const compararChaves = (a, b) => { const x = a.toLowerCase(); const y = b.toLowerCase(); if (x !== y) return x < y ? -1 : 1; return a === b ? 0 : (a < b ? 1 : -1); };
/** `commandSignature(input)`: a entrada sem as versões esperadas, chaves em ordem. */
const calcularAssinatura = (entrada) => JSON.stringify(Object.fromEntries(Object.entries(entrada).filter(([k]) => k !== 'expectedPaymentVersion' && k !== 'expectedConsultationVersion').sort(([a], [b]) => compararChaves(a, b))));

module.exports = {
  ROTULOS, ausente, tem, INICIADORES, CONCORDANCIAS, DECISOES, validarAtor, retratoDoMotivo, erroDoMotivo, valorPositivo, pagamentoDe, ocorrenciaDe, repetida, validarIdOperacao, consultaDa, trocarPagamento,
  gravarCaso, validarEscolhas, movimentosDaOcorrencia, creditoPendente, calcularAssinatura,
};
