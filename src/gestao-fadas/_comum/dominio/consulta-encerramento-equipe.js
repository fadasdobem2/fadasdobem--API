'use strict';

/**
 * Consulta, ENCERRAMENTO pela equipe (Concluída, Cancelada, Devolvida, Não houve) no servidor (Maturacao/38). É o `finishConsultation` de
 * `consultas/consultations-experience.tsx` (sem função pura no front: transcrito do componente, com as funções reais que ele chama portadas
 * em `consulta-*.js`). Puro: instante `em` e papel entram por parâmetro. Não porta efeitos de TELA nem os vínculos de pagamento
 * (`releaseConsultationPaymentLinks`, que moram na fatia Pagamentos) nem a agenda.
 */

const c = require('./consulta-comum');
const cob = require('./financeiro-cobranca');
const b = require('./financeiro-base');
const des = require('./consulta-desfechos');
const corr = require('./consulta-correcao');
const sessao = require('./consulta-sessao');
const conf = require('./consulta-conferencia');
const aval = require('./consulta-conferencia-avaliacao');
const { validarContinuacao } = require('./consulta-continuacao');

const { erro } = c;
const DESFECHOS = ['Concluída', 'Cancelada', 'Devolvida', 'Não houve'];
const dinheiro = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** `billingForConsultation` + `billingForConsultationFinish` (consultation-billing.ts:92-103). */
function cobrancaDoEncerramento(item, pagamentos, ator, em) {
  // `grantUnusedCredit` é sempre `false` nas chamadas do front: o mínimo não é dispensado e o crédito não usado não é mantido.
  const manter = false; const dispensado = false;
  const minimo = (item.billing && item.billing.minimumMinutes) ?? 15;
  return { chargeAdjustments: item.billing && item.billing.chargeAdjustments, tariff: item.billing && item.billing.tariff, unitValueOverride: item.billing && item.billing.unitValueOverride,
    minimumMinutes: minimo, minimumWaived: dispensado, keepUnusedCashCredit: manter, funding: cob.financiamento(item, pagamentos),
    decidedBy: ator || (item.billing && item.billing.decidedBy), decidedAt: em || (item.billing && item.billing.decidedAt) };
}

/** `consultationFinishTiming` (consultation-billing.ts:277). */
function horarioDoEncerramento(inicio, minutos, desfecho) {
  if (desfecho !== 'Não houve') {
    const segundos = Math.round(minutos * 60); const fim = new Date(new Date(inicio).getTime() + segundos * 1000);
    if (!Number.isFinite(minutos) || !Number.isSafeInteger(segundos) || segundos < 1 || !Number.isFinite(fim.getTime())) erro('Informe um tempo válido em minutos.');
    return { durationSeconds: segundos, endedAt: fim.toISOString() };
  }
  const t = new Date(inicio);
  if (!Number.isFinite(t.getTime())) erro('Informe um horário de início válido.');
  return { durationSeconds: 0, endedAt: t.toISOString() };
}

const idEvento = des.idDeEvento;

/**
 * `finishConsultation`. `e`: `{ outcome, minutes, startedAt, isReview, reviewReason, complaint, complaintDetails, bonusEnabled, bonusMinutes, benefitSelection, version }`.
 * `ctx`: `{ ator, papel, em, fin: { payments, consultations, profile } }`. Devolve o registro novo.
 */
function encerrar(alvo, e, ctx) {
  const { ator, papel, em, fin } = ctx;
  c.nome(ator, 'Atendente');
  if (!DESFECHOS.includes(e.outcome)) erro('Conclusão da consulta: selecione uma opção válida.');
  if (e.isReview && !c.aguardaConferencia(alvo)) erro('Este encerramento já foi conferido ou alterado. Abra a consulta novamente.');
  if (!e.isReview && alvo.status !== 'Em curso') erro('Esta consulta já foi encerrada. Abra a consulta novamente.');
  if (!e.isReview && alvo.updatedAt !== e.version) erro('A consulta foi atualizada. Abra o encerramento novamente para conferir o tempo.');
  if (e.isReview && alvo.updatedAt !== e.version) erro('O encerramento foi atualizado. Abra a conferência novamente.');
  const motivo = e.outcome === 'Cancelada' ? 'Encerramento conferido pela equipe.' : (e.reviewReason || '').trim();
  if (e.isReview && e.outcome !== 'Cancelada' && !motivo) erro('Informe o motivo da correção.');
  // validateFinishFields
  if (e.outcome === 'Cancelada') des.validarQueixa({ ...e.complaintDetails, complaint: e.complaint }, true);
  const minutos = e.outcome === 'Não houve' ? 0 : e.minutes;
  if (!Number.isFinite(minutos) || (minutos <= 0 && e.outcome !== 'Não houve')) erro('Informe uma duração válida.');
  if (Date.parse(e.startedAt) > Date.parse(em)) erro('O início da consulta não pode estar no futuro.');
  const duracao = horarioDoEncerramento(e.startedAt, minutos, e.outcome);
  let concessao;
  if (e.outcome === 'Cancelada' && e.bonusEnabled) concessao = des.concessaoDaCompensacao({ ...alvo, status: 'Cancelada', durationSeconds: Math.round(minutos * 60) }, fin.payments, e.bonusMinutes, des.MOTIVOS_DE_BONUS[0], ator, em);
  const fimPausas = alvo.pauseHistory && alvo.pauseHistory.length && minutos > 0 ? c.fimComPausas(alvo, minutos * 60, em, e.startedAt) : duracao.endedAt;
  const limite = c.limiteDe(alvo);
  if (e.outcome === 'Concluída' && limite.kind === 'maximum' && minutos > limite.minutes) {
    const pendente = e.isReview ? corr.corrigirTempo({ ...alvo, startedAt: e.startedAt }, minutos, motivo, ator, em, e.version, fin) : sessao.informarTerminoPelaEquipe({ ...alvo, startedAt: e.startedAt }, minutos, ator, em, fin);
    pendente.endedAt = fimPausas;
    if (e.isReview) {
      pendente.finishCorrections = alvo.finishCorrections && alvo.finishCorrections.map((r) => (r.status === 'pending' ? { ...r, status: 'approved', appliedMinutes: minutos, reviewedAt: em, reviewedBy: ator, reviewReason: motivo } : r));
      pendente.audit = [...pendente.audit, { id: idEvento(em), action: 'Dados corrigidos', detail: `Tempo informado corrigido de ${c.minutosRelatados(alvo)} para ${minutos} min. ${motivo}. Adicionais continuam pendentes.`, actor: ator, createdAt: em }];
    }
    if (pendente.tarologistFinishReport) pendente.tarologistFinishReport.endedAt = fimPausas;
    pendente.billing = cobrancaDoEncerramento(pendente, fin.payments, ator, em);
    pendente.minuteValue = cob.valorDoMinutoDaConsulta(pendente, fin.payments);
    validarContinuacao(pendente, fin.consultations);
    return pendente;
  }
  const rotulo = e.outcome === 'Concluída' ? 'Consulta concluída' : e.outcome === 'Cancelada' ? 'Consulta cancelada' : e.outcome === 'Devolvida' ? 'Consulta devolvida' : 'Não houve';
  const detalheDoDesfecho = e.outcome === 'Concluída' ? `${minutos} minutos realizados; atendimento concluído normalmente.`
    : e.outcome === 'Cancelada' ? `${minutos} minutos realizados; cancelada após queixa da cliente. Pagamento aguardando decisão da administradora.`
      : e.outcome === 'Devolvida' ? `${minutos} minutos registrados antes da devolução; sem repasse e com a cobertura liberada.` : `Não houve. Tempo registrado: ${minutos} min.`;
  let financiado = alvo;
  if (e.isReview && e.outcome === 'Concluída') financiado = aval.comBeneficiosDaConferencia(alvo, e.benefitSelection || {}, fin, ator, em, minutos);
  let encerrada = { ...c.fecharPausa(financiado, ator, em), awaitingTarologistStart: false, startedAt: e.startedAt, status: e.outcome, endedAt: fimPausas, durationSeconds: Math.round(minutos * 60), performedDurationSeconds: Math.round(minutos * 60), financialReview: undefined, bonusGrant: concessao, updatedAt: em };
  if (e.outcome === 'Cancelada') encerrada = des.solicitarRevisaoDeCancelamento({ ...encerrada, status: financiado.status }, e.complaint, ator, em, papel, { ...e.complaintDetails, complaint: e.complaint });
  const temPedido = (encerrada.tarologistMoreTimeRequest && encerrada.tarologistMoreTimeRequest.active) ?? (encerrada.tarologistFinishReport && encerrada.tarologistFinishReport.clientWantsMoreTime) ?? false;
  const retiraMaisTempo = ['Não houve', 'Devolvida', 'Anulada', 'Erro'].includes(encerrada.status) && !b.retemCoberturaDeCancelamento(encerrada) && Boolean(temPedido);
  if (retiraMaisTempo) Object.assign(encerrada, c.limparPedidoDeMaisTempo(encerrada));
  encerrada.billing = cobrancaDoEncerramento(encerrada, fin.payments, ator, em);
  encerrada.minuteValue = cob.valorDoMinutoDaConsulta(encerrada, fin.payments);
  validarContinuacao(encerrada, fin.consultations);
  corr.conferirCobertura(alvo, encerrada, fin, em);
  const acerto = cob.acerto(encerrada, fin.payments);
  const financeiro = e.outcome === 'Não houve' ? '' : e.outcome === 'Devolvida' ? ''
    : e.outcome === 'Cancelada' ? `${concessao ? `Bônus de ${concessao.minutes} min concedido para uma nova consulta.` : 'Nenhum bônus concedido.'} Crédito desta consulta: ${dinheiro.format(acerto.cashCredit)}.`
      : encerrada.coverage && encerrada.coverage.kind === 'Cortesia' ? `Cortesia: ${acerto.unusedBenefit} min não utilizados, sem crédito.`
        : `Cobrança: ${acerto.chargeable} min; crédito: ${dinheiro.format(acerto.cashCredit)}${encerrada.billing.minimumWaived ? '; mínimo dispensado pelo atendimento' : ''}${acerto.complementMinutes ? `; ${acerto.complementMinutes} min disponíveis para completar` : ''}.`;
  const pendente = c.correcaoPendente(alvo);
  if (e.isReview && pendente) encerrada.finishCorrections = alvo.finishCorrections.map((r) => (r.status === 'pending' ? { ...r, status: 'approved', appliedMinutes: minutos, reviewedAt: em, reviewedBy: ator, reviewReason: motivo } : r));
  if (e.isReview) encerrada.finishReview = { at: em, by: ator, reportSubmittedAt: alvo.tarologistFinishReport.submittedAt, reportedMinutes: alvo.tarologistFinishReport.minutes, result: 'corrected', reason: motivo };
  const prefixo = e.isReview ? `Correção de ${alvo.tarologistFinishReport.minutes} para ${minutos} min. Início ${alvo.startedAt} → ${e.startedAt}; término ${alvo.endedAt} → ${fimPausas}; situação ${alvo.status} → ${e.outcome}. Motivo: ${motivo}. ` : '';
  encerrada.audit = [...encerrada.audit, { id: idEvento(em), action: e.isReview ? 'Encerramento conferido' : rotulo, detail: `${prefixo}${detalheDoDesfecho} ${financeiro}${retiraMaisTempo ? ' Pedido de mais tempo retirado pelo encerramento.' : ''}`, actor: ator, createdAt: em }];
  return encerrada;
}

module.exports = { encerrar, cobrancaDoEncerramento, horarioDoEncerramento, DESFECHOS };
