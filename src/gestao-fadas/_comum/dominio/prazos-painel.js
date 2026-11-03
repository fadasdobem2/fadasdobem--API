'use strict';

/**
 * Prazos do painel: relógio da etapa de contato, alertas de espera e revisão prioritária (domínio puro, Maturacao/56 grupo D). Porte do CÓDIGO do front:
 * `painel/panel-contact-clock.ts` (`panelReadyStartedAt`, `panelReadyWaitAlert`, `panelContactClock`, `panelContactWaitAlert`) e
 * `painel/panel-waiting-deadline.ts` (`panelWaitingDeadlineExpired`, `panelWaitingNeedsAttention`). Limiares: 5 min (atenção) e 10 min (urgente/expirada).
 * Relógio injetado (`now`, ms). A espera comum (`wait`) vem de `prazos-espera.esperaComum`.
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const b = require('./fila-geral-base');
const o = require('./painel-ordem');
const e = require('./prazos-espera');

const ultimo = (lista, f) => { for (let i = lista.length - 1; i >= 0; i -= 1) if (f(lista[i])) return lista[i]; return undefined; };

/** `panelReadyStartedAt`: disponibilidade é informação para a equipe, nunca prazo automático da cliente. */
function inicioDoPodeAgora(item, date) {
  if (!o.prontaParaReceber(item, date)) return null;
  const contato = contatoDe(item);
  const ev = ultimo(item.contactHistory || [], (r) => r.attempt === contato.attempt && r.date === contato.date && r.tag === 'Pode agora');
  const em = ev && ev.active ? Date.parse(ev.at) : NaN;
  return Number.isFinite(em) ? em : null;
}

/** `panelContactClock`: no máximo UM relógio de etapa visível. */
function relogioDeContato({ item, date, funded, hidePaymentClock = false, wait, clock, completing = false }) {
  if (encerrado(item) || item.workflowStatus === 'Em consulta' || b.temEsperaAdiada(item)) return undefined;
  const contato = contatoDe(item);
  if (item.continuationRequest && contato.tags.includes('Não respondeu')) return undefined;
  if (contato.tags.some((t) => ['Não voltou', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Próximo turno', 'Em consulta'].includes(t))) return undefined;
  if (contato.tags.includes('Vai pagar') && !funded) {
    if (hidePaymentClock) return undefined;
    const inicio = clock && clock.tag === 'Vai pagar' ? clock.startedAt : wait && wait.kind === 'payment' && !wait.manual ? wait.startedAt : null;
    return inicio !== null && inicio !== undefined && Number.isFinite(inicio)
      ? { tag: 'Vai pagar', startedAt: inicio, title: completing ? 'Tempo desde que a cliente informou que vai completar o pagamento' : 'Tempo desde que a cliente informou que vai pagar' } : undefined;
  }
  const pronto = inicioDoPodeAgora(item, date);
  if (pronto !== null) return { tag: 'Pode agora', startedAt: pronto, title: 'Tempo desde que a cliente confirmou que pode agora' };
  if (clock && clock.tag !== 'Vai pagar' && Number.isFinite(clock.startedAt)) return clock;
  if (wait && wait.kind === 'response' && !wait.manual && wait.startedAt !== null) return { tag: 'Avisada', startedAt: wait.startedAt };
  return undefined;
}

/** `panelReadyWaitAlert`: cliente confirmada ainda esperando encaminhamento (5 min atenção, 10 min urgente). */
function alertaDeProntaEsperando({ item, date, funded, now }) {
  const etapa = relogioDeContato({ item, date, funded });
  if (!etapa || etapa.tag !== 'Pode agora') return undefined;
  const inicio = etapa.startedAt;
  if (!Number.isFinite(now) || inicio > now) return undefined;
  const decorrido = now - inicio;
  if (decorrido < e.ATENCAO_MS) return undefined;
  const minutos = Math.floor(decorrido / e.MINUTO_MS); const tom = decorrido >= e.EXPIRA_MS ? 'urgent' : 'attention';
  return { tone: tom, startedAt: inicio, elapsedMinutes: minutos, title: `Cliente confirmou que pode agora há ${minutos} minutos e aguarda encaminhamento` };
}

/** `panelContactWaitAlert`: mesmos limiares para contato e pagamento (inclui pagamento parcial). */
function alertaDeContatoEsperando(entrada) {
  const etapa = relogioDeContato(entrada);
  if (!etapa || etapa.tag === 'Pode agora' || !Number.isFinite(entrada.now)) return undefined;
  const minutos = Math.floor((entrada.now - etapa.startedAt) / e.MINUTO_MS);
  if (minutos < 5) return undefined;
  return { tone: minutos >= 10 ? 'urgent' : 'attention', elapsedMinutes: minutos, title: `Aguardando ${etapa.tag === 'Vai pagar' ? 'pagamento' : 'resposta'} há ${minutos} min` };
}

function revisaoDevida(item, entrada, perfil, esperaComum, comAtencao) {
  if (!item.continuationRequest) {
    const espera = esperaComum ?? e.esperaComum(item, entrada, perfil);
    if (espera.manual) return espera.deadline !== null && espera.deadline <= entrada.now;
    return comAtencao ? espera.kind !== null && espera.startedAt !== null && entrada.now - espera.startedAt >= e.ATENCAO_MS : espera.expired;
  }
  const origem = entrada.consultations.find((v) => v.id === item.continuationRequest.sourceConsultationId && v.clientId === item.clientId);
  if (!origem) return false;
  const manual = e.esperaPedidaAtiva(item, entrada.now, entrada, perfil);
  const etapaItem = manual ? { ...item, requestedWaitHistory: [], queuePaymentWait: undefined } : item;
  const espera = e.esperaDoMaisTempo(origem, etapaItem, entrada.consultations, entrada.payments, entrada.now, perfil);
  if (!espera) return false;
  if (manual && Date.parse(manual.at) >= Date.parse(espera.startedAt)) return Date.parse(manual.at) + manual.minutes * e.MINUTO_MS <= entrada.now;
  return espera.expired || (comAtencao && espera.attention);
}
/** `panelWaitingDeadlineExpired`. */
const prazoDeEsperaExpirado = (item, entrada, perfil, esperaComum) => revisaoDevida(item, entrada, perfil, esperaComum, false);
/** `panelWaitingNeedsAttention`: revisão vira prioridade com o alerta de 5 minutos. */
const esperaPrecisaDeAtencao = (item, entrada, perfil, esperaComum) => revisaoDevida(item, entrada, perfil, esperaComum, true);

module.exports = { inicioDoPodeAgora, relogioDeContato, alertaDeProntaEsperando, alertaDeContatoEsperando, prazoDeEsperaExpirado, esperaPrecisaDeAtencao };
