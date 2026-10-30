'use strict';

/**
 * Ocorrências financeiras no servidor (Maturacao/42, item 3): porte de `recordFinancialOccurrence`, `updateFinancialOccurrence` e
 * `waiveConsultationCharge` (a parte que RECUSA) de `features/finance/financial-occurrences.ts`: as ~25 recusas de valor do front (devolução só com
 * dinheiro retirado, crédito restante só pelo Fadas, contestação x modalidade, dispensa <= cobrança restante, ação bancária só em contestação...).
 * `entrada` é o comando do front SEM as versões esperadas (concorrência é do servidor: `expectedVersion` 409). `opcoes.assinatura` é a assinatura
 * que o navegador guardou (o servidor a reproduz); sem ela, calcula como o front. O resultado da consulta (dispensa) é da fatia Consulta: aqui só se confere.
 */

const L = require('./pagamentos-livro');
const B = require('./pagamentos-ocorrencias-base');
const { registrarMovimento, creditoDaDevolucao } = require('./pagamentos-movimento');
const { devolverCreditoRestante } = require('./pagamentos-credito');
const cobranca = require('./financeiro-cobranca');

const { erro, centavos } = L;

/** Validação de `waiveConsultationCharge` (o registro novo da consulta é gravado pela rota da consulta). */
function conferirDispensa(estado, entrada, ator, papel, em) {
  B.validarAtor(ator, papel, em); B.validarIdOperacao(entrada.operationId);
  const valor = B.valorPositivo(entrada.amount);
  const motivo = L.validarObservacao(entrada.reason, 'Motivo da dispensa', true);
  const retrato = B.retratoDoMotivo(entrada.reasonSnapshot, motivo, 'charge-waiver', Boolean(entrada.occurrenceId));
  const item = estado.consultations.find((x) => x.id === entrada.consultationId);
  if (!item) erro('Consulta não encontrada.');
  const velho = item.billing && item.billing.chargeAdjustments && item.billing.chargeAdjustments.find((x) => x.id === entrada.operationId);
  if (velho) {
    if (velho.amount === valor && velho.reason === motivo && velho.occurrenceId === entrada.occurrenceId && velho.paymentId === entrada.paymentId && JSON.stringify(velho.reasonSnapshot) === JSON.stringify(retrato)) return estado;
    erro('Esta dispensa já foi registrada com outro valor.');
  }
  if (entrada.paymentId && !estado.payments.some((p) => p.id === entrada.paymentId && p.clientId === item.clientId)) erro('O pagamento não pertence à cliente desta consulta.');
  if (centavos(valor) > centavos(cobranca.acerto(item, estado.payments).debit)) erro('A dispensa ultrapassa a cobrança restante desta consulta.');
  return estado;
}

/** `recordFinancialOccurrence(state, input, actor, role, at)`; `perfil` = perfil de crédito da cliente (o do servidor). */
function registrarOcorrencia(estado, entrada, ator, papel, em, opcoes = {}) {
  B.validarAtor(ator, papel, em); B.validarIdOperacao(entrada.operationId); B.validarIdOperacao(entrada.id);
  const assinatura = opcoes.assinatura || B.calcularAssinatura(entrada);
  const p = B.pagamentoDe(estado, entrada.paymentId);
  const anterior = (p.financialOccurrences || []).find((x) => x.id === entrada.id);
  if (anterior) { if (B.repetida(anterior, entrada.operationId, assinatura)) return estado; erro('Esta ocorrência já existe. Abra o registro para atualizá-la.'); }
  B.validarEscolhas(entrada.initiatedBy, entrada.agreement, entrada.chargeDecision);
  if (!Object.hasOwn(B.ROTULOS, entrada.kind)) erro('Selecione o tipo da ocorrência.');
  const valor = B.valorPositivo(entrada.amount); const nota = L.validarObservacao(entrada.note, 'Observação', true); const ocorreuEm = entrada.occurredAt || em;
  const retrato = B.retratoDoMotivo(entrada.reasonSnapshot, nota, entrada.kind);
  const consulta = B.consultaDa(estado, p, entrada.consultationId || p.linkedConsultationId);
  if ((entrada.kind === 'dispute-pix' && p.method !== 'PIX') || (entrada.kind === 'dispute-card' && p.method !== 'Cartão de crédito')) erro('A modalidade da contestação precisa corresponder ao pagamento.');
  if (entrada.refundSource && !['remaining', 'bank'].includes(entrada.refundSource)) erro('Escolha a origem da devolução.');
  if (entrada.refundSource === 'remaining' && entrada.kind !== 'refund') erro('A devolução de crédito restante deve ser feita pelo Fadas.');
  if (entrada.creditProfile && entrada.creditProfile.clientId !== p.clientId) erro('Confira a cliente do saldo a devolver.');
  if (B.ausente(entrada.kind) && entrada.bankMoved) erro('Pagamento não localizado não representa saída bancária.');
  if ((entrada.kind === 'refund' || entrada.kind === 'client-refund') && !entrada.bankMoved) erro('Registre a devolução somente quando o dinheiro tiver sido retirado.');
  if ((p.financialOccurrences || []).some((x) => B.ausente(x.kind) && B.ausente(entrada.kind) && B.creditoPendente(p, x) > 0)) erro('Este pagamento já tem crédito não localizado. Atualize a ocorrência existente.');
  const ocorrencia = {
    id: entrada.id, paymentId: p.id, clientId: p.clientId, consultationId: consulta && consulta.id, kind: entrada.kind, reasonId: (retrato && retrato.id) || entrada.reasonId,
    reasonLabel: (retrato && retrato.name) || (entrada.reasonLabel && entrada.reasonLabel.trim()) || B.ROTULOS[entrada.kind], reasonSnapshot: retrato, ruleVersion: 1,
    initiatedBy: entrada.initiatedBy, agreement: entrada.agreement, chargeDecision: entrada.chargeDecision, amount: valor, note: nota, createdAt: em, createdBy: ator, updatedAt: em,
    events: [{ id: entrada.operationId, action: 'Ocorrência registrada', at: em, by: ator, note: nota, reasonSnapshot: retrato, decision: { agreement: entrada.agreement, chargeDecision: entrada.chargeDecision, kind: entrada.kind } }],
    contacts: [], settlements: [], commandSignatures: { [entrada.operationId]: assinatura },
  };
  const tipo = B.ausente(entrada.kind) ? entrada.kind : entrada.kind === 'refund' || entrada.kind === 'client-refund' ? 'refund' : 'dispute';
  let proximo;
  const idMovimento = `${entrada.operationId}:movement`;
  if (entrada.refundSource === 'remaining') {
    proximo = devolverCreditoRestante(p, { amount: valor, bankAmount: entrada.bankAmount, note: nota, occurredAt: ocorreuEm, agendaItemId: entrada.agendaItemId, agendaTarotId: entrada.agendaTarotId, agendaRefundRequestId: entrada.agendaRefundRequestId },
      { ...estado, profile: entrada.creditProfile }, ator, idMovimento, em);
    proximo = { ...proximo, movements: proximo.movements.map((m) => (m.id === idMovimento ? { ...m, occurrenceId: ocorrencia.id, initiatedBy: entrada.initiatedBy, agreement: entrada.agreement } : m)) };
  } else {
    proximo = registrarMovimento(p, { kind: tipo, amount: valor, bankMoved: entrada.bankMoved, creditAmount: tipo === 'refund' ? creditoDaDevolucao(p, valor) : undefined, note: nota, occurredAt: ocorreuEm, occurrenceId: ocorrencia.id, initiatedBy: entrada.initiatedBy, agreement: entrada.agreement,
      agendaItemId: entrada.agendaItemId, agendaTarotId: entrada.agendaTarotId, agendaRefundRequestId: entrada.agendaRefundRequestId }, ator, idMovimento, em);
  }
  let seguinte = B.trocarPagamento(estado, proximo);
  if (entrada.chargeDecision === 'waive') {
    if (!consulta) erro('Selecione a consulta cuja cobrança será dispensada.');
    if (!entrada.waiverAmount) erro('Informe o valor da cobrança a dispensar.');
    seguinte = conferirDispensa(seguinte, { operationId: `${entrada.operationId}:waiver`, consultationId: consulta.id, amount: entrada.waiverAmount, reason: nota, reasonSnapshot: entrada.reasonSnapshot, occurrenceId: ocorrencia.id, paymentId: p.id }, ator, papel, em);
  } else if (entrada.waiverAmount) erro('Escolha Dispensar cobrança para registrar a dispensa.');
  return B.gravarCaso(seguinte, proximo, ocorrencia, ator, em);
}

/** `updateFinancialOccurrence(state, input, actor, role, at)`. */
function atualizarOcorrencia(estado, entrada, ator, papel, em, opcoes = {}) {
  B.validarAtor(ator, papel, em); B.validarIdOperacao(entrada.operationId);
  const p = B.pagamentoDe(estado, entrada.paymentId); const o = B.ocorrenciaDe(p, entrada.occurrenceId); const assinatura = opcoes.assinatura || B.calcularAssinatura(entrada);
  if (B.repetida(o, entrada.operationId, assinatura)) return estado;
  const nota = L.validarObservacao(entrada.note, 'Motivo da decisão', true);
  const retrato = B.retratoDoMotivo(entrada.reasonSnapshot, entrada.note, entrada.kind || o.kind);
  if (entrada.chargeDecision && entrada.chargeDecision !== 'waive' && o.chargeDecision === 'waive') erro('A dispensa já lançada permanece no histórico e não pode virar cobrança por esta decisão.');
  const concordancia = entrada.agreement || o.agreement; const decisao = entrada.chargeDecision || o.chargeDecision;
  B.validarEscolhas(o.initiatedBy, concordancia, decisao);
  if (entrada.kind && (!B.ausente(o.kind) || !B.ausente(entrada.kind))) erro('A alteração de diagnóstico é permitida apenas para pagamento ausente.');
  const consulta = B.consultaDa(estado, p, entrada.consultationId || o.consultationId);
  if (entrada.consultationId && entrada.consultationId !== o.consultationId && estado.consultations.some((c) => c.billing && c.billing.chargeAdjustments && c.billing.chargeAdjustments.some((a) => a.occurrenceId === o.id))) erro('Esta ocorrência já possui dispensa vinculada. Preserve a consulta de origem.');
  let proximo = p;
  const acao = entrada.action || 'review';
  if (!['review', 'withdraw', 'bank-accepted', 'bank-rejected'].includes(acao)) erro('Escolha uma ação bancária válida.');
  if (acao !== 'review') {
    const origem = B.movimentosDaOcorrencia(p, o).find((m) => m.kind === 'dispute');
    if (!origem) erro('Esta ocorrência não é uma contestação bancária.');
    const tipo = acao === 'withdraw' ? 'dispute-debit' : acao === 'bank-accepted' ? 'dispute-accepted' : 'dispute-rejected';
    proximo = registrarMovimento(p, { kind: tipo, amount: B.valorPositivo(entrada.amount ?? o.amount), bankMoved: acao === 'withdraw' || Boolean(entrada.bankMoved), parentId: origem.id, note: nota, occurredAt: em, occurrenceId: o.id, initiatedBy: o.initiatedBy, agreement: concordancia }, ator, `${entrada.operationId}:movement`, em);
  }
  let seguinte = B.trocarPagamento(estado, proximo);
  if (entrada.waiverAmount) {
    if (decisao !== 'waive' || !consulta) erro('Selecione a consulta e a decisão de dispensar cobrança.');
    seguinte = conferirDispensa(seguinte, { operationId: `${entrada.operationId}:waiver`, consultationId: consulta.id, amount: entrada.waiverAmount, reason: nota, reasonSnapshot: entrada.reasonSnapshot, occurrenceId: o.id, paymentId: p.id }, ator, papel, em);
  }
  if (decisao === 'waive' && o.chargeDecision !== 'waive' && !entrada.waiverAmount) erro('Informe o valor a dispensar.');
  const rotuloDoEvento = acao === 'review' ? 'Decisão financeira registrada' : acao === 'withdraw' ? 'Retirada pelo banco' : acao === 'bank-accepted' ? 'Contestação aceita pelo banco' : 'Contestação não aceita pelo banco';
  const atualizada = {
    ...o, consultationId: consulta && consulta.id, kind: entrada.kind || o.kind, reasonId: (retrato && retrato.id) || entrada.reasonId || o.reasonId,
    reasonLabel: (retrato && retrato.name) || (entrada.reasonLabel && entrada.reasonLabel.trim()) || (entrada.kind ? B.ROTULOS[entrada.kind] : o.reasonLabel),
    reasonSnapshot: retrato || (entrada.kind && entrada.kind !== o.kind ? undefined : o.reasonSnapshot), agreement: concordancia, chargeDecision: decisao, note: nota, updatedAt: em,
    events: [...o.events, { id: entrada.operationId, action: rotuloDoEvento, at: em, by: ator, note: nota, reasonSnapshot: retrato, decision: { agreement: concordancia, chargeDecision: decisao, kind: entrada.kind || o.kind } }],
    commandSignatures: { ...o.commandSignatures, [entrada.operationId]: assinatura },
  };
  return B.gravarCaso(seguinte, proximo, atualizada, ator, em);
}

module.exports = { registrarOcorrencia, atualizarOcorrencia, conferirDispensa };
