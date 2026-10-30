'use strict';

/**
 * Painel, ordem das filas (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front: `agenda/queue-timing.ts` (`agendaTiming` :91,
 * `agendaQueueGroup` :103, `compareAgendaQueue` :88, `agendaIsCarried`), `agenda/agenda-contact.ts` (`agendaQueueEligible` :227),
 * `agenda/agenda-order.ts` (`reorderAgendaItems`), `agenda/agenda-readiness.ts` (`agendaReadyToReceive`, `agendaReadyPaid`, `comparePaidReadyPriority`,
 * `compareReadyPayment`) e `agenda/continuation-priority.ts` (`compareReservedContinuation`, `compareContinuationPriority`). Relógio injetado.
 * Desempates por `localeCompare` do front: `colacao-ptbr.js` (ids, texto de máquina).
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const b = require('./fila-geral-base');
const q = require('./painel-fila-geral');
const t = require('./painel-tempo');
const k = require('./painel-continuacao');
const pagamento = require('./painel-lancamento');
const { compararPtBR } = require('./colacao-ptbr');

const RESPOSTAS = ['Não respondeu', 'Vai pagar', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Não voltou'];
const DESFECHOS = ['Concluída', 'Adiada', 'Cancelada'];
const pendente = (item) => !encerrado(item) && !['Concluída', 'Em consulta'].includes(item.workflowStatus || '');

/** `agendaQueueEligible`. */
function elegivelNaFila(item, data) {
  const contato = contatoDe(item);
  const ultimo = [...(item.contactHistory || [])].reverse().find((e) => e.attempt === contato.attempt && e.active && (e.tag === 'Avisada' || e.tag === 'Pago'));
  const avisoValido = contato.tags.includes('Avisada') && (ultimo && ultimo.tag) !== 'Pago';
  return !encerrado(item) && contato.date === data && (avisoValido || contato.tags.includes('Pode agora')) && !contato.tags.some((x) => [...RESPOSTAS, 'Próximo turno', 'Em consulta', ...DESFECHOS].includes(x));
}
/** `agendaRequestedAt`. */
const pedidoEm = (item, data) => b.horarioPedido(item, data);
/** `agendaTiming` (relógio civil = real, sem demonstração). */
function tempoDaAgenda(item, agora, data) {
  const em = pedidoEm(item, data); const hoje = t.hojeDe(agora); const mesmoDia = (item.date || data) === hoje;
  const disponivel = pendente(item) && elegivelNaFila(item, hoje); const futuro = em !== null && em > agora;
  const logo = Boolean(pendente(item) && item.workflowStatus !== 'Não pode' && mesmoDia && futuro && em - agora <= 30 * 60000);
  const vencido = Boolean(em !== null && mesmoDia && em <= agora && pendente(item) && item.workflowStatus !== 'Não pode');
  return { at: em, soon: logo, due: vencido, future: futuro, ready: disponivel && !futuro, priority: vencido && disponivel };
}
/** `agendaQueueGroup`. */
function grupoDaFila(item, agora, data) {
  if (encerrado(item)) return 6;
  if (item.workflowStatus === 'Em consulta') return -1;
  if (!pendente(item)) return 6;
  const x = tempoDaAgenda(item, agora, data);
  return x.priority ? 0 : x.due ? 4 : x.future ? 3 : 1;
}
const estaAtrasada = (item, data) => !encerrado(item) && (item.date || data) < data;
const idCmp = q.idCmp;

/** `compareAgendaQueue`. */
function compararFila(p, z, agora, dataRef, combinarDatas = false, escopo = q.escopoDaData(dataRef)) {
  const manual = q.compararOrdemExplicita(p, z, escopo); if (manual) return manual;
  const continuacao = Number(Boolean(z.continuationRequest) && !encerrado(z) && z.workflowStatus !== 'Em consulta') - Number(Boolean(p.continuationRequest) && !encerrado(p) && p.workflowStatus !== 'Em consulta');
  if (continuacao) return continuacao;
  const cedida = q.compararOrdemCedida(p, z); if (cedida) return cedida;
  const ep = (p.positionOverrides || {})[`explicit:${escopo}`]; const ez = (z.positionOverrides || {})[`explicit:${escopo}`];
  if (ep !== undefined || ez !== undefined) return ((ep ?? Infinity) - (ez ?? Infinity)) || idCmp(p.id, z.id);
  if (combinarDatas && escopo === q.escopoDaData(dataRef)) { const origem = Number(estaAtrasada(z, dataRef)) - Number(estaAtrasada(p, dataRef)); if (origem) return origem; }
  const rp = (p.positionOverrides || {})[escopo]; const rz = (z.positionOverrides || {})[escopo];
  if (rp !== undefined || rz !== undefined) return ((rp ?? Infinity) - (rz ?? Infinity)) || idCmp(p.id, z.id);
  const data = compararPtBR(p.date || dataRef, z.date || dataRef); if (data && !combinarDatas) return data;
  const grupo = grupoDaFila(p, agora, dataRef) - grupoDaFila(z, agora, dataRef); if (grupo) return grupo;
  const tp = tempoDaAgenda(p, agora, dataRef); const tz = tempoDaAgenda(z, agora, dataRef); const g = grupoDaFila(p, agora, dataRef);
  return ((g === 0 || g === 3) ? (tp.at || 0) - (tz.at || 0) : 0) || (combinarDatas ? 0 : data) || (p.position - z.position) || idCmp(p.id, z.id);
}

/** `reorderAgendaItems`. */
function reordenar(itens, ids, escopo, entreDatas = false) {
  const posicoes = new Map(ids.map((id, i) => [id, i + 1]));
  const escopoExplicito = `explicit:${escopo}`;
  const explicito = entreDatas || itens.some((i) => posicoes.has(i.id) && (i.positionOverrides || {})[escopoExplicito] !== undefined);
  const canonicas = new Map();
  const tarologos = new Set(ids.flatMap((id) => { const i = itens.find((r) => r.id === id); return i && !encerrado(i) ? [i.tarotId] : []; }));
  for (const tarotId of tarologos) {
    const chave = q.escopoManual(tarotId); const ordenados = ids.filter((id) => itens.some((i) => i.id === id && i.tarotId === tarotId && !encerrado(i)));
    if (!ordenados.length || !(entreDatas || itens.some((i) => ordenados.includes(i.id) && (i.positionOverrides || {})[chave] !== undefined))) continue;
    const todos = itens.filter((i) => i.tarotId === tarotId && !encerrado(i)).sort((p, z) => {
      const rp = (p.positionOverrides || {})[chave] ?? (p.positionOverrides || {})[escopoExplicito]; const rz = (z.positionOverrides || {})[chave] ?? (z.positionOverrides || {})[escopoExplicito];
      return ((rp ?? Infinity) - (rz ?? Infinity)) || ((t.entradaOriginal(p, p.date || '') ?? Infinity) - (t.entradaOriginal(z, z.date || '') ?? Infinity)) || (p.position - z.position) || idCmp(p.id, z.id);
    });
    const movendo = new Set(ordenados); let indice = 0;
    todos.map((i) => (movendo.has(i.id) ? ordenados[indice++] : i.id)).forEach((id, pos) => canonicas.set(id, { key: chave, position: pos + 1 }));
  }
  return itens.map((i) => {
    const c = canonicas.get(i.id);
    if (!posicoes.has(i.id) && !c) return i;
    return { ...i, positionOverrides: { ...i.positionOverrides, ...(posicoes.has(i.id) ? { [escopo]: posicoes.get(i.id), ...(explicito ? { [escopoExplicito]: posicoes.get(i.id) } : {}) } : {}), ...(c ? { [c.key]: c.position } : {}) } };
  });
}

/** `agendaReadyToReceive`. */
function prontaParaReceber(item, data) {
  const c = contatoDe(item);
  return !encerrado(item) && item.workflowStatus !== 'Em consulta' && c.date === data && c.tags.includes('Pode agora') && !c.tags.some((x) => ['Não respondeu', 'Não voltou', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Próximo turno'].includes(x));
}
/** `agendaReadyPaid`: `entrada` = `{ payments, consultations }`; `em` ISO. */
function prontaEPaga(item, entrada, data, em) {
  if (!prontaParaReceber(item, data)) return false;
  if (item.continuationRequest) { const o = pagamento.ofertaDeContinuacao(item, entrada.consultations, entrada.payments, em); return Boolean(o && o.funded); }
  return pagamento.estadoDePagamento(item, entrada.payments, entrada.consultations).tone === 'paid';
}
/** `comparePaidReadyPriority`. */
function compararProntaPaga(p, z, entrada, data, em) {
  const ocupada = p.tarotId === z.tarotId && entrada.consultations.some((i) => i.tarotId === p.tarotId && i.status === 'Em curso' && !i.tarologistFinishReport);
  if (ocupada) {
    const voltou = (item) => { const c = contatoDe(item); return Boolean(item.continuationRequest) && !encerrado(item) && item.workflowStatus !== 'Em consulta' && c.date === data && c.tags.includes('Pode agora')
      && !c.tags.some((x) => ['Não respondeu', 'Não voltou', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Próximo turno'].includes(x)) && !(pagamento.ofertaDeContinuacao(item, entrada.consultations, entrada.payments, em) || {}).paused; };
    const prioridade = Number(voltou(z)) - Number(voltou(p)); if (prioridade) return prioridade;
  }
  return Number(prontaEPaga(z, entrada, data, em)) - Number(prontaEPaga(p, entrada, data, em));
}
/** `compareReadyPayment`. */
function compararPagamentoPronto(p, z, entrada, data, em) {
  const prioridade = compararProntaPaga(p, z, entrada, data, em); if (prioridade) return prioridade;
  const rp = prontaEPaga(p, entrada, data, em); const rz = prontaEPaga(z, entrada, data, em); const rank = Number(rz) - Number(rp);
  if (rank || !rp || !rz) return rank;
  const tp = Date.parse(pagamento.estadoDePagamento(p, entrada.payments, entrada.consultations).paidAt || ''); const tz = Date.parse(pagamento.estadoDePagamento(z, entrada.payments, entrada.consultations).paidAt || '');
  if (Number.isFinite(tp) && Number.isFinite(tz)) return tp - tz;
  return Number(!Number.isFinite(tp)) - Number(!Number.isFinite(tz));
}
/** `compareReservedContinuation`. */
function compararContinuacaoReservada(p, z, consultas) {
  if (p.tarotId !== z.tarotId) return 0;
  const reserva = b.conflitoDeContinuacao(consultas, p.tarotId); if (!reserva) return 0;
  const reservada = (i) => !encerrado(i) && i.workflowStatus !== 'Em consulta' && (i.continuationRequest && i.continuationRequest.sourceConsultationId) === reserva.id;
  return Number(reservada(z)) - Number(reservada(p));
}
/** `compareContinuationPriority`. */
function compararPrioridadeDeContinuacao(p, z, consultas) {
  if (p.tarotId !== z.tarotId) return 0;
  const posto = (item) => {
    if (!item.continuationRequest || encerrado(item) || item.workflowStatus === 'Em consulta') return 1;
    const origem = consultas.find((r) => r.id === item.continuationRequest.sourceConsultationId && r.clientId === item.clientId && r.tarotId === item.tarotId);
    if (!origem || b.filhaDaContinuacao(origem, consultas)) return 1;
    return k.continuacaoArquivada(item, consultas) || k.continuacaoSuspensa(item, consultas) ? 2 : 0;
  };
  return posto(p) - posto(z);
}

module.exports = { elegivelNaFila, tempoDaAgenda, grupoDaFila, compararFila, reordenar, prontaParaReceber, prontaEPaga, compararProntaPaga, compararPagamentoPronto, compararContinuacaoReservada, compararPrioridadeDeContinuacao, estaAtrasada, compararPtBR };
