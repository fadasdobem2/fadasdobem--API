'use strict';

/**
 * Domínio puro do início da consulta e do término informado, porte versionado de:
 *   - `tarologas/tarologist-consultation-session.ts` (`startTarologistConsultation`),
 *   - `consultas/staff-consultation-start.ts` (início pela equipe),
 *   - `tarologas/tarologist-finish-report.ts` (`reportTarologistFinish`, `reportStaffFinish`) e `tarologist-clock-entry.ts`.
 * Diferença deliberada (D9, Maturacao/28): o instante `agora` é SEMPRE o do servidor, e a análise de saldo
 * (`assessTarologistFinish` com contexto financeiro) ainda não existe aqui: sem pagamentos reais o excesso sobre o máximo nunca é
 * considerado coberto (`unfunded_extra`), o que manda o término à conferência em vez de aceitá-lo sem saldo.
 * A prova é o ouro gerado do código real do front (`scripts/gerar-ouro-gf-consulta.js`).
 */

const c = require('./consulta-comum');

const { erro } = c;

const diaSaoPaulo = (instante) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante));

/** `startTarologistConsultation` (tarologist-consultation-session.ts:38). `outras`: as demais consultas abertas (Postgres). */
function iniciar(item, tarotId, tarotNome, agora, outras = [item]) {
  const conflito = c.conflitosDeOcupacao(outras, tarotId, item.clientId, item.id, false, item.occupancyOverride)[0];
  if (conflito) erro(`Encerre a consulta de ${conflito.client} antes de iniciar outra.`);
  if (!tarotId || item.tarotId !== tarotId) erro('Esta consulta não pertence ao seu perfil.');
  if (item.status !== 'Em curso' || !item.awaitingTarologistStart || item.tarologistFinishReport) erro('Esta consulta não está aguardando início.');
  if (!Number.isFinite(Date.parse(agora)) || Date.parse(agora) < Date.parse(item.sentToTarologistAt || item.startedAt)) erro('Não foi possível registrar o horário de início.');
  return {
    ...c.fecharPausa(item, tarotNome, agora, 'started'),
    awaitingTarologistStart: false,
    sentToTarologistAt: item.sentToTarologistAt || item.startedAt,
    tarologistStartedAt: agora,
    startedAt: agora,
    durationSeconds: 0,
    updatedAt: agora,
    audit: [...item.audit, { id: `audit-${item.id}-tarot-start-${agora}`, action: 'Consulta iniciada pelo tarólogo', detail: 'O tarólogo iniciou a consulta; a contagem começou neste horário.', actor: tarotNome, createdAt: agora }],
  };
}

/** `prepareStaffConsultationStart` (staff-consultation-start.ts:11): o mesmo início, com o rótulo da equipe. */
function iniciarPelaEquipe(item, tarotId, atorNome, agora, outras) {
  const consulta = iniciar(item, tarotId, atorNome, agora, outras);
  const ultimo = consulta.audit.length - 1;
  return { ...consulta, audit: consulta.audit.map((e, i) => (i !== ultimo ? e : {
    ...e, id: `audit-${consulta.id}-staff-start-${e.createdAt}`, action: 'Consulta iniciada pela equipe',
    detail: 'A equipe registrou o início informado pelo tarólogo; a contagem começou neste horário.', actor: atorNome,
  })) };
}

const MOTIVOS_ANTECIPADO = Object.freeze({ client_connection: 'Conexão dela caiu.', client_absent: 'Ela sumiu.', client_satisfied: 'Ela disse que estava bom.' });
const descricaoAntecipado = (r) => [MOTIVOS_ANTECIPADO[r.reason], r.note].filter(Boolean).join(' ');

/** `clockEntryDuration` (tarologist-clock-entry.ts:14). */
function duracaoDoRelogio(entrada, consulta) {
  const valido = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!valido.test(entrada.startTime) || !valido.test(entrada.endTime)) return { error: 'Informe os horários de início e fim.' };
  const min = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
  const diferenca = min(entrada.endTime) - min(entrada.startTime);
  if (!entrada.nextDay && diferenca < 0) return { error: 'O fim está antes do início. Se a consulta atravessou a meia-noite, marque Terminou no dia seguinte.' };
  const minutos = diferenca + (entrada.nextDay ? 1440 : 0);
  if (minutos <= 0) return { error: 'O horário de fim deve ser diferente do início.' };
  if (minutos >= 1440) return { error: 'Os horários indicam 24 horas ou mais. Confira os horários e a opção de dia seguinte.' };
  if (!(consulta && consulta.pauseHistory && consulta.pauseHistory.length)) return { minutes: minutos };
  const inicio = Date.parse(`${diaSaoPaulo(consulta.tarologistStartedAt || consulta.startedAt)}T${entrada.startTime}:00-03:00`);
  const pausados = c.segundosPausadosEntre(consulta, inicio, inicio + minutos * 60000) / 60;
  const atendidos = Math.round((minutos - pausados) * 100) / 100;
  return atendidos > 0 ? { minutes: atendidos, pausedMinutes: pausados } : { error: 'Esse intervalo contém somente a pausa. Informe o tempo atendido.' };
}

/**
 * `assessTarologistFinish` (tarologist-finish-assessment.ts:10). Sem `financeiro` o excesso nunca é "coberto" (comportamento da fatia
 * Consulta); com `financeiro` (`{ payments, consultations, profile }`, fatia Pagamentos) a cobertura vem do saldo real (`financeiro-saldo.js`).
 */
function avaliarTermino(item, minutos, agora, financeiro) {
  const fim = Date.parse(agora); const inicio = Date.parse(item.tarologistStartedAt || item.startedAt); const enviada = Date.parse(item.sentToTarologistAt || item.startedAt);
  const decorridos = Math.max(0, (fim - inicio) / 60000 - c.segundosPausadosEntre(item, inicio, fim) / 60);
  const decorridosDesdeEnvio = Math.max(0, (fim - enviada) / 60000);
  const limite = c.limiteDe(item);
  const excede = limite.kind === 'maximum' && minutos > limite.minutes;
  const cobertura = financeiro ? require('./financeiro-saldo').coberturaDoExcesso(item, minutos, agora, financeiro) : null;
  const coberto = cobertura ? cobertura.extraCovered : false;
  return {
    elapsedMinutes: decorridos, sentElapsedMinutes: decorridosDesdeEnvio,
    needsTimingConfirmation: Number.isFinite(minutos) && minutos > Math.ceil(decorridos),
    beforeDispatch: Number.isFinite(minutos) && minutos > Math.ceil(decorridosDesdeEnvio),
    exceedsMaximum: excede,
    extraCovered: coberto,
    debit: cobertura ? cobertura.debit : require('./financeiro-cobranca').acerto({ ...item, status: 'Concluída', durationSeconds: Math.round(minutos * 60) }, undefined).debit,
    availableCents: cobertura ? cobertura.availableCents : 0, otherActive: cobertura ? cobertura.otherActive : false,
    error: excede && !coberto ? (cobertura && cobertura.otherActive ? 'Há outra consulta em curso desta cliente. Peça ao atendimento para conferir o saldo antes de acrescentar tempo.' : 'O saldo confirmado não cobre esse tempo adicional. Peça ao atendimento para registrar ou conferir o pagamento.') : undefined,
  };
}

const temPedidoDeMaisTempo = (it) => (it.tarologistMoreTimeRequest ? it.tarologistMoreTimeRequest.active : (it.tarologistFinishReport ? Boolean(it.tarologistFinishReport.clientWantsMoreTime) : false));

/** `reportTarologistFinish` (tarologist-finish-report.ts:79). `opcoes`: `{ timingConfirmed, timeEntry }`. */
function informarTermino(consulta, minutos, tarotId, tarotNome, agora, querMaisTempo = temPedidoDeMaisTempo(consulta), antecipado = undefined, opcoes = {}) {
  c.nome(tarotNome, 'Tarólogo');
  if (consulta.status !== 'Em curso' || consulta.tarologistFinishReport) erro('Esta consulta já foi encerrada. Informe o erro ao atendimento ou abra uma divergência.');
  if (consulta.awaitingTarologistStart) erro('Inicie a consulta antes de informar o tempo final.');
  if (!tarotId || consulta.tarotId !== tarotId) erro('Esta consulta não pertence ao seu perfil.');
  if (!Number.isFinite(minutos) || minutos <= 0) erro('Informe o tempo final em minutos.');
  const normalizado = Math.round(minutos * 100) / 100;
  if (normalizado <= 0) erro('Informe o tempo final em minutos.');
  let timeEntry;
  if (opcoes.timeEntry) {
    const d = duracaoDoRelogio(opcoes.timeEntry, consulta);
    if (d.error) erro(d.error);
    if (d.minutes !== normalizado) erro('Os horários não correspondem à duração informada. Confira o início e o fim.');
    timeEntry = { mode: 'clock', startTime: opcoes.timeEntry.startTime, endTime: opcoes.timeEntry.endTime, nextDay: opcoes.timeEntry.nextDay };
  }
  const limite = c.limiteDe(consulta);
  const av = avaliarTermino(consulta, minutos, agora, opcoes.finance);
  const limitado = av.exceedsMaximum && limite.kind === 'maximum';
  const aplicados = limitado ? limite.minutes : normalizado;
  if (av.needsTimingConfirmation && !opcoes.timingConfirmed) erro('Confirme o tempo informado: ele é maior que o intervalo desde o início marcado.');
  let earlyFinish;
  if (limite.kind === 'maximum' && normalizado < limite.minutes) {
    const motivo = antecipado && antecipado.reason;
    if (motivo && !MOTIVOS_ANTECIPADO[motivo]) erro('Selecione um motivo válido.');
    const nota = c.observacao((antecipado && antecipado.note) || '', 'Explicação');
    if (!motivo && !nota) erro('Selecione um motivo ou explique por que a consulta terminou antes do previsto.');
    earlyFinish = { reason: motivo, note: nota, maximumMinutes: limite.minutes };
    querMaisTempo = false; // regra confirmada pela Laya: encerramento antecipado encerra o pedido de continuação
  }
  const fimCalculado = Date.parse(consulta.pauseHistory && consulta.pauseHistory.length ? c.fimComPausas(consulta, normalizado * 60, agora)
    : new Date(Date.parse(consulta.startedAt) + normalizado * 60000).toISOString());
  if (!Number.isFinite(Date.parse(agora))) erro('Não foi possível registrar o término.');
  const endedAt = new Date(Math.min(fimCalculado, Date.parse(agora))).toISOString();
  const motivos = [];
  if (av.exceedsMaximum) motivos.push('extra_minutes');
  if (av.beforeDispatch || av.needsTimingConfirmation) motivos.push('time_before_dispatch');
  if (earlyFinish) motivos.push('early_finish');
  if (limitado && !av.extraCovered) motivos.push('unfunded_extra');
  const textoRevisao = motivos.length ? 'tempo em destaque para conferência do atendimento' : 'consulta encerrada pelo tarólogo';
  const detalhe = `${normalizado} minutos informados; ${textoRevisao}.`;
  const base = c.fecharPausa(consulta, tarotNome, agora);
  return {
    ...base,
    status: motivos.length ? 'Finalizada pelo tarólogo' : 'Concluída',
    endedAt, finishReview: undefined,
    durationSeconds: Math.round(aplicados * 60),
    performedDurationSeconds: Math.round(normalizado * 60),
    financialReview: limitado ? { authorizedMinutes: limite.minutes, reportedMinutes: normalizado, status: 'awaiting-contact', at: agora, by: tarotNome, note: 'Tempo adicional aguardando contato e decisão.', history: [] } : undefined,
    tarologistMoreTimeRequest: querMaisTempo
      ? { ...(consulta.tarologistMoreTimeRequest || { requestedAt: agora, reporterTarotId: tarotId, reporterName: tarotNome }), active: true }
      : consulta.tarologistMoreTimeRequest ? { ...consulta.tarologistMoreTimeRequest, active: false } : undefined,
    tarologistFinishReport: {
      minutes: normalizado, timeEntry,
      financialCap: limitado ? { minutes: aplicados, at: agora, reason: av.error || 'Tempo adicional ainda não autorizado pela cliente.' } : undefined,
      reviewReasons: motivos,
      timingConfirmation: av.needsTimingConfirmation ? { at: agora, clickedStartAt: consulta.tarologistStartedAt || consulta.startedAt, elapsedMinutes: av.elapsedMinutes, sentElapsedMinutes: av.sentElapsedMinutes } : undefined,
      clientWantsMoreTime: querMaisTempo, earlyFinish, endedAt, submittedAt: agora, reporterTarotId: tarotId, reporterName: tarotNome, reporterRole: 'tarologo',
    },
    updatedAt: agora,
    audit: [...consulta.audit, {
      id: `audit-${consulta.id}-tarot-end-${agora}`, action: 'Término informado pelo tarólogo',
      detail: `${detalhe}${timeEntry ? ` Horários informados: ${timeEntry.startTime} às ${timeEntry.endTime}${timeEntry.nextDay ? ' do dia seguinte' : ''}; início registrado preservado.` : ''}${limitado ? ` Mantidos ${aplicados} min para cobrança e comissão; adicional aguardando reconhecimento e conferência do pagamento.` : ''}${av.needsTimingConfirmation ? ` Confirmou ${normalizado} min após ${Math.floor(av.elapsedMinutes)} min desde o início marcado; horários originais preservados.` : ''}${earlyFinish ? ` Tempo menor que o máximo de ${earlyFinish.maximumMinutes} minutos. ${descricaoAntecipado(earlyFinish)}` : ''}${querMaisTempo ? ' Cliente quer mais tempo; atendimento deve falar com a cliente pelo WhatsApp.' : temPedidoDeMaisTempo(consulta) ? ' Pedido de mais tempo retirado pelo tarólogo.' : ''}`,
      actor: tarotNome, createdAt: agora,
    }],
  };
}

/** `reportStaffFinish` (tarologist-finish-report.ts:169): a equipe encerra a operação, com o mesmo relato. */
function informarTerminoPelaEquipe(item, minutos, ator, em, financeiro) {
  const proximo = informarTermino({ ...item, awaitingTarologistStart: false }, minutos, item.tarotId, ator, em, false, undefined, { timingConfirmed: true, finance: financeiro });
  return { ...proximo, tarologistFinishReport: { ...proximo.tarologistFinishReport, reporterRole: 'atendimento' },
    audit: proximo.audit.map((e) => (e.id === `audit-${item.id}-tarot-end-${em}` ? { ...e, action: 'Encerramento conferido', detail: `Atendimento encerrou a operação: ${minutos} min informados. Adicionais aguardam contato e decisão; profissional liberada.` } : e)) };
}

/** `requestTarologistMoreTime` (tarologist-finish-report.ts:58). */
function pedirMaisTempo(consulta, tarotId, tarotNome, agora) {
  c.nome(tarotNome, 'Tarólogo');
  if (!tarotId || consulta.tarotId !== tarotId) erro('Esta consulta não pertence ao seu perfil.');
  if (consulta.status !== 'Em curso' && !c.aguardaConferencia(consulta)) erro('Esta consulta já foi encerrada pelo atendimento.');
  if (consulta.awaitingTarologistStart) erro('Inicie a consulta antes de pedir mais tempo.');
  if (temPedidoDeMaisTempo(consulta)) return consulta;
  return { ...consulta,
    tarologistMoreTimeRequest: { active: true, requestedAt: agora, reporterTarotId: tarotId, reporterName: tarotNome },
    tarologistFinishReport: consulta.tarologistFinishReport ? { ...consulta.tarologistFinishReport, clientWantsMoreTime: true } : undefined,
    updatedAt: agora,
    audit: [...consulta.audit, { id: `audit-${consulta.id}-more-time-${agora}`, action: 'Pedido de mais tempo', detail: 'Cliente pediu mais tempo. Atendimento avisado; tempo da consulta preservado.', actor: tarotNome, createdAt: agora }] };
}

const MOTIVOS_DEVOLUCAO = Object.freeze(['Outros', 'Não bateu', 'Problema de equipamento', 'Prefiro não atender']);

/**
 * `cancelTarologistConsultation` (tarologas/tarologist-cancellation.ts:14), só a parte da consulta: a taróloga devolve a PRÓPRIA
 * consulta, que vira "Devolvida" (sem repasse, cobertura liberada). A cobrança (`billingForConsultationFinish`) e a liberação de
 * pagamentos dependem de valores que ainda não são reais aqui e ficam como estavam. `segundos` é o tempo do SERVIDOR.
 */
function devolverPelaTarologa(item, entrada, tarotId, tarotNome, agora, segundos = item.durationSeconds) {
  c.nome(tarotNome, 'Tarólogo');
  if (typeof entrada.reason !== 'string' || !MOTIVOS_DEVOLUCAO.includes(entrada.reason)) erro('Motivo: selecione uma opção válida.');
  const nota = c.observacao(entrada.note, 'Descrição', false);
  if (!tarotId || item.tarotId !== tarotId) erro('Esta consulta não pertence ao seu perfil.');
  if (item.status !== 'Em curso') erro('Esta consulta já foi encerrada. Atualize a página.');
  if (!Number.isFinite(Date.parse(agora)) || Date.parse(agora) < Date.parse(item.startedAt)) erro('Não foi possível registrar o horário da devolução.');
  const seg = item.awaitingTarologistStart ? 0 : Math.max(0, Math.floor(segundos));
  if (!Number.isFinite(seg)) erro('O tempo da consulta precisa ser conferido pelo atendimento.');
  const detalhe = `Devolvida pelo tarólogo: ${entrada.reason}.${nota ? ` ${nota}` : ''} Devolvida ao atendimento; sem repasse, com a cobertura liberada. Tempo registrado: ${Math.ceil(seg / 60)} min.${temPedidoDeMaisTempo(item) ? ' Pedido de mais tempo retirado pela devolução.' : ''}`;
  return { ...c.limparPedidoDeMaisTempo(item), status: 'Devolvida', awaitingTarologistStart: false, endedAt: agora, durationSeconds: seg, updatedAt: agora,
    tarologistCancellation: { reason: entrada.reason, note: nota, at: agora, reporterTarotId: tarotId, reporterName: tarotNome },
    observation: [item.observation, detalhe].filter(Boolean).join('\n'),
    audit: [...item.audit, { id: `audit-${item.id}-tarot-return-${agora}`, action: 'Consulta devolvida', detail: detalhe, actor: tarotNome, createdAt: agora }] };
}

/** `requestFinishCorrection` (tarologist-finish-report.ts:174): a taróloga pede UMA correção do tempo informado (a equipe confere). */
function pedirCorrecao(item, minutos, motivo, tarotId, ator, em) {
  c.nome(ator, 'Tarólogo');
  const podeCorrigir = Boolean(item.tarologistFinishReport) && (item.status === 'Concluída' || item.status === 'Finalizada pelo tarólogo');
  if (item.tarotId !== tarotId || !podeCorrigir) erro('Esta consulta não está disponível para correção no seu perfil.');
  const normalizado = Math.round(minutos * 100) / 100;
  if (!Number.isFinite(normalizado) || normalizado <= 0) erro('Informe o tempo correto em minutos.');
  const nota = c.observacao(motivo, 'Motivo da correção', true);
  const antes = c.minutosRelatados(item);
  if (normalizado === antes) erro('O tempo informado é igual ao tempo já registrado.');
  const historico = (item.finishCorrections || []).map((r) => (r.status === 'pending' ? { ...r, status: 'superseded' } : r));
  return { ...item, updatedAt: em,
    finishCorrections: [...historico, { id: `correction-${item.id}-${em}`, beforeMinutes: antes, minutes: normalizado, reason: nota, requestedAt: em, requestedBy: ator, reporterTarotId: tarotId, status: 'pending' }],
    audit: [...item.audit, { id: `request-correction-${item.id}-${em}`, action: 'Término informado pelo tarólogo', actor: ator, createdAt: em, detail: `Correção solicitada: ${antes} → ${normalizado} min. Motivo: ${nota}. O tempo anterior permanece até a conferência.` }] };
}

module.exports = { devolverPelaTarologa, pedirCorrecao, MOTIVOS_DEVOLUCAO, iniciar, iniciarPelaEquipe, informarTermino, informarTerminoPelaEquipe, pedirMaisTempo, duracaoDoRelogio, avaliarTermino, temPedidoDeMaisTempo, MOTIVOS_ANTECIPADO };
