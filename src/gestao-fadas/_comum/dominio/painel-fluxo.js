'use strict';

/**
 * Painel, o fluxo (domínio puro, Maturacao/39). Porte versionado de `painel/panel-flow-model.ts:98-190` (`panelFlow`) INTEIRO: equipe com
 * `freeNow`, filas ordenadas (`queue`, `actionableQueue`, `future`), `reservedAssignments`, `unansweredNext`, `recededReservations`,
 * `reservationFollowUps`, as listas da fila geral (`generalAll`, `waitingGeneral`, `callbackGeneral`, `futureGeneral`, `reservedGeneral`,
 * `general`), `free`, `dispatch` e `ready`. O relógio é `entrada.now`; nada de `Date.now()`. Comparações de texto: `colacao-ptbr.js`.
 * Entrada: `{ agenda, consultations, payments, profiles, accounts, overrides, date, now, intakeEvents, restrictions, selfId, selfStatus }`.
 */

const { contatoDe, encerrado, ativoNoDia } = require('./agenda-contato');
const b = require('./fila-geral-base');
const fg = require('./fila-geral');
const adm = require('./admissao');
const { consomeCobertura } = require('./financeiro-base');
const { estaRestrita } = require('./restricoes');
const c = require('./consulta-comum');
const t = require('./painel-tempo');
const k = require('./painel-continuacao');
const q = require('./painel-fila-geral');
const o = require('./painel-ordem');
const presenca = require('./painel-presenca');

const emCurso = (v) => v.status === 'Em curso' && !v.tarologistFinishReport;
const porId = (p, z) => q.idCmp(p.id, z.id);

function fluxoDoPainel(entrada, ignoradas = new Set()) {
  const { agenda, consultations, profiles, date, now } = entrada;
  const payments = entrada.payments || []; const contas = entrada.accounts || []; const excecoes = entrada.overrides || {}; const eventos = entrada.intakeEvents || [];
  const hoje = t.hojeDe(now); const em = new Date(now).toISOString(); const fin = { payments, consultations };
  const continuacoes = k.reservasDeContinuacao(entrada);
  const continuacaoDe = new Map(continuacoes.map((r) => [r.source.tarotId, r]));
  const entrou = (i) => t.entradaOriginal(i, date) ?? Infinity;
  const abertos = agenda.filter((item) => !encerrado(item) && !k.continuacaoArquivada(item, consultations) && item.workflowStatus !== 'Em consulta'
    && !consultations.some((v) => !ignoradas.has(v.id) && v.clientId === item.clientId && emCurso(v))
    && !b.consultasQueCasam(item, consultations, date).some((v) => !ignoradas.has(v.id) && !b.correspondenciaMantida(item, v)))
    .sort((p, z) => (entrou(p) - entrou(z)) || (p.position - z.position));
  const esperando = abertos.filter((item) => ativoNoDia(item, date, date));
  const geralTodos = abertos.filter((item) => item.tarotId === b.FILA_GERAL && (ativoNoDia(item, date, date) || b.temEstadoDeRetorno(item) || q.temporizacao(item, date, now).waitingWindow)).sort((p, z) => q.compararEspera(p, z, date, now));
  const devidos = esperando.filter((item) => (b.instantePedido(item, date) ?? 0) <= now);
  const candidatoDaFila = (item) => !b.turnoEncerrado(item, date, now) && !fg.liberacaoImediataFeita(item) && (!item.continuationRequest || (continuacaoDe.get(item.tarotId) && continuacaoDe.get(item.tarotId).item.id) === item.id)
    && !adm.emEncaixe(item, date) && !k.contatoParado(item) && !b.recessoComum(item) && !k.continuacaoSuspensa(item, consultations) && !k.avancoDeFilaPendente(item, consultations);
  const escopo = q.escopoDaData(date);
  const compararFilaDaLeitora = (p, z) => (Number(Boolean(b.recessoComum(p))) - Number(Boolean(b.recessoComum(z)))) || o.compararContinuacaoReservada(p, z, consultations) || q.compararOrdemExplicita(p, z, escopo) || q.compararOrdemCedida(p, z)
    || o.compararProntaPaga(p, z, fin, date, em) || o.compararPrioridadeDeContinuacao(p, z, consultations) || o.compararPagamentoPronto(p, z, fin, date, em)
    || (Number(Boolean(z.continuationRequest)) - Number(Boolean(p.continuationRequest))) || (Number(q.clientePodeResponder(z, date)) - Number(q.clientePodeResponder(p, date))) || (entrou(p) - entrou(z));
  const compararProprias = (p, z) => (Number(Boolean(b.recessoComum(p))) - Number(Boolean(b.recessoComum(z)))) || o.compararContinuacaoReservada(p, z, consultations) || q.compararOrdemExplicita(p, z, escopo) || q.compararOrdemCedida(p, z)
    || o.compararProntaPaga(p, z, fin, date, em) || o.compararPrioridadeDeContinuacao(p, z, consultations) || o.compararPagamentoPronto(p, z, fin, date, em) || o.compararFila(p, z, now, date, true);

  const equipe = presenca.equipeDePresenca(profiles, excecoes, contas, consultations, date, { hoje, ignoradas, retidas: new Set(continuacaoDe.keys()), proprioId: entrada.selfId, proprioEstado: entrada.selfStatus }).map((perfil) => {
    const relatos = consultations.filter((v) => v.tarotId === perfil.id && c.aguardaConferencia(v)).sort((p, z) => Date.parse(p.tarologistFinishReport.submittedAt) - Date.parse(z.tarologistFinishReport.submittedAt));
    const relato = relatos[0];
    const fila = devidos.filter((item) => item.tarotId === perfil.id).sort(compararFilaDaLeitora);
    const acionavel = fila.filter(candidatoDaFila);
    const naoIniciada = consultations.find((v) => !ignoradas.has(v.id) && v.tarotId === perfil.id && v.status === 'Em curso' && v.awaitingTarologistStart && !v.tarologistFinishReport);
    const futuro = esperando.filter((item) => item.tarotId === perfil.id && candidatoDaFila(item) && (b.instantePedido(item, date) ?? 0) > now).sort((p, z) => b.instantePedido(p, date) - b.instantePedido(z, date))[0];
    const temAgendamento = agenda.some((e) => e.tarotId === perfil.id && candidatoDaFila(e) && !encerrado(e) && ativoNoDia(e, date, date)
      && (!['after', 'shift'].includes((e.contactPlan && e.contactPlan.timing) ?? '') || b.planoPermiteContato(e, date, now))
      && (b.instantePedido(e, date) ?? 0) <= now + t.JANELA_DE_ESPERA_MS
      && !(e.workflowStatus === 'Em consulta' && consultations.some((v) => v.agendaItemId === e.id && v.clientId === e.clientId && v.tarotId === e.tarotId && consomeCobertura(v))));
    const admissao = adm.admissaoVigente(eventos, perfil.id, date, now);
    const original = profiles.find((i) => i.id === perfil.id);
    const aceitando = perfil.operationalActive && (!admissao || admissao.mode === 'open' || adm.retornoAberto(admissao, now)) && !adm.erroDeInicioPorPresenca(original, date);
    const precisaConfirmar = Boolean(original && original.online && original.status === 'Em consulta' && !relato && !consultations.some((v) => v.tarotId === perfil.id && v.status === 'Em curso'));
    const reserva = fg.reservas(geralTodos, perfil.id, date, consultations.filter((v) => !ignoradas.has(v.id)), now)[0];
    const livreAgora = !continuacaoDe.has(perfil.id) && perfil.available && !temAgendamento && !precisaConfirmar && !acionavel.length && !naoIniciada && aceitando;
    return { ...perfil, report: relato, reports: relatos, queue: fila, actionableQueue: acionavel, unstarted: naoIniciada, future: futuro, accepting: aceitando, needsConfirmation: precisaConfirmar, hasBooking: temAgendamento, reservation: reserva, freeNow: livreAgora };
  });

  const semConsultaEmCurso = (leitoraId) => !consultations.some((v) => !ignoradas.has(v.id) && v.tarotId === leitoraId && emCurso(v));
  const reservadas = equipe.flatMap((leitora) => {
    const continuacao = continuacaoDe.get(leitora.id);
    if (continuacao) return [{ reader: leitora, item: continuacao.item, pending: undefined, source: 'tarologists' }];
    const presencaDela = profiles.find((p) => p.id === leitora.id);
    if (presencaDela && (presencaDela.presenceConfirmation || !['available', 'pause'].includes(adm.escolhaDePresenca(presencaDela, date)))) {
      const geral = leitora.reservation && !q.temporizacao(leitora.reservation, date, now).future && !k.contatoParado(leitora.reservation) && !b.recessoComum(leitora.reservation) ? leitora.reservation : undefined;
      const propria = leitora.actionableQueue.find((i) => i.reservationClock && i.reservationClock.active && i.reservationClock.tarotId === leitora.id);
      const retida = geral ?? propria;
      if (retida && !leitora.unstarted && semConsultaEmCurso(leitora.id)) return [{ reader: leitora, item: retida, pending: undefined, source: geral ? 'general' : 'tarologists' }];
      return [];
    }
    if (!(leitora.available || leitora.status === 'Reservado') || leitora.needsConfirmation || leitora.unstarted || adm.erroDeInicioPorPresenca(presencaDela, date) || !semConsultaEmCurso(leitora.id)) return [];
    const geral = leitora.reservation && !q.temporizacao(leitora.reservation, date, now).future ? leitora.reservation : undefined;
    const propria = [...leitora.actionableQueue].sort(compararProprias)[0];
    const item = geral ?? propria; if (!item) return [];
    return [{ reader: leitora, item, pending: undefined, source: item === geral ? 'general' : 'tarologists' }];
  });

  const semResposta = reservadas.flatMap((a) => {
    const { reader, item: cabeca, source } = a;
    if (source !== 'tarologists' || cabeca.continuationRequest || !contatoDe(cabeca).tags.includes('Não respondeu') || !(reader.available || reader.status === 'Reservado') || reader.needsConfirmation || reader.unstarted || adm.erroDeInicioPorPresenca(profiles.find((p) => p.id === reader.id), date)) return [];
    const fila = [...reader.actionableQueue].sort(compararProprias);
    if (!fila[0] || fila[0].id !== cabeca.id) return [];
    const seguinte = fila.slice(1).find((i) => !i.continuationRequest && !i.queueReservation && !contatoDe(i).tags.includes('Não respondeu') && !estaRestrita(entrada.restrictions || [], i.clientId, reader.id)
      && !adm.erroDeInicio(adm.admissaoVigente(eventos, reader.id, date, now), i, { tarotId: reader.id, date, clientId: i.clientId }, now));
    const posicao = seguinte ? fila.findIndex((i) => i.id === seguinte.id) + 1 : undefined;
    const semResp = fila.filter((i) => contatoDe(i).tags.includes('Não respondeu'));
    return [{ readerId: reader.id, head: cabeca, following: seguinte, position: posicao, otherUnanswered: semResp.length - 1, unansweredAhead: seguinte ? fila.slice(0, posicao - 1).filter((i) => contatoDe(i).tags.includes('Não respondeu')).length : 0 }];
  });

  const recuadas = devidos.filter((i) => i.tarotId !== b.FILA_GERAL).flatMap((item) => {
    const recuo = b.recessoComum(item); const leitora = equipe.find((r) => r.id === ((item.queueReservation && item.queueReservation.tarotId) ?? item.tarotId));
    return recuo && leitora ? [{ reader: leitora, item, pending: undefined, source: item.tarotId === b.FILA_GERAL ? 'general' : 'tarologists', receded: recuo }] : [];
  });
  const mostradas = new Set([...reservadas.flatMap((r) => [r.item.id, ...(r.pending ? [r.pending.id] : [])]), ...recuadas.map((r) => r.item.id)]);
  const acompanhamentos = devidos.flatMap((item) => {
    if (mostradas.has(item.id) || item.tarotId === b.FILA_GERAL) return [];
    const leitora = equipe.find((r) => r.id === item.tarotId); if (!leitora) return [];
    if (item.continuationRequest) {
      const origem = consultations.find((r) => r.id === item.continuationRequest.sourceConsultationId);
      if (!origem || !k.continuacaoSuspensa(item, consultations) || b.filhaDaContinuacao(origem, consultations) || (origem.tarologistMoreTimeRequest && origem.tarologistMoreTimeRequest.archived)) return [];
    } else if (!contatoDe(item).tags.includes('Não pode agora')) return [];
    return [{ reader: leitora, item, pending: undefined, source: 'tarologists' }];
  });
  const geraisMostradas = new Set(reservadas.filter((r) => r.source === 'general').map((r) => r.item.id));
  const noGrupo = (g) => (item) => q.grupo(item, date, now) === g;
  const prontaEmFila = (x) => (x.available || x.status === 'Reservado') && (x.actionableQueue.length || x.unstarted);
  return {
    team: equipe, reservedAssignments: reservadas, unansweredNext: semResposta, recededReservations: recuadas, reservationFollowUps: acompanhamentos, generalAll: geralTodos, continuationReservations: continuacoes,
    waitingGeneral: geralTodos.filter((i) => !geraisMostradas.has(i.id) && noGrupo('waiting')(i)),
    callbackGeneral: geralTodos.filter(noGrupo('callback')).sort((p, z) => q.compararEsperaDoDepois(p, z, date, now)),
    futureGeneral: abertos.filter((i) => i.tarotId === b.FILA_GERAL && noGrupo('scheduled')(i)).sort((p, z) => q.compararEspera(p, z, date, now)),
    reservedGeneral: geralTodos.filter((i) => fg.reservaAtiva(i, date, now) && noGrupo('waiting')(i)),
    general: geralTodos.filter(noGrupo('waiting')), free: equipe.filter((i) => i.freeNow && !i.reservation), dispatch: equipe.filter((i) => i.freeNow || i.reservation),
    ready: equipe.filter(prontaEmFila).sort((p, z) => (Number(Boolean(z.report)) - Number(Boolean(p.report))) || ((t.entradaOriginal(p.actionableQueue[0] || {}, date) ?? now) - (t.entradaOriginal(z.actionableQueue[0] || {}, date) ?? now))),
  };
}

module.exports = { fluxoDoPainel, porId };
