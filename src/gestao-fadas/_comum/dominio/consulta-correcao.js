'use strict';

/**
 * Consulta, CORREÇÃO DE TEMPO no servidor (Maturacao/35). Porte de `consultas/consultation-time-correction.ts` (`correctConsultationTime`,
 * `validateTimeCorrectionCoverage`), `consultas/consultation-financial-review.ts` (`consultationFinancialReview`) e
 * `domain/consultation-billing.ts` (`validatedConsultationDuration`). O servidor REFAZ o registro da correção a partir do registro guardado e
 * confere que o do navegador é igual; o saldo é o do banco (pagamentos, benefícios e partida do legado), não o que o navegador enviou.
 * Bônus e complemento (`validateMinuteBenefits`, `validateComplementChanges`) em `consulta-vinculos.js`.
 * O ouro (`scripts/gerar-ouro-gf-consulta-correcao.js`) roda as funções reais do front.
 */

const c = require('./consulta-comum');
const { acerto } = require('./financeiro-cobranca');
const { tarifaDeCredito } = require('./financeiro-saldo');
const vinculos = require('./consulta-vinculos');

const { RegraConsultaError } = c;
const erro = (m) => { throw new RegraConsultaError(m); };

/** `validatedConsultationDuration`. */
function duracaoValidada(inicio, minutos) {
  const segundos = Math.round(minutos * 60);
  const fim = new Date(new Date(inicio).getTime() + segundos * 1000);
  if (!Number.isFinite(minutos) || !Number.isSafeInteger(segundos) || segundos < 1 || !Number.isFinite(fim.getTime())) erro('Informe um tempo válido em minutos.');
  return { durationSeconds: segundos };
}

/** `consultationFinancialReview`. */
function revisaoFinanceira(item) {
  if (item.financialReview) return item.financialReview;
  const limite = c.limiteDe(item); const r = item.tarologistFinishReport;
  if (item.status !== 'Finalizada pelo tarólogo' || item.finishReview || !r || !Number.isFinite(r.minutes) || limite.kind !== 'maximum' || r.minutes <= limite.minutes) return undefined;
  return { authorizedMinutes: limite.minutes, reportedMinutes: r.minutes, status: 'awaiting-contact', at: r.submittedAt, by: r.reporterName, note: 'Tempo adicional aguardando contato e decisão.', history: [] };
}

/** Parte do saldo de `validateTimeCorrectionCoverage`. `fin`: `{ payments, consultations, profile }` reais; `undefined` = sem as fontes (não confere). */
function conferirCobertura(antes, depois, fin, em) {
  if (!fin) return;
  try { vinculos.validarBeneficios(depois, fin.consultations, fin.profile); vinculos.validarComplemento(depois, fin.consultations, fin.payments); } catch (e) { erro(e instanceof Error ? e.message : 'Confira os vínculos da consulta.'); }
  if (depois.paymentProfile !== 'Pré-paga' || (depois.launchTimeDecision && depois.launchTimeDecision.kind === 'later')) return;
  const antesDebito = Math.round(acerto(antes, fin.payments).debit * 100);
  const debito = Math.round(acerto(depois, fin.payments).debit * 100);
  if (depois.durationSeconds <= antes.durationSeconds && debito <= antesDebito) return;
  if (debito <= 0) return;
  const disponivel = tarifaDeCredito(depois.clientId, em, undefined, fin.consultations, fin.payments, fin.profile, antes.id, true).availableLots.reduce((s, l) => s + l.cents, 0);
  if (debito > antesDebito && fin.consultations.some((k) => k.id !== antes.id && k.clientId === depois.clientId && k.status === 'Em curso' && !k.tarologistFinishReport)) erro('Há outra consulta em curso desta cliente. Confira o saldo antes de aumentar o tempo.');
  if (debito > disponivel) erro('O saldo confirmado não cobre o tempo corrigido. Confira ou registre o pagamento antes de aumentar os minutos.');
}

/** `correctConsultationTime`. `versao`: o `updatedAt` que o pedido enviou como `expectedVersion`. */
function corrigirTempo(item, minutos, motivo, ator, em, versao, fin) {
  if (item.updatedAt !== versao) erro('A consulta foi atualizada. Abra a divergência novamente antes de corrigir.');
  if (!['Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Desistiu'].includes(item.status)) erro('Confira a situação da consulta antes de corrigir o tempo.');
  c.nome(ator, 'Responsável');
  const nota = c.observacao(motivo, 'Motivo da correção', true);
  if (!Number.isFinite(minutos) || minutos <= 0) erro('Informe o tempo correto em minutos.');
  const normalizado = Math.round(minutos * 100) / 100;
  const duracao = duracaoValidada(item.startedAt, normalizado);
  const anterior = c.minutosRelatados(item);
  const proximo = { ...item, durationSeconds: duracao.durationSeconds, performedDurationSeconds: duracao.durationSeconds, financialReview: undefined, updatedAt: em, readerCorrection: { at: em, reason: nota },
    audit: [...item.audit, { id: `time-${item.id}-${em}`, action: 'Dados corrigidos', detail: `Tempo corrigido de ${anterior} para ${normalizado} minutos. ${nota}`, actor: ator, createdAt: em }] };
  const financeira = revisaoFinanceira(item); const limite = c.limiteDe(item);
  const autorizado = financeira && financeira.status === 'approved' ? financeira.reportedMinutes : (financeira ? financeira.authorizedMinutes : undefined) ?? (limite.kind === 'maximum' ? limite.minutes : undefined);
  if (autorizado !== undefined && normalizado > autorizado) {
    const preserva = financeira && financeira.status === 'not-charged' && normalizado <= financeira.reportedMinutes;
    const situacao = preserva ? 'not-charged' : 'awaiting-contact';
    proximo.durationSeconds = Math.round(autorizado * 60);
    proximo.status = preserva ? 'Concluída' : 'Finalizada pelo tarólogo';
    proximo.finishReview = preserva ? item.finishReview : undefined;
    proximo.financialReview = { authorizedMinutes: autorizado, reportedMinutes: normalizado, status: situacao, at: em, by: ator, note: `Tempo realizado corrigido. ${nota}`,
      history: [...((financeira && financeira.history) || []), { id: `finance-correction-${item.id}-${em}`, status: situacao, at: em, by: ator, note: `Tempo realizado corrigido de ${anterior} para ${normalizado} minutos. ${nota}` }] };
    if (item.tarologistFinishReport) proximo.tarologistFinishReport = { ...item.tarologistFinishReport, minutes: normalizado };
    else proximo.tarologistFinishReport = { minutes: normalizado, endedAt: item.endedAt || em, submittedAt: em, reporterTarotId: item.tarotId, reporterName: ator, reporterRole: 'atendimento', financialCap: { minutes: autorizado, at: em, reason: 'Tempo adicional aguardando reconhecimento e decisão.' }, reviewReasons: ['extra_minutes'] };
    proximo.finishCorrections = item.finishCorrections && item.finishCorrections.map((r) => (r.status === 'pending' ? { ...r, status: 'approved', appliedMinutes: normalizado, reviewedAt: em, reviewedBy: ator, reviewReason: nota } : r));
    conferirCobertura(item, proximo, fin, em);
    return proximo;
  }
  if (financeira && financeira.status === 'approved') proximo.financialReview = { ...financeira, reportedMinutes: normalizado, at: em, by: ator, note: `Tempo realizado corrigido. ${nota}`, history: [...financeira.history, { id: `finance-correction-${item.id}-${em}`, status: 'approved', at: em, by: ator, note: `Tempo realizado corrigido de ${anterior} para ${normalizado} minutos, dentro do tempo já aprovado. ${nota}` }] };
  conferirCobertura(item, proximo, fin, em);
  if (item.tarologistFinishReport) {
    if (item.status === 'Finalizada pelo tarólogo') proximo.status = 'Concluída';
    proximo.finishReview = { at: em, by: ator, reportSubmittedAt: item.tarologistFinishReport.submittedAt, reportedMinutes: item.tarologistFinishReport.minutes, result: 'corrected', reason: nota };
    proximo.finishCorrections = item.finishCorrections && item.finishCorrections.map((r) => (r.status === 'pending' ? { ...r, status: 'approved', appliedMinutes: normalizado, reviewedAt: em, reviewedBy: ator, reviewReason: nota } : r));
  }
  return proximo;
}

/** Os dados do pedido que bastam para refazer a correção: minutos, motivo, autor e instante, lidos do evento novo do histórico. */
function lerPedidoDeCorrecao(antes, pedido) {
  const evento = pedido.audit.slice(antes.audit.length).find((e) => e.action === 'Dados corrigidos' && typeof e.detail === 'string' && /^Tempo corrigido de .+ para [\d.]+ minutos\./.test(e.detail));
  if (!evento || !pedido.readerCorrection) return null;
  const minutos = Number(/ para ([\d.]+) minutos\./.exec(evento.detail)[1]);
  return { minutos, motivo: pedido.readerCorrection.reason, ator: evento.actor, em: pedido.readerCorrection.at };
}

module.exports = { corrigirTempo, conferirCobertura, revisaoFinanceira, duracaoValidada, lerPedidoDeCorrecao };
