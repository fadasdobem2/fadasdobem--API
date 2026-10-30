'use strict';

/**
 * Consulta, CONFERÊNCIA DE ENCERRAMENTO no servidor (Maturacao/38). Porte de `tarologas/tarologist-finish-report.ts`
 * (`approveReportedFinish`, `rejectFinishCorrection`, `normalizeReportedFinish`), `consultas/consultation-financial-review.ts`
 * (`recordFinancialReviewDecision`, `normalizePendingFinancialReview`) e `consultas/finish-review-benefit-model.ts` (`withFinishReviewBenefits`).
 * Puro: o instante `em` entra por parâmetro. `fin`: `{ payments, consultations, profile }` reais. Ouro do código real do front.
 */

const c = require('./consulta-comum');
const { revisaoFinanceira } = require('./consulta-correcao');
const { avaliarTermino } = require('./consulta-sessao');
const { tarifaDeCredito } = require('./financeiro-saldo');
const b = require('./financeiro-base');
const vinculos = require('./consulta-vinculos');

const { erro } = c;
const ROTULOS = Object.freeze({ 'awaiting-contact': 'Aguardando contato com a cliente', 'awaiting-payment': 'Cliente reconheceu · aguardando pagamento', approved: 'Adicionais pagos e aprovados', 'not-charged': 'Adicionais não cobrados · sem repasse' });
const disponivelEm = (item, em, fin, exceto) => tarifaDeCredito(item.clientId, em, undefined, fin.consultations, fin.payments, fin.profile, exceto, true).availableLots.reduce((s, l) => s + l.cents, 0);

/** `normalizePendingFinancialReview`: só relato não resolvido migra. */
function normalizarRevisaoPendente(item) {
  const r = revisaoFinanceira(item);
  if (!r || !['awaiting-contact', 'awaiting-payment'].includes(r.status)) return item;
  const segundos = Math.round(r.authorizedMinutes * 60); const realizados = Math.round(r.reportedMinutes * 60);
  if (item.financialReview && item.durationSeconds === segundos && item.performedDurationSeconds === realizados) return item;
  return { ...item, financialReview: r, performedDurationSeconds: realizados, durationSeconds: segundos,
    tarologistFinishReport: item.tarologistFinishReport ? { ...item.tarologistFinishReport, financialCap: { minutes: r.authorizedMinutes, at: r.at, reason: 'Tempo adicional ainda não autorizado pela cliente.' } } : undefined };
}

/** `normalizeReportedFinish`. */
function normalizarEncerramento(item) {
  const n = item.status === 'Em curso' && item.tarologistFinishReport && !item.finishReview
    ? { ...item, status: 'Finalizada pelo tarólogo', endedAt: item.tarologistFinishReport.endedAt, durationSeconds: Math.round((((item.tarologistFinishReport.financialCap && item.tarologistFinishReport.financialCap.minutes) ?? item.tarologistFinishReport.minutes)) * 60) } : item;
  return normalizarRevisaoPendente(n);
}

/** `recordFinancialReviewDecision`. */
function decidirRevisaoFinanceira(item, status, ator, nota, em, versao, fin) {
  c.nome(ator, 'Responsável');
  if (!Number.isFinite(Date.parse(em))) erro('Informe uma data válida para a decisão.');
  if (item.updatedAt !== versao) erro('A consulta foi atualizada. Abra a conferência novamente.');
  const normal = normalizarRevisaoPendente(item); const r = revisaoFinanceira(normal);
  if (!r || !['awaiting-contact', 'awaiting-payment'].includes(r.status)) erro('Os adicionais desta consulta já foram decididos.');
  const padrao = status === 'awaiting-contact' ? 'Aguardando contato com a cliente.' : status === 'awaiting-payment' ? 'Cliente reconheceu os minutos adicionais; aguardando pagamento.' : status === 'approved' ? 'Cliente reconheceu os adicionais e o pagamento foi conferido.' : '';
  const explicacao = c.observacao(nota.trim() || padrao, 'Motivo', true);
  let paymentIds;
  if (status === 'approved') {
    if (!fin) erro('Confira os pagamentos antes de aprovar os adicionais.');
    const candidata = { ...normal, status: 'Concluída', durationSeconds: Math.round(r.reportedMinutes * 60), updatedAt: em };
    vinculos.validarBeneficios(candidata, fin.consultations, fin.profile);
    vinculos.validarComplemento(candidata, fin.consultations, fin.payments);
    const total = Math.round(require('./financeiro-cobranca').acerto(candidata, fin.payments).debit * 100);
    const disponivel = disponivelEm(item, em, fin, item.id);
    if (fin.consultations.some((o) => o.id !== item.id && o.clientId === item.clientId && o.status === 'Em curso' && !o.tarologistFinishReport)) erro('Há outra consulta em curso desta cliente. Confira a distribuição do pagamento.');
    if (total > disponivel) erro('O saldo confirmado não cobre os adicionais. Registre ou confira o pagamento antes de aprovar.');
    paymentIds = fin.payments.filter((p) => p.clientId === item.clientId && p.status !== 'Cancelado' && (p.confirmation ? p.confirmation === 'Confirmado' : ['Informado', 'Corrigido'].includes(p.status))).map((p) => p.id);
  }
  const resolvida = status === 'approved' || status === 'not-charged';
  const evento = { id: `finance-review-${item.id}-${em}-${status}`, status, at: em, by: ator, note: explicacao, ...(paymentIds ? { paymentIds } : {}) };
  return { ...normal, status: resolvida ? 'Concluída' : 'Finalizada pelo tarólogo', durationSeconds: Math.round((status === 'approved' ? r.reportedMinutes : r.authorizedMinutes) * 60), performedDurationSeconds: Math.round(r.reportedMinutes * 60), updatedAt: em,
    financialReview: { ...r, status, at: em, by: ator, note: explicacao, paymentIds, history: [...r.history, evento] },
    finishReview: resolvida ? { at: em, by: ator, reportSubmittedAt: (item.tarologistFinishReport && item.tarologistFinishReport.submittedAt) || r.at, reportedMinutes: r.reportedMinutes, result: status === 'approved' ? 'approved' : 'corrected', reason: explicacao } : undefined,
    audit: [...item.audit, { id: evento.id, action: 'Encerramento conferido', actor: ator, createdAt: em, detail: `${ROTULOS[status]}. ${r.reportedMinutes} min informados; ${r.authorizedMinutes} min originalmente autorizados. ${explicacao}` }] };
}

/** `rejectFinishCorrection`. */
function rejeitarCorrecao(item, versao, ator, motivo, em) {
  c.nome(ator, 'Atendente');
  const nota = c.observacao(motivo, 'Motivo', true); const pendente = c.correcaoPendente(item);
  if (!pendente || item.updatedAt !== versao) erro('Esta correção foi atualizada. Abra a conferência novamente.');
  return { ...item, updatedAt: em, finishCorrections: item.finishCorrections.map((r) => (r.id === pendente.id ? { ...r, status: 'rejected', reviewedAt: em, reviewedBy: ator, reviewReason: nota } : r)),
    audit: [...item.audit, { id: `reject-correction-${item.id}-${em}`, action: 'Encerramento conferido', actor: ator, createdAt: em, detail: `Mantido o tempo de ${pendente.beforeMinutes} min. Correção para ${pendente.minutes} min não aprovada: ${nota}.` }] };
}

/** `approveReportedFinish`. */
function aprovarEncerramento(item, versao, ator, em, fin) {
  c.nome(ator, 'Atendente');
  const pendente = c.correcaoPendente(item);
  if (!pendente && item.finishReview && item.finishReview.result === 'approved' && item.finishReview.reportSubmittedAt === (item.tarologistFinishReport && item.tarologistFinishReport.submittedAt) && item.status === 'Concluída') return item;
  if (!c.aguardaConferencia(item)) erro('Este encerramento já foi conferido.');
  if (item.updatedAt !== versao) erro('O encerramento foi atualizado. Abra a conferência novamente.');
  const relato = item.tarologistFinishReport; const minutos = pendente ? pendente.minutes : relato.minutes;
  const limiteOriginal = c.limiteDe(item); const financeiraPrevia = revisaoFinanceira(item);
  const autorizado = financeiraPrevia && financeiraPrevia.status === 'approved' ? financeiraPrevia.reportedMinutes : (financeiraPrevia ? financeiraPrevia.authorizedMinutes : undefined) ?? (limiteOriginal.kind === 'maximum' ? limiteOriginal.minutes : undefined);
  if (pendente && autorizado !== undefined && minutos > autorizado) {
    const nota = `Tempo realizado corrigido de ${pendente.beforeMinutes} para ${minutos} minutos. ${pendente.reason}. Adicionais aguardando contato e decisão.`;
    const preserva = financeiraPrevia && financeiraPrevia.status === 'not-charged' && minutos <= financeiraPrevia.reportedMinutes;
    const situacao = preserva ? 'not-charged' : 'awaiting-contact';
    return { ...item, status: preserva ? 'Concluída' : 'Finalizada pelo tarólogo', durationSeconds: Math.round(autorizado * 60), performedDurationSeconds: Math.round(minutos * 60), updatedAt: em, finishReview: preserva ? item.finishReview : undefined,
      tarologistFinishReport: { ...relato, minutes: minutos, financialCap: { minutes: autorizado, at: em, reason: 'Tempo adicional ainda não autorizado pela cliente.' } },
      financialReview: { authorizedMinutes: autorizado, reportedMinutes: minutos, status: situacao, at: em, by: ator, note: nota, history: [...((financeiraPrevia && financeiraPrevia.history) || []), { id: `finance-correction-${item.id}-${em}`, status: situacao, at: em, by: ator, note: nota }] },
      finishCorrections: item.finishCorrections.map((r) => (r.id === pendente.id ? { ...r, status: 'approved', appliedMinutes: minutos, reviewedAt: em, reviewedBy: ator } : r)),
      audit: [...item.audit, { id: `review-${item.id}-${em}`, action: 'Encerramento conferido', actor: ator, createdAt: em, detail: nota }] };
  }
  if (!pendente && revisaoFinanceira(item)) {
    const proximo = decidirRevisaoFinanceira(item, 'approved', ator, 'Cliente reconheceu os adicionais; recebimento confirmado conferido.', em, versao, fin);
    if (fin) { vinculos.validarBeneficios(proximo, fin.consultations, fin.profile); vinculos.validarComplemento(proximo, fin.consultations, fin.payments); }
    return proximo;
  }
  const proximo = { ...normalizarEncerramento(item), status: 'Concluída', durationSeconds: Math.round(minutos * 60), updatedAt: em, performedDurationSeconds: Math.round(minutos * 60),
    financialReview: pendente ? undefined : item.financialReview,
    tarologistFinishReport: { ...relato, minutes: minutos, earlyFinish: relato.earlyFinish && minutos < relato.earlyFinish.maximumMinutes ? relato.earlyFinish : undefined },
    finishReview: { at: em, by: ator, reportSubmittedAt: relato.submittedAt, reportedMinutes: minutos, result: 'approved' },
    finishCorrections: pendente ? item.finishCorrections.map((r) => (r.id === pendente.id ? { ...r, status: 'approved', appliedMinutes: minutos, reviewedAt: em, reviewedBy: ator } : r)) : item.finishCorrections,
    audit: [...item.audit, { id: `review-${item.id}-${em}`, action: 'Encerramento conferido', actor: ator, createdAt: em, detail: pendente ? `Correção aprovada: ${pendente.beforeMinutes} → ${minutos} min, solicitada por ${pendente.requestedBy}. Motivo: ${pendente.reason}.` : `Concordou com ${minutos} minutos informados por ${relato.reporterName}.` }] };
  const precisaSaldo = (limiteOriginal.kind === 'maximum' && minutos > limiteOriginal.minutes) || Boolean(relato.reviewReasons && relato.reviewReasons.includes('extra_minutes')) || Boolean(pendente && minutos > pendente.beforeMinutes);
  if (precisaSaldo) {
    if (!fin) erro('Não foi possível conferir o saldo desta correção.');
    const confere = avaliarTermino(item, minutos, em, fin);
    if (confere.error) erro(confere.error);
    if ((item.paymentProfile === 'Pré-paga' || (limiteOriginal.kind === 'maximum' && minutos > limiteOriginal.minutes)) && !confere.extraCovered) erro('O saldo confirmado mudou e não cobre o tempo solicitado. Confira os pagamentos.');
  }
  if (fin) { vinculos.validarBeneficios(proximo, fin.consultations, fin.profile); vinculos.validarComplemento(proximo, fin.consultations, fin.payments); }
  return proximo;
}

module.exports = { normalizarRevisaoPendente, normalizarEncerramento, decidirRevisaoFinanceira, rejeitarCorrecao, aprovarEncerramento, ROTULOS, disponivelEm };
