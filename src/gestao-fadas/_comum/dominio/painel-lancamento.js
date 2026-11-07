'use strict';

/**
 * Painel, cobertura financeira do cartão e passo de reserva (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front:
 * `agenda/agenda-model.ts` (`agendaPaymentState` :81, `agendaFundingState` :132), `consultas/queue-launch-balance.ts` (`queueLaunchBalance`),
 * `agenda/reader-continuation-start.ts` (`readerContinuationOffer`), `agenda/agenda-launch-funding.ts` (`agendaLaunchFunding`) e
 * `painel/panel-flow-model.ts:192-207` (`panelReservationStep`). Saldo e lotes: `financeiro-saldo.js`. Moeda sem Intl (`reais`).
 * Relógio injetado (`agora`, ms). Entrada de financiamento: `{ payments, consultations, now, pricing, intakeEvents }`.
 */

const s = require('./financeiro-saldo');
const { consomeCobertura, PRECOS_PADRAO } = require('./financeiro-base');
const { contatoDe } = require('./agenda-contato');
const { ehDeCliente } = require('./agenda-identidade');
const b = require('./fila-geral-base');
const adm = require('./admissao');
const t = require('./painel-tempo');
const k = require('./painel-continuacao');
const q = require('./painel-fila-geral');
const pg = require('./painel-pagamentos');
const { bloqueioDeLancamento } = require('./painel-bloqueio');

/** `money.format` (Intl pt-BR BRL): "R$ 1.234,56", espaço sem quebra; arredonda a representação decimal mais curta (meio para cima); sinal "-" também em -0,004. */
function reais(valor) {
  const abs = Math.abs(valor); const texto = String(abs);
  let centavos;
  if (/e/.test(texto)) centavos = /e-/.test(texto) ? 0 : Math.round(abs * 100);
  else { const [i, f = ''] = texto.split('.'); const frac = `${f}000`; centavos = Number(i) * 100 + Number(frac.slice(0, 2)) + (Number(frac[2]) >= 5 ? 1 : 0); }
  const inteiro = String(Math.floor(centavos / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const negativo = valor < 0 || Object.is(valor, -0);
  return `${negativo ? '-' : ''}R$\u00a0${inteiro},${String(centavos % 100).padStart(2, '0')}`;
}

/** `agendaPaymentState` (com pagamentos). */
function estadoDePagamento(item, pagamentos, consultas = []) {
  // v706: agendamento de contato (lead) ainda não é cliente; o pagamento só conta depois do cadastro.
  if (!ehDeCliente(item)) return { paidAmount: 0, expectedAmount: undefined, openAmount: undefined, tone: 'unknown', shortLabel: 'Cadastro a completar', paidAt: undefined, awaitingConfirmation: false };
  const dele = consultas.filter((c) => c.clientId === item.clientId);
  const recibos = pagamentos.filter((p) => p.clientId === item.clientId && s.recebimentoConfirmado(p));
  const pertence = (id) => dele.some((c) => c.id === id && (c.agendaItemId === item.id || c.id === item.resolvedByConsultationId));
  const ligado = recibos.filter((p) => p.linkedConsultationId && pertence(p.linkedConsultationId)).reduce((t0, p) => t0 + Math.round(pg.valorDaConsulta(p) * 100), 0) / 100;
  const usadoNaConsulta = (p) => dele.some((c) => consomeCobertura(c) && c.billing && c.billing.funding && c.billing.funding.some((l) => l.paymentId === p.id));
  const livre = recibos.filter((p) => !p.linkedConsultationId && !usadoNaConsulta(p)).reduce((t0, p) => t0 + Math.round(pg.valorDaConsulta(p) * 100), 0) / 100;
  const disponivel = Math.max(0, Math.min(livre, s.contaDaCliente(item.clientId, pagamentos, consultas).balance));
  const pago = Math.round((ligado + disponivel) * 100) / 100;
  const esperado = item.paymentExpectedAmount;
  const aberto = esperado !== undefined && esperado > 0 ? Math.max(0, Math.round((esperado - pago) * 100) / 100) : undefined;
  const aguardando = pagamentos.some((p) => p.clientId === item.clientId && p.status !== 'Cancelado' && !s.recebimentoConfirmado(p) && (!p.linkedConsultationId || pertence(p.linkedConsultationId)));
  const contribuintes = recibos.filter((p) => (p.linkedConsultationId ? pertence(p.linkedConsultationId) : disponivel > 0 && !usadoNaConsulta(p)));
  const recibo = contribuintes.length === 1 ? contribuintes[0].paidAt || contribuintes[0].informedAt : undefined;
  const pagoEm = recibo && recibo.includes('T') && Number.isFinite(Date.parse(recibo)) ? recibo : undefined;
  const tom = aberto !== undefined && aberto > 0 ? (pago > 0 ? 'partial' : 'pending') : pago > 0 ? 'paid' : aguardando || item.paymentPending ? 'pending' : 'unknown';
  const curto = aberto !== undefined && aberto > 0 ? `Falta ${reais(aberto)}` : pago > 0 ? `${ligado > 0 || aberto === 0 ? 'Pago' : 'Crédito'} ${reais(pago)}` : aguardando ? 'Pagamento a confirmar' : item.paymentPending ? 'Falta pagar' : 'Sem pagamento';
  return { paidAmount: pago, expectedAmount: esperado, openAmount: aberto, tone: tom, shortLabel: curto, paidAt: pagoEm, awaitingConfirmation: aguardando };
}

/** `agendaFundingState`. */
function estadoDeFinanciamento(item, pagamentos, consultas = [], perfil, em) {
  const pagamento = estadoDePagamento(item, pagamentos, consultas);
  if (!ehDeCliente(item)) return { ...pagamento, coverage: s.coberturaDaCliente('', [], [], undefined, em), availableAmount: 0, receiptAvailableAmount: 0, funded: false, kind: 'missing', statusLabel: 'Cadastro a completar', shortLabel: 'Cadastro a completar', tone: 'pending' };
  const cobertura = s.coberturaDaCliente(item.clientId, pagamentos, consultas, perfil, em);
  const disponivel = Math.max(pagamento.paidAmount, Math.max(0, cobertura.balance));
  const disponivelRecibo = Math.max(pagamento.paidAmount, cobertura.confirmedAvailableBalance);
  const aberto = pagamento.expectedAmount !== undefined && pagamento.expectedAmount > 0 ? Math.max(0, Math.round((pagamento.expectedAmount - disponivel) * 100) / 100) : undefined;
  const financiado = cobertura.canLaunch && (cobertura.postpaid || cobertura.benefitMinutes > 0 || !(aberto && aberto > 0));
  const tipo = cobertura.postpaid ? 'postpaid' : disponivel > 0 ? (disponivelRecibo > 0 ? (aberto ? 'partial' : 'payment') : (aberto ? 'credit-partial' : 'credit')) : cobertura.benefitMinutes > 0 ? 'benefit' : pagamento.awaitingConfirmation ? 'confirmation' : 'missing';
  return { ...pagamento, coverage: cobertura, availableAmount: disponivel, receiptAvailableAmount: disponivelRecibo, openAmount: aberto, funded: financiado, kind: tipo };
}

/** `queueLaunchBalance`. */
function saldoDoLancamento(clientId, pagamentos, consultas, perfil, em) {
  const total = s.contaDaCliente(clientId, pagamentos, consultas, (perfil && perfil.credit) || 0).balance;
  const credito = s.tarifaDeCredito(clientId, em, undefined, consultas, pagamentos, perfil, undefined, true);
  const restante = new Map();
  for (const l of credito.availableLots) if (l.paymentId) restante.set(l.paymentId, (restante.get(l.paymentId) || 0) + l.cents);
  const pagamento = pagamentos.filter((p) => p.clientId === clientId && s.recebimentoConfirmado(p) && (restante.get(p.id) || 0) > 0).sort((p, z) => Date.parse(pg.pagoEm(z)) - Date.parse(pg.pagoEm(p)))[0] || null;
  const cents = pagamento ? restante.get(pagamento.id) || 0 : 0;
  return { total, availableAmount: Math.min(total, credito.availableAmount), previousBalance: (Math.round(total * 100) - cents) / 100, payment: pagamento, paymentRemaining: cents / 100, partiallyUsed: Boolean(pagamento && cents !== Math.round(pagamento.amount * 100)), maximumMinutes: credito.availableMinutes, unitValue: credito.unitValue };
}

/** `readerContinuationOffer`. */
function ofertaDeContinuacao(item, consultas, pagamentos, em, perfil) {
  const origem = consultas.find((r) => r.id === (item.continuationRequest && item.continuationRequest.sourceConsultationId) && r.clientId === item.clientId && r.tarotId === item.tarotId);
  if (!origem) return undefined;
  const historico = consultas.map((r) => (r.tarologistFinishReport && r.tarologistFinishReport.financialCap && !r.finishReview ? { ...r, durationSeconds: Math.max(r.durationSeconds, r.tarologistFinishReport.minutes * 60) } : r));
  const credito = s.tarifaDeCredito(item.clientId, em, undefined, historico, pagamentos, perfil, undefined, true);
  const centavos = credito.availableLots.reduce((t0, l) => t0 + l.cents, 0); const valorMinuto = credito.unitValue; const minimo = 1; // v706: a continuação financia-se a partir de 1 minuto (substitui o mínimo da tabela, 15).
  const minutos = credito.availableMinutes; const agora = Date.parse(em);
  const financiado = minutos >= minimo; const pausado = k.continuacaoSuspensa(item, consultas); const hoje = t.hojeDe(agora);
  const pronto = contatoDe(item).date === hoje && contatoDe(item).tags.includes('Pode agora') && !pausado;
  const avanco = origem.tarologistMoreTimeRequest && origem.tarologistMoreTimeRequest.queueAdvance;
  const ocupado = Boolean(avanco && avanco.successorAgendaId && !avanco.successorFinished) || consultas.some((r) => r.status === 'Em curso' && !r.tarologistFinishReport && (r.tarotId === item.tarotId || r.clientId === item.clientId));
  const pedido = b.instantePedido(item, hoje); const futuro = pedido !== null && pedido > agora;
  return { source: origem, future: futuro, minutes: minutos, amount: Math.round(minutos * valorMinuto * 100) / 100, availableAmount: centavos / 100, unitValue: valorMinuto, minimum: minimo, funded: financiado, paused: pausado, ready: pronto, occupied: ocupado, canStart: financiado && pronto && !ocupado && !futuro };
}

/** `agendaLaunchFunding`. */
function financiamentoDoLancamento(item, entrada, perfil) {
  const em = new Date(entrada.now).toISOString();
  const financeiro = estadoDeFinanciamento(item, entrada.payments, entrada.consultations, perfil, em);
  if (!ehDeCliente(item)) return financeiro;
  const continuacao = item.continuationRequest ? ofertaDeContinuacao(item, entrada.consultations, entrada.payments, em, perfil) : undefined;
  const caixa = saldoDoLancamento(item.clientId, entrada.payments, entrada.consultations, perfil, em);
  const disponivel = Math.max(0, item.continuationRequest ? (continuacao && continuacao.availableAmount) ?? 0 : caixa.total);
  const minimo = (continuacao && continuacao.minimum) ?? (entrada.pricing && entrada.pricing.minimumMinutes) ?? PRECOS_PADRAO.minimumMinutes;
  const esperado = financeiro.expectedAmount;
  const aberto = esperado !== undefined && esperado > 0 ? Math.max(0, Math.round((esperado - disponivel) * 100) / 100) : undefined;
  const caixaFinanciado = Boolean(item.continuationRequest ? continuacao && continuacao.funded : caixa.maximumMinutes >= minimo) && disponivel > 0;
  const minutosBeneficio = financeiro.coverage.benefitMinutes;
  const posPaga = financeiro.coverage.postpaid || (!(perfil && perfil.paymentProfile) && continuacao && continuacao.source.paymentProfile === 'Pós-paga');
  const financiado = Boolean(posPaga) || minutosBeneficio > 0 || caixaFinanciado;
  const tipo = posPaga ? 'postpaid' : caixaFinanciado ? (caixa.payment ? 'payment' : 'credit') : disponivel > 0 ? (caixa.payment ? 'partial' : 'credit-partial') : minutosBeneficio > 0 ? 'benefit' : financeiro.awaitingConfirmation || financeiro.coverage.awaitingConfirmation ? 'confirmation' : 'missing';
  const rotulo = tipo === 'postpaid' ? 'Pós-paga' : tipo === 'payment' || tipo === 'credit' ? 'Pagou' : tipo === 'benefit' ? 'Bônus / cortesia'
    : tipo === 'partial' && minutosBeneficio > 0 && aberto ? 'Pagamento parcial' : tipo === 'partial' || tipo === 'credit-partial' ? `Só tem ${reais(disponivel)}` : tipo === 'confirmation' ? 'A confirmar' : 'Falta pagar';
  const curto = tipo === 'payment' || tipo === 'credit' ? `${rotulo} · ${reais(disponivel)}` : tipo === 'benefit' ? `${rotulo} · ${minutosBeneficio} min` : tipo === 'confirmation' ? 'Pagamento a confirmar' : rotulo;
  return { ...financeiro, availableAmount: disponivel, openAmount: aberto, funded: financiado, kind: tipo, statusLabel: rotulo, shortLabel: curto, tone: tipo === 'partial' || tipo === 'credit-partial' ? 'partial' : financiado ? 'paid' : 'pending' };
}

/** `panelReservationStep`: `entrada` = `{ payments, consultations, date, now, intakeEvents, pricing }`. */
function passoDaReserva(item, entrada, perfil) {
  const contato = contatoDe(item); const tags = contato.tags;
  const financeiro = financiamentoDoLancamento(item, entrada, perfil); const financiado = financeiro.funded;
  const tarotId = (item.queueReservation && item.queueReservation.tarotId) ?? item.tarotId;
  const erroDeInicio = adm.erroDeInicio(adm.admissaoVigente(entrada.intakeEvents || [], tarotId, entrada.date, entrada.now), item, { tarotId, date: entrada.date, clientId: item.clientId }, entrada.now);
  const aviso = [...(item.contactHistory || [])].reverse().find((e) => e.attempt === contato.attempt && e.date === contato.date && e.tag === 'Avisada' && e.active);
  const avisoEm = tags.includes('Avisada') && aviso ? Date.parse(aviso.at) : null;
  const estado = { funded: financiado, paidLabel: financeiro.statusLabel, noticeAt: avisoEm, availableAmount: financeiro.availableAmount };
  if (!ehDeCliente(item)) return { kind: 'review', label: 'Completar cadastro', detail: 'Vincule ou cadastre a cliente antes de lançar pagamento ou consulta.', ...estado, canGenerate: false };
  const tempo = q.temporizacao(item, entrada.date, entrada.now);
  if (tempo.future) return { kind: 'notice', label: 'Aguardar horário', detail: `${tempo.label}. Confirme a disponibilidade no horário combinado.`, ...estado, canGenerate: false };
  const bloqueio = bloqueioDeLancamento(item, entrada.date, entrada.now);
  if (bloqueio) return { kind: 'review', label: 'Resolver reserva', detail: bloqueio, ...estado, canGenerate: false };
  if (erroDeInicio) return { kind: 'review', label: 'Conferir disponibilidade', detail: erroDeInicio, ...estado, canGenerate: false };
  if (financiado) return { kind: 'generate', label: 'Gerar consulta', detail: 'Cobertura disponível para lançar a consulta.', ...estado, canGenerate: true };
  return { kind: 'payment', label: 'Lançar pagamento', detail: 'Aguardando pagamento para encaminhar.', ...estado, canGenerate: false };
}

module.exports = { reais, estadoDePagamento, estadoDeFinanciamento, saldoDoLancamento, ofertaDeContinuacao, financiamentoDoLancamento, passoDaReserva };
