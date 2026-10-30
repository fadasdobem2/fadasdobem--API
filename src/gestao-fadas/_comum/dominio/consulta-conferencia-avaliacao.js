'use strict';

/**
 * Consulta, conferência de encerramento: AVALIAÇÃO e BENEFÍCIOS nos minutos adicionais (Maturacao/38). Porte de
 * `consultas/finish-review-assessment.ts` (`finishReviewAssessment`) e `consultas/finish-review-benefit-model.ts`
 * (`finishReviewBenefitLimit`, `finishReviewBenefitOptions`, `withFinishReviewBenefits`). Só o que decide aceitar ou recusar
 * (o front também monta a linha do tempo de pagamentos para a tela; isso não é regra e não foi portado).
 */

const c = require('./consulta-comum');
const b = require('./financeiro-base');
const { avaliarTermino } = require('./consulta-sessao');
const vinculos = require('./consulta-vinculos');

const { erro } = c;

/** `finishReviewMinutes`. */
const minutosDaConferencia = (item) => { const p = c.correcaoPendente(item); return (p && p.minutes) ?? (item.tarologistFinishReport && item.tarologistFinishReport.minutes) ?? item.durationSeconds / 60; };

/** `consultationStartTimes(item).tarologistAt`. */
function inicioDoTarologo(item) {
  const gravado = item.tarologistStartedAt || (item.audit || []).find((e) => e.action === 'Consulta iniciada pelo tarólogo')?.createdAt;
  return item.awaitingTarologistStart ? undefined : gravado;
}

/** `finishReviewAssessment` (só o que decide). */
function avaliarConferencia(item, fin, agora, minutosPropostos = minutosDaConferencia(item)) {
  const relato = item.tarologistFinishReport; const limite = c.limiteDe(item);
  const maximo = limite.kind === 'maximum' ? limite.minutes : null;
  const enviadoEm = (relato && relato.submittedAt) || item.endedAt || agora;
  const inicio = inicioDoTarologo(item) || item.startedAt;
  const normal = { ...item, tarologistStartedAt: inicio };
  const historico = avaliarTermino(normal, minutosPropostos, enviadoEm, fin);
  const atual = avaliarTermino(normal, minutosPropostos, agora, fin);
  const sobra = maximo === null ? 0 : Math.max(0, minutosPropostos - maximo);
  const diferencaDeHorario = historico.needsTimingConfirmation || Boolean(relato && relato.timingConfirmation) || Boolean(relato && relato.reviewReasons && relato.reviewReasons.includes('time_before_dispatch'));
  const coberto = Math.round(atual.debit * 100) <= atual.availableCents;
  const insuficiente = !coberto && atual.debit > 0;
  const cedo = maximo === null ? 0 : Math.max(0, maximo - minutosPropostos);
  const precisaConferir = cedo > 0 || sobra > 0 || diferencaDeHorario || Boolean(c.correcaoPendente(item)) || (item.paymentProfile === 'Pré-paga' && insuficiente);
  return { precisaConferir, minutes: minutosPropostos, extra: sobra, early: cedo,
    error: c.correcaoPendente(item) && sobra > 0 ? undefined : atual.error || (((item.paymentProfile === 'Pré-paga' || sobra > 0) && insuficiente) ? 'O saldo confirmado não cobre os adicionais. Confira os pagamentos ou registre a decisão de não cobrar.' : undefined) };
}

/** `finishReviewBenefitLimit`. */
function limiteDeBeneficios(item, minutos = minutosDaConferencia(item)) {
  const limite = c.limiteDe(item);
  const pendente = c.correcaoPendente(item);
  const base = (pendente && pendente.beforeMinutes) ?? (limite.kind === 'maximum' ? limite.minutes : item.durationSeconds / 60);
  const usadoEm = (duracao) => b.usoDosBeneficios({ ...item, durationSeconds: Math.round(duracao * 60) }).reduce((s, x) => s + x.usedMinutes, 0);
  return Math.max(0, Math.floor(minutos - base - Math.max(0, usadoEm(minutos) - usadoEm(base))));
}

/** `finishReviewBenefitOptions`. */
function opcoesDeBeneficios(item, fin, em) {
  return b.beneficiosDisponiveis(item.clientId, fin.profile, fin.consultations, item.id, em)
    .filter((x) => x.sourceConsultationId !== item.id && !b.usaOrigemDeBonusLegado(item, x))
    .map((x) => ({ ...x, remaining: Math.max(0, x.remaining - (((item.minuteBenefits || []).find((v) => v.id === x.id) || {}).minutes || 0)) }))
    .filter((x) => x.remaining > 0);
}

/** `withFinishReviewBenefits`. `selecao`: `{ [idDoBeneficio]: minutos (texto) }`. */
function comBeneficiosDaConferencia(item, selecao, fin, ator, em, minutos = minutosDaConferencia(item)) {
  const escolhidos = Object.entries(selecao).filter(([, v]) => v !== '' && Number(v) !== 0);
  if (!escolhidos.length) return item;
  if (!c.aguardaConferencia(item)) erro('Este encerramento já foi conferido. Abra a consulta novamente.');
  const opcoes = opcoesDeBeneficios(item, fin, em);
  const adicionais = escolhidos.map(([id, valor]) => {
    const g = opcoes.find((x) => x.id === id); const n = Number(valor);
    if (!g || !Number.isSafeInteger(n) || n < 1 || n > g.remaining) erro('Os minutos de bônus ou cortesia mudaram. Confira a quantidade disponível.');
    const { used, reserved, remaining, ...beneficio } = g;
    return { ...beneficio, minutes: n, registeredBy: ator, registeredAt: em };
  });
  const somados = adicionais.reduce((s, x) => s + x.minutes, 0);
  if (somados > limiteDeBeneficios(item, minutos)) erro('Selecione benefícios somente para os minutos adicionais desta consulta.');
  const lista = (item.minuteBenefits || []).map((x) => ({ ...x }));
  for (const beneficio of adicionais) {
    const i = lista.findIndex((v) => v.id === beneficio.id);
    if (i < 0) lista.push(beneficio); else lista[i] = { ...lista[i], minutes: lista[i].minutes + beneficio.minutes };
  }
  const candidata = { ...item, minuteBenefits: lista, paidMinutesBeforeBenefits: Math.max(0, minutos - lista.reduce((s, x) => s + x.minutes, 0)),
    audit: [...item.audit, { id: `finish-benefits-${item.id}-${em}`, action: 'Dados corrigidos', actor: ator, createdAt: em, detail: `Cobertura dos minutos adicionais: ${adicionais.map((x) => `${x.minutes} min de ${x.kind.toLowerCase()} (${x.id})`).join('; ')}.` }] };
  vinculos.validarBeneficios({ ...candidata, status: 'Concluída', durationSeconds: Math.round(minutos * 60), updatedAt: em }, fin.consultations, fin.profile);
  return candidata;
}

module.exports = { minutosDaConferencia, inicioDoTarologo, avaliarConferencia, limiteDeBeneficios, opcoesDeBeneficios, comBeneficiosDaConferencia };
