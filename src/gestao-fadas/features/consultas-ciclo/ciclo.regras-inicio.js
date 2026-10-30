'use strict';

/**
 * Regras de INÍCIO de consulta que o front aplica e o servidor ainda não conferia (Maturacao/29 seção 11, pendências do Painel):
 *   - taróloga reservada para a continuação de outra cliente (`continuationReservationConflict`, reader-continuation.ts:38):
 *     início pela taróloga (`tarologist-consultation-session.ts:45`) e lançamento pela equipe (`consultations-experience.tsx:1400`);
 *   - taróloga reservada na fila geral para outra cliente (`generalReservationConflict`, general-reservations.ts:51), no lançamento (:1398);
 *   - turno ativo e confirmado (`presenceStartError`, staff-presence-model.ts:80): no lançamento (:1410) e no início pela taróloga
 *     (`reader-start-command.ts:38`; quem está em pausa passa, porque o próprio início confirma a presença e a Presença grava isso);
 *   - agenda fechada para novas consultas (`intakeStartError`, agenda-intake-model.ts:80), no lançamento.
 * Cada regra só vale se a fatia dela está ligada (presença: `GF_FATIA_PRESENCA`); as mensagens são as do front.
 */

const { hojeOperacional } = require('../../_comum/dia-operacional');
const b = require('../../_comum/dominio/fila-geral-base');
const fg = require('../../_comum/dominio/fila-geral');
const adm = require('../../_comum/dominio/admissao');
const contexto = require('../agenda/agenda-fila.contexto');
const painel = require('../../_comum/dominio/painel-validacao');
const painelContexto = require('../agenda/agenda-painel.contexto');
const comum = require('./ciclo.comum');

/** `acao`: 'lancar' (equipe) ou 'iniciar' (taróloga ou equipe). `historico`: consulta já encerrada digitada pela equipe (não conta). */
async function conferir(ex, { acao, tarotId, clientId, agendaItemId, origemId, consultaId, historico = false, estritoNaPresenca = acao === 'lancar', aprovacao }) {
  if (historico) return;
  const agora = Date.now(); const data = hojeOperacional(new Date(agora));
  const ctx = await contexto.carregar(ex, { tarotId, clientId, data });
  const outras = ctx.consultas.filter((c) => c.id !== consultaId);
  const falha = (m) => { throw comum.regra(m); };
  // Lançamento a partir da FILA GERAL: o front roda `validateGeneralConsultationLaunch` inteiro (panelFlow com `freeNow`, horário, retorno, reserva,
  // outro agendamento, admissão, ocupação e continuação); o servidor faz o mesmo (Maturacao/39), com as mesmas frases, antes das conferências abaixo.
  const daFila = acao === 'lancar' && agendaItemId ? ctx.agenda.find((i) => i.id === agendaItemId) : null;
  if (daFila && daFila.tarotId === fg.FILA_GERAL) {
    const entrada = await painelContexto.carregarEntrada(ex, { tarotId, agora });
    try { painel.validarLancamento(entrada, agendaItemId, tarotId, aprovacao); } catch (e) { if (e instanceof painel.RegraDoPainelError) falha(e.message); throw e; }
  }
  const geral = acao === 'lancar' ? fg.conflitoDeReserva(ctx.agenda.filter((i) => i.tarotId === fg.FILA_GERAL), outras, tarotId, data, clientId, agendaItemId, agora) : null;
  if (geral) falha(`O tarólogo está reservado para ${geral.client} na Fila Geral. Desvincule a reserva antes de enviar outra consulta.`);
  const continuacao = b.conflitoDeContinuacao(outras, tarotId, origemId);
  if (continuacao) falha(acao === 'lancar'
    ? `O tarólogo está reservado para a continuação de ${continuacao.client}. Resolva ou libere esse pedido na Agenda antes de enviar outra consulta.`
    : `O tarólogo está reservado para a continuação de ${continuacao.client}. Aguarde o atendimento resolver ou liberar esse pedido antes de iniciar outra consulta.`);
  if (ctx.perfil) {
    const perfil = !estritoNaPresenca && adm.escolhaDePresenca(ctx.perfil, data) === 'pause' ? { ...ctx.perfil, shiftStatus: 'Disponível', presenceConfirmation: undefined } : ctx.perfil;
    const erro = adm.erroDeInicioPorPresenca(perfil, data);
    if (erro) falha(erro);
  }
  if (acao === 'lancar') {
    const ligada = ctx.agenda.find((i) => i.id === agendaItemId) || ctx.agenda.find((i) => i.tarotId === tarotId && i.clientId === clientId && require('../../_comum/dominio/agenda-contato').ativoNoDia(i, data, data));
    const erro = adm.erroDeInicio(adm.admissaoVigente(ctx.eventos, tarotId, data, agora), ligada, { tarotId, date: data, clientId }, agora);
    if (erro) falha(erro);
  }
}

module.exports = { conferir };
