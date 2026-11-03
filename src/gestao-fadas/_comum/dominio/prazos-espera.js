'use strict';

/**
 * Prazos de atendimento, espera de contato e de pagamento (domínio puro, Maturacao/56 grupo D). Porte versionado do CÓDIGO do front:
 * `agenda/agenda-common-deadlines.ts` (`commonAgendaWait`), `agenda/agenda-requested-wait.ts` (`requestedWaitHistory`, `activeRequestedWait`,
 * `agendaWaitHasReceipt`, `agendaWaitReceiptState`, `requestedWaitTiming`), `consultas/more-time-agenda.ts` (`moreTimeProcessHistory`,
 * `moreTimeContactKnown`, `moreTimeAgendaWait`) e `domain/formatters.ts` (`formatElapsed`).
 * Limiares (só visuais, nunca encerram nada): atenção aos 5 min, expirada aos 10 min. O relógio é SEMPRE `now` (ms), injetado; nada de Date.now/Intl.
 * Entrada de `commonAgendaWait`: `{ agenda, consultations, payments, pricing, date, now }`.
 */

const { contatoDe, encerrado, ativoNoDia } = require('./agenda-contato');
const b = require('./fila-geral-base');
const k = require('./painel-continuacao');
const s = require('./financeiro-saldo');
const pg = require('./painel-pagamentos');
const lanc = require('./painel-lancamento');
const { consomeCobertura } = require('./financeiro-base');

const MINUTO_MS = 60_000;
/** `5*60_000` e `10*60_000` do front (`MORE_TIME_ATTENTION_MS`, `MORE_TIME_EXPIRE_MS`). */
const ATENCAO_MS = 5 * MINUTO_MS;
const EXPIRA_MS = 10 * MINUTO_MS;
const evento = (e) => Date.parse(e.at);
const ultimo = (lista, f) => { for (let i = lista.length - 1; i >= 0; i -= 1) if (f(lista[i])) return lista[i]; return undefined; };
const ultimoIndice = (lista, f) => { for (let i = lista.length - 1; i >= 0; i -= 1) if (f(lista[i])) return i; return -1; };

/** `formatElapsed`: `m:ss` ou `h:mm:ss`. */
function tempoDecorrido(segundos) {
  const h = Math.floor(segundos / 3600); const m = Math.floor((segundos % 3600) / 60); const sg = segundos % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sg).padStart(2, '0')}` : `${m}:${String(sg).padStart(2, '0')}`;
}

/** `requestedWaitHistory`. */
function historicoDeEspera(item) {
  if (item.requestedWaitHistory && item.requestedWaitHistory.length) return item.requestedWaitHistory;
  const antes = item.queuePaymentWait; const em = antes && (antes.requestedAt ?? antes.at);
  return antes && antes.requestedMinutes && em && Number.isFinite(Date.parse(em)) ? [{ id: `legacy-${item.id}-${em}`, minutes: antes.requestedMinutes, at: em, by: antes.editedBy || antes.by }] : [];
}

function reciboDaEspera(item, reg, inicio, now, p) {
  if (p.clientId !== item.clientId || p.status === 'Cancelado' || pg.valorDaConsulta(p) <= 0) return false;
  const em = Date.parse(p.informedAt);
  if (!Number.isFinite(em) || em < inicio || em > now) return false;
  if (p.linkedConsultationId) return reg.consultations.some((v) => v.id === p.linkedConsultationId && v.agendaItemId === item.id);
  if (reg.consultations.some((v) => consomeCobertura(v) && v.billing && v.billing.funding && v.billing.funding.some((l) => l.paymentId === p.id))) return false;
  return reg.agenda.filter((r) => r.clientId === item.clientId && !encerrado(r)).length === 1;
}
/** `agendaWaitHasReceipt`. */
const esperaTemRecibo = (item, reg, inicio, now) => reg.payments.some((p) => reciboDaEspera(item, reg, inicio, now, p));
/** `agendaWaitReceiptState`. */
function estadoDoReciboDaEspera(item, reg, inicio, now, perfil) {
  const recibos = reg.payments.filter((p) => reciboDaEspera(item, reg, inicio, now, p));
  const pendente = recibos.some((p) => !s.recebimentoConfirmado(p)); const confirmados = recibos.filter(s.recebimentoConfirmado);
  if (!confirmados.length) return { pending: pendente, confirmed: false };
  const lotes = new Set(s.tarifaDeCredito(item.clientId, new Date(now).toISOString(), undefined, reg.consultations, reg.payments, perfil, undefined, false).availableLots.filter((l) => l.cents > 0).map((l) => l.paymentId));
  return { pending: pendente, confirmed: confirmados.some((p) => lotes.has(p.id)) };
}

/** `activeRequestedWait`: o histórico é imutável; só o combinado da etapa atual é relógio vivo. */
function esperaPedidaAtiva(item, now, reg, perfil) {
  const hist = historicoDeEspera(item); const ult = hist[hist.length - 1]; const contato = contatoDe(item);
  if (!ult || encerrado(item) || item.workflowStatus === 'Em consulta' || contato.tags.includes('Em consulta')) return undefined;
  const em = Date.parse(ult.at);
  if (!Number.isFinite(em) || em > now || !Number.isSafeInteger(ult.minutes) || ult.minutes < 1 || ult.minutes > 1440) return undefined;
  if (ult.attempt !== undefined && ult.attempt !== contato.attempt) return undefined;
  const eventos = item.contactHistory || [];
  const ancora = ult.afterEventId !== undefined ? ultimoIndice(eventos, (e) => e.id === ult.afterEventId) : ultimoIndice(eventos, (e) => Date.parse(e.at) <= em);
  if (ult.afterEventId && ancora < 0) return undefined;
  const etiquetasOriginais = ancora >= 0 ? eventos[ancora].after : contato.tags;
  const promessaMantida = etiquetasOriginais.includes('Vai pagar') && contato.tags.includes('Vai pagar');
  const mudaEtapa = eventos.slice(ancora + 1).some((e) => {
    if (e.tag === 'Pediu estorno') return false;
    if (promessaMantida && e.active && ['Avisada', 'Pode agora'].includes(e.tag)) return false;
    return ['Avisada', 'Avisar de novo', 'Chamar cliente', 'Pode agora', 'Vai pagar', 'Pago', 'Não respondeu', 'Não voltou', 'Não pode agora', 'Não pode', 'Cliente vai chamar', 'Chama depois', 'Próximo turno', 'Adiada', 'Cancelada', 'Concluída', 'Em consulta'].includes(e.tag);
  });
  if (mudaEtapa) return undefined;
  if (reg) {
    if (promessaMantida && !item.continuationRequest) {
      const rec = estadoDoReciboDaEspera(item, reg, em, now, perfil);
      if (rec.pending || (rec.confirmed && lanc.financiamentoDoLancamento(item, { ...reg, now }, perfil).funded)) return undefined;
    } else if (esperaTemRecibo(item, reg, em, now)) return undefined;
  }
  return ult;
}

const duracaoPedida = (min) => {
  const d = Math.floor(min / 1440); const h = Math.floor(min % 1440 / 60); const r = Math.floor(min % 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', r || (!d && !h) ? `${r} min` : ''].filter(Boolean).join(' ');
};
/** `requestedWaitTiming`. */
function prazoPedido(item, now, reg, perfil) {
  const ult = esperaPedidaAtiva(item, now, reg, perfil); if (!ult) return null;
  const falta = Date.parse(ult.at) + ult.minutes * MINUTO_MS - now;
  return { ...ult, deadline: Date.parse(ult.at) + ult.minutes * MINUTO_MS, overdue: falta <= 0,
    label: falta > 0 ? `Faltam ${duracaoPedida(Math.ceil(falta / MINUTO_MS))}` : falta > -MINUTO_MS ? 'Prazo esgotado' : `Prazo excedido há ${duracaoPedida(Math.floor(-falta / MINUTO_MS))}` };
}

const vazia = () => ({ attention: false, advanceReady: false, expired: false, startedAt: null, kind: null, deadline: null, label: '', manual: false });
const emCurso = (v) => v.status === 'Em curso' && !v.tarologistFinishReport;

/** `commonAgendaWait`: UM relógio visual de etapa de contato. Tempo sozinho nunca muda a etapa nem a reserva. */
function esperaComum(item, entrada, perfil) {
  if (item.continuationRequest || encerrado(item) || item.workflowStatus === 'Em consulta' || k.contatoParado(item)) return vazia();
  if (!ativoNoDia(item, entrada.date, entrada.date) || (b.instantePedido(item, entrada.date) ?? 0) > entrada.now) return vazia();
  if (entrada.consultations.some((v) => emCurso(v) && v.clientId === item.clientId)) return vazia();
  const contato = contatoDe(item);
  const eventos = (item.contactHistory || []).filter((e) => e.attempt === contato.attempt && e.date === contato.date);
  const aviso = ultimo(eventos, (e) => e.tag === 'Avisada'); const promessa = ultimo(eventos, (e) => e.tag === 'Vai pagar');
  const financiado = lanc.financiamentoDoLancamento(item, entrada, perfil).funded;
  const etapaPagamento = contato.tags.includes('Vai pagar');
  if (!etapaPagamento && contato.tags.includes('Pode agora')) return vazia();
  if (etapaPagamento && financiado) return vazia();
  const ev = etapaPagamento ? promessa : aviso;
  if (!ev || !ev.active || (!etapaPagamento && !contato.tags.includes('Avisada'))) return vazia();
  if (!etapaPagamento && eventos.some((r) => r.active && Date.parse(r.at) >= Date.parse(ev.at) && (r.tag === 'Pode agora' || r.tag === 'Vai pagar' || (r.tag === 'Pago' && r.before.some((t) => t === 'Vai pagar' || t === 'Pode agora'))))) return vazia();
  const inicio = Date.parse(ev.at);
  if (!Number.isFinite(inicio) || inicio > entrada.now) return vazia();
  const recibos = etapaPagamento ? estadoDoReciboDaEspera(item, entrada, inicio, entrada.now, perfil) : undefined;
  if ((recibos && recibos.pending) || (!etapaPagamento && esperaTemRecibo(item, entrada, inicio, entrada.now))) return vazia();
  const pausa = recibos && recibos.confirmed ? 'partial-payment' : undefined;
  const kind = etapaPagamento ? 'payment' : 'response';
  const manual = esperaPedidaAtiva(item, entrada.now, entrada, perfil); const manualEm = Date.parse((manual && manual.at) || '');
  if (manual && manualEm >= inicio && manualEm <= entrada.now) {
    const deadline = manualEm + manual.minutes * MINUTO_MS; const falta = deadline - entrada.now;
    return { attention: falta <= 0, advanceReady: false, expired: false, startedAt: inicio, kind, deadline, manual: true, eventId: ev.id, ...(pausa ? { automationPaused: pausa } : {}),
      label: falta > 0 ? `Pediu ${manual.minutes} min · faltam ${Math.ceil(falta / MINUTO_MS)} min` : 'Prazo combinado esgotado' };
  }
  const decorrido = entrada.now - inicio; const deadline = inicio + EXPIRA_MS;
  if (pausa) return { attention: false, advanceReady: false, expired: false, startedAt: inicio, kind, deadline: null, manual: false, eventId: ev.id, automationPaused: pausa, label: `Aguardando complemento · ${tempoDecorrido(Math.floor(decorrido / 1000))}` };
  return { attention: decorrido >= ATENCAO_MS && decorrido < EXPIRA_MS, advanceReady: false, expired: decorrido >= EXPIRA_MS, startedAt: inicio, kind, deadline, manual: false, eventId: ev.id,
    label: `${kind === 'response' ? 'Aguardando resposta' : 'Aguardando pagamento'} · ${tempoDecorrido(Math.floor(decorrido / 1000))}` };
}

/** `moreTimeProcessHistory`. */
function historicoDoProcesso(item) {
  const { attempt } = contatoDe(item); const eventos = (item.contactHistory || []).filter((e) => e.attempt === attempt);
  const ultimaDe = (tag) => { const e = ultimo(eventos, (r) => r.tag === tag); return e && e.active ? e : undefined; };
  return { notice: ultimaDe('Avisada'), promise: ultimaDe('Vai pagar'), payment: ultimaDe('Pago'), ready: ultimaDe('Pode agora') };
}
/** `moreTimeContactKnown`. */
function contatoDoMaisTempoConhecido(item) { const h = historicoDoProcesso(item); return Boolean(h.notice || h.ready || h.promise || contatoDe(item).tags.includes('Pode agora')); }

/** `moreTimeAgendaWait`: espera da continuação (pedido de mais tempo). Visual: expirada é alerta mais forte, nunca liberação. */
function esperaDoMaisTempo(origem, item, consultas, pagamentos, now, perfil) {
  const pedido = origem.tarologistMoreTimeRequest;
  if (encerrado(item) || item.workflowStatus === 'Em consulta' || (pedido && (pedido.reservationRelease || pedido.suspended || pedido.archived)) || !contatoDoMaisTempoConhecido(item)) return undefined;
  const contato = contatoDe(item); const eventos = (item.contactHistory || []).filter((e) => e.attempt === contato.attempt);
  if (contato.tags.some((t) => ['Não respondeu', 'Não voltou', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Próximo turno'].includes(t))) return undefined;
  const prometeu = ultimo(eventos, (e) => e.tag === 'Vai pagar'); const avisou = ultimo(eventos, (e) => e.tag === 'Avisada');
  const emIso = new Date(now).toISOString(); let etapa; let ev;
  const depoisDaPromessa = prometeu ? eventos.slice(eventos.indexOf(prometeu) + 1) : [];
  const pagamentoPendente = prometeu && prometeu.active && (contato.tags.includes('Vai pagar') || depoisDaPromessa.some((e) => e.tag === 'Pago' && e.active)) && !depoisDaPromessa.some((e) => e.active && ['Avisar de novo', 'Chamar cliente'].includes(e.tag));
  if (prometeu && pagamentoPendente) {
    const oferta = lanc.ofertaDeContinuacao(item, consultas, pagamentos, emIso, perfil); if (oferta && oferta.funded) return undefined;
    etapa = 'payment'; ev = prometeu;
  } else if (avisou && avisou.active && contato.tags.includes('Avisada')) {
    const recebeuDepois = pagamentos.some((p) => p.clientId === item.clientId && s.recebimentoConfirmado(p) && pg.valorDaConsulta(p) > 0 && Date.parse(p.paidAt || p.informedAt) >= Date.parse(avisou.at)
      && !p.linkedConsultationId && !consultas.some((r) => consomeCobertura(r) && r.billing && r.billing.funding && r.billing.funding.some((l) => l.paymentId === p.id)));
    if (recebeuDepois) { const oferta = lanc.ofertaDeContinuacao(item, consultas, pagamentos, emIso, perfil); if (oferta && oferta.funded) return undefined; }
    const depois = eventos.slice(eventos.indexOf(avisou) + 1);
    if (depois.some((e) => e.active && ['Pode agora', 'Vai pagar', 'Pago'].includes(e.tag))) return undefined;
    etapa = 'reply'; ev = avisou;
  } else return undefined;
  const inicio = Date.parse(ev.at);
  if (!Number.isFinite(inicio)) return undefined;
  const recebido = pagamentos.some((p) => p.clientId === item.clientId && p.status !== 'Cancelado' && pg.valorDaConsulta(p) > 0 && Date.parse(p.informedAt) >= inicio && Date.parse(p.informedAt) <= now
    && (!p.linkedConsultationId || (p.linkedConsultationId !== origem.id && consultas.some((r) => r.id === p.linkedConsultationId && r.continuation && r.continuation.sourceConsultationId === origem.id)))
    && !consultas.some((r) => r.id !== origem.id && consomeCobertura(r) && r.billing && r.billing.funding && r.billing.funding.some((l) => l.paymentId === p.id)));
  if (recebido) return undefined;
  const manual = esperaPedidaAtiva(item, now); const manualEm = Date.parse((manual && manual.at) || '');
  if (manual && manualEm >= inicio && manualEm <= now) return undefined;
  const decorrido = Math.max(0, now - inicio); const deadline = inicio + EXPIRA_MS;
  const restantes = Math.max(0, Math.ceil((deadline - now) / 1000)); const minutos = Math.floor(decorrido / MINUTO_MS);
  const atencaoRestante = Math.max(0, Math.ceil((ATENCAO_MS - decorrido) / 1000));
  return { stage: etapa, eventId: ev.id, startedAt: ev.at, deadline, attention: decorrido >= ATENCAO_MS && now < deadline, advanceReady: false, remainingSeconds: restantes,
    label: decorrido < ATENCAO_MS ? `${Math.floor(atencaoRestante / 60)}:${String(atencaoRestante % 60).padStart(2, '0')}` : `${minutos} min de espera`, expired: now >= deadline };
}

module.exports = { ATENCAO_MS, EXPIRA_MS, MINUTO_MS, tempoDecorrido, historicoDeEspera, esperaTemRecibo, estadoDoReciboDaEspera, esperaPedidaAtiva, prazoPedido, esperaComum, historicoDoProcesso, contatoDoMaisTempoConhecido, esperaDoMaisTempo };
