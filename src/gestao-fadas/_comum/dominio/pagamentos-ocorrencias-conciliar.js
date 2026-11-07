'use strict';

/**
 * Ocorrências financeiras no servidor (Maturacao/42, item 3), continuação: porte de `reconcileFinancialOccurrence`, `settleFinancialOccurrence`
 * e `contactFinancialOccurrence` (`features/finance/financial-occurrences.ts`): retorno do dinheiro, pagamento localizado, regularização com outro
 * recebimento confirmado da mesma cliente e contato com a cliente. Mesmas frases, mesmo resultado. Ver `pagamentos-ocorrencias.js`.
 */

const L = require('./pagamentos-livro');
const B = require('./pagamentos-ocorrencias-base');
const { registrarMovimento } = require('./pagamentos-movimento');
const { creditoRestante } = require('./pagamentos-credito');

const { erro, centavos, recebimentoConfirmado, valorParaConsultas } = L;

/** `reconcileFinancialOccurrence`. */
function reconciliarOcorrencia(estado, entrada, ator, papel, em, opcoes = {}) {
  B.validarAtor(ator, papel, em); B.validarIdOperacao(entrada.operationId);
  const p = B.pagamentoDe(estado, entrada.paymentId); const o = B.ocorrenciaDe(p, entrada.occurrenceId); const assinatura = opcoes.assinatura || B.calcularAssinatura(entrada);
  if (B.repetida(o, entrada.operationId, assinatura)) return estado;
  const nota = L.validarObservacao(entrada.note, 'Observação da reconciliação', true); const valor = B.valorPositivo(entrada.amount);
  const ausente = B.ausente(o.kind);
  const origem = B.movimentosDaOcorrencia(p, o).find((m) => (ausente ? m.kind === 'payment-missing' || m.kind === 'scheduled-unpaid' : m.kind === 'dispute'));
  if (!origem) erro('Localize a retirada ou correção original desta ocorrência.');
  let proximo = registrarMovimento(p, { kind: ausente ? 'payment-reconciled' : 'dispute-return', amount: valor, bankMoved: !ausente, parentId: origem.id, note: nota, occurredAt: entrada.occurredAt || em, occurrenceId: o.id, initiatedBy: o.initiatedBy, agreement: o.agreement }, ator, `${entrada.operationId}:movement`, em);
  if (ausente) proximo = { ...proximo, confirmation: 'Confirmado', status: p.status === 'Corrigido' ? 'Corrigido' : 'Informado' };
  const atualizada = { ...o, updatedAt: em, events: [...o.events, { id: entrada.operationId, action: ausente ? 'Pagamento localizado' : 'Dinheiro retornou', at: em, by: ator, note: nota }], commandSignatures: { ...o.commandSignatures, [entrada.operationId]: assinatura } };
  return B.gravarCaso(estado, proximo, atualizada, ator, em);
}

/** `settleFinancialOccurrence`: aloca um recebimento confirmado já existente; nunca fabrica um segundo recebimento nem crédito. */
function regularizarOcorrencia(estado, entrada, ator, papel, em, opcoes = {}) {
  B.validarAtor(ator, papel, em); B.validarIdOperacao(entrada.operationId);
  const p = B.pagamentoDe(estado, entrada.paymentId); const o = B.ocorrenciaDe(p, entrada.occurrenceId); const assinatura = opcoes.assinatura || B.calcularAssinatura(entrada);
  if (B.repetida(o, entrada.operationId, assinatura)) return estado;
  const nota = L.validarObservacao(entrada.note, 'Observação da regularização', true); const valor = B.valorPositivo(entrada.amount); const recibo = B.pagamentoDe(estado, entrada.settlementPaymentId);
  if (p.unidentified || recibo.unidentified || !p.clientId) erro('Identifique a cliente antes de regularizar uma cobrança.');
  if (recibo.clientId !== p.clientId || recibo.id === p.id || !recebimentoConfirmado(recibo)) erro('Selecione outro recebimento confirmado da mesma cliente.');
  if (recibo.linkedConsultationId && recibo.linkedConsultationId !== o.consultationId) erro('Este recebimento já está vinculado a outra consulta.');
  if (entrada.creditProfile && entrada.creditProfile.clientId !== p.clientId) erro('Confira a cliente do recebimento.');
  if (!o.consultationId) erro('Vincule a consulta de origem antes de registrar a regularização.');
  const outras = estado.consultations.filter((c) => c.id !== o.consultationId);
  const restante = creditoRestante(recibo, { payments: estado.payments, consultations: outras, profile: entrada.creditProfile }, em);
  if (centavos(valor) > centavos(restante.amount)) erro('Este recebimento já foi utilizado ou reservado em outra consulta e não está disponível para regularização.');
  const casos = estado.payments.flatMap((x) => x.financialOccurrences || []);
  const alocado = casos.flatMap((c) => c.settlements).filter((x) => x.paymentId === recibo.id).reduce((s, x) => s + centavos(x.amount), 0);
  const alocadoNaMesma = casos.filter((c) => c.consultationId === o.consultationId).flatMap((c) => c.settlements).filter((x) => x.paymentId === recibo.id).reduce((s, x) => s + centavos(x.amount), 0);
  if (centavos(valor) > Math.min(centavos(valorParaConsultas(recibo)) - alocado, centavos(restante.amount) - alocadoNaMesma)) erro('Este recebimento não tem esse valor disponível para regularização.');
  const jaRegularizado = o.settlements.reduce((s, x) => s + centavos(x.amount), 0);
  const dispensado = estado.consultations.flatMap((c) => (c.billing && c.billing.chargeAdjustments) || []).filter((x) => x.occurrenceId === o.id).reduce((s, x) => s + centavos(x.amount), 0);
  if (centavos(valor) > centavos(B.creditoPendente(p, o)) - jaRegularizado - dispensado) erro('O valor ultrapassa a pendência ainda não regularizada desta ocorrência.');
  const atualizada = { ...o, updatedAt: em, settlements: [...o.settlements, { id: entrada.operationId, paymentId: recibo.id, amount: valor, at: em, by: ator }], events: [...o.events, { id: entrada.operationId, action: 'Pagamento vinculado à regularização', at: em, by: ator, note: nota }], commandSignatures: { ...o.commandSignatures, [entrada.operationId]: assinatura } };
  return B.gravarCaso(estado, p, atualizada, ator, em);
}

/** `contactFinancialOccurrence`: qualquer papel de equipe (menos a taróloga). */
function contatarOcorrencia(estado, entrada, ator, papel, em, opcoes = {}) {
  B.validarAtor(ator, papel, em, false); B.validarIdOperacao(entrada.operationId);
  const p = B.pagamentoDe(estado, entrada.paymentId); const o = B.ocorrenciaDe(p, entrada.occurrenceId); const assinatura = opcoes.assinatura || B.calcularAssinatura(entrada);
  if (B.repetida(o, entrada.operationId, assinatura)) return estado;
  const nota = L.validarObservacao(entrada.note, 'Contato com a cliente', true); const canal = L.validarObservacao(entrada.channel, 'Canal do contato', true);
  const atualizada = { ...o, updatedAt: em, contacts: [...o.contacts, { id: entrada.operationId, at: em, by: ator, channel: canal, note: nota }], events: [...o.events, { id: entrada.operationId, action: 'Contato registrado', at: em, by: ator, note: nota }], commandSignatures: { ...o.commandSignatures, [entrada.operationId]: assinatura } };
  return B.gravarCaso(estado, p, atualizada, ator, em);
}

module.exports = { reconciliarOcorrencia, regularizarOcorrencia, contatarOcorrencia };
