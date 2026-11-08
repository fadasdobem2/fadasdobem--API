'use strict';

/**
 * `reserve_tarologist` e `release_reservation` (Lilly v710, docs/banco/22 §6), pelos serviços EXISTENTES da Fila Geral
 * (`agenda-fila.service.js`: `POST /agenda/:id/route-general` modo `reserve` e `POST /agenda/:id/reservation/release`), que repetem inteira a regra
 * do front (`validateGeneralDestination`: disponibilidade, fila própria, restrição, admissão, reserva de outra cliente, continuação).
 * Antes: revisão do snapshot, assinatura da linha (`expectedAppointment`), vínculo cliente x conversa, autoria provada num evento resolvido pela API
 * (reservar: atendente autorizada; liberar: atendente ou a própria Lilly a partir de mensagem da cliente), cliente sem consulta aberta.
 * A reserva da API é a do front (`queueReservation {tarotId, at, by}` + histórico); nenhum segundo livro. `committed:true` só depois do commit do serviço.
 */

const fila = require('../../agenda/agenda-fila.service');
const fg = require('../../../_comum/dominio/fila-geral');
const { hojeOperacional } = require('../../../_comum/dia-operacional');
const { registrar } = require('../acoes/acoes.registro');
const leituras = require('../dados/leituras.v710');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const v = require('../v710/comum');
const { revisaoAtual } = require('../contexto/revisao');
const { avulso } = require('../dados/executor');

const LILLY = 'Lilly';

function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados da reserva.' };
  const appointmentId = texto(p.appointmentId);
  if (!v.ID.test(appointmentId)) return { motivo: 'Informe o agendamento.' };
  if (!Number.isSafeInteger(p.expectedRevision)) return { motivo: 'A ação precisa da revisão lida no contexto (expectedRevision, inteiro).' };
  if (typeof p.expectedAppointment !== 'string' || !p.expectedAppointment) return { motivo: 'A ação precisa da assinatura do agendamento (expectedAppointment).' };
  if (!v.autorValido(p.author)) return { motivo: 'A autoria da reserva precisa estar confirmada.' };
  const sourceMessageId = texto(p.sourceMessageId);
  if (!sourceMessageId) return { motivo: 'A ação precisa citar a mensagem de origem.' };
  if (!texto(acao.tarologistId)) return { motivo: 'A ação não informa o tarólogo.' };
  return { appointmentId, expectedRevision: p.expectedRevision, expectedAppointment: p.expectedAppointment, author: { id: p.author.id.trim(), name: p.author.name.trim() }, sourceMessageId, reason: texto(p.reason) };
}

/** Tudo que se confere antes do efeito. `{ recusa:{code,motivo,status} }` ou `{ n, linha }`. */
async function avaliar(acao, kind, executor) {
  const n = normalizar(acao);
  if (n.motivo) return { recusa: { code: 'INVALID_INPUT', motivo: n.motivo, status: 422 } };
  const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirTarologo: true, exigirConta: true, executor });
  if (recusa) return { recusa: { code: 'LILLY_RESERVATION_NOT_ALLOWED', motivo: recusa.reason, status: 422 } };
  const tentar = async (fn) => { try { await fn(); return null; } catch (e) { return e && e.code ? { code: e.code, motivo: e.message, status: e.status || 422 } : Promise.reject(e); } };
  const falha = await tentar(async () => {
    const humano = !(kind === 'release_reservation' && n.author.id === LILLY);
    await v.provarOrigem(executor, { ref: n.sourceMessageId, tipo: humano ? 'staff' : 'cliente', autorId: n.author.id, clientId: acao.clientId, conversationId: humano ? undefined : texto(acao.conversationId) });
    await v.exigirRevisao(n.expectedRevision);
  });
  if (falha) return { recusa: falha };
  const linha = await leituras.agendamentoPorId(n.appointmentId);
  if (!linha) return { recusa: { code: 'LILLY_APPOINTMENT_NOT_FOUND', motivo: 'Agendamento não encontrado.', status: 404 } };
  if (linha.id_cliente !== `${acao.clientId}`) return { recusa: { code: 'LILLY_APPOINTMENT_NOT_ALLOWED', motivo: 'O agendamento é de outra cliente.', status: 422 } };
  if (linha.agenda_outcome) return { recusa: { code: 'LILLY_STATE_CHANGED', motivo: 'Este agendamento já foi encerrado.', status: 409 } };
  const agora = Date.now();
  if (v.assinaturaDaReserva(v.agendamentoDoContexto(linha, { agora })) !== n.expectedAppointment) {
    return { recusa: { code: 'LILLY_APPOINTMENT_CHANGED', motivo: 'O agendamento mudou desde a escolha.', status: 409 } };
  }
  const abertas = await leituras.consultasAbertas({ clientId: acao.clientId });
  if (abertas.length) return { recusa: { code: 'LILLY_STATE_CHANGED', motivo: 'A cliente já está em uma consulta.', status: 409 } };
  const hoje = hojeOperacional(new Date(agora));
  const item = typeof linha.item === 'string' ? JSON.parse(linha.item) : linha.item;
  const reserva = fg.reservaAtiva({ ...item, id: linha.id }, hoje, agora) ? item.queueReservation : null;
  if (kind === 'reserve_tarologist' && linha.id_tarologo !== fg.FILA_GERAL) return { recusa: { code: 'LILLY_RESERVATION_NOT_ALLOWED', motivo: 'Só quem está na Fila Geral recebe reserva de profissional.', status: 422 } };
  if (kind === 'release_reservation' && (!reserva || reserva.tarotId !== `${acao.tarologistId}`)) return { recusa: { code: 'LILLY_STATE_CHANGED', motivo: 'Essa reserva já não é a mesma.', status: 409 } };
  return { n, linha, reserva };
}

const comando = (kind, nome) => ({
  async validar(acao) {
    const r = await avaliar(acao, kind, avulso);
    return r.recusa ? nao(r.recusa.motivo) : permitido(acao);
  },
  async executar(acao, { executor, chave }) {
    const r = await avaliar(acao, kind, executor);
    if (r.recusa) recusar(r.recusa.code, r.recusa.motivo, r.recusa.status);
    const { n, linha } = r;
    const operationKey = chaveDaOperacao(chave, nome);
    const expectedVersion = Number(linha.version);
    await chamarServico(() => (kind === 'reserve_tarologist'
      ? fila.encaminhar(pedidoDeServico({ params: { id: n.appointmentId }, body: { operationKey, expectedVersion, tarotId: `${acao.tarologistId}`, mode: 'reserve' }, nome: n.author.name }))
      : fila.liberar(pedidoDeServico({ params: { id: n.appointmentId }, body: { operationKey, expectedVersion, reason: 'manual', notified: false }, nome: n.author.name }))));
    const depois = await leituras.agendamentoPorId(n.appointmentId);
    const agora = Date.now();
    const linhaDepois = v.agendamentoDoContexto(depois, { agora });
    const revision = await revisaoAtual();
    const resultado = {
      appointmentId: n.appointmentId, clientId: `${acao.clientId}`, tarologistId: `${acao.tarologistId}`, revision, version: Number(depois.version),
      reservation: linhaDepois.queueReservation ? { tarotId: linhaDepois.queueReservation.tarotId, tarologistId: linhaDepois.queueReservation.tarotId, at: linhaDepois.queueReservation.at, by: linhaDepois.queueReservation.by } : null,
      at: new Date(agora).toISOString(),
    };
    if (kind === 'reserve_tarologist' && !resultado.reservation) recusar('LILLY_STATE_CHANGED', 'A reserva não ficou vigente depois de gravar.', 409);
    if (kind === 'release_reservation' && resultado.reservation) recusar('LILLY_STATE_CHANGED', 'A reserva continua vigente depois de liberar.', 409);
    await auditar(executor, chave, {
      acao: kind, entidade: 'agenda', entidadeId: n.appointmentId, antes: { version: expectedVersion }, depois: { ...resultado, author: n.author, sourceMessageId: n.sourceMessageId, conversationId: acao.conversationId },
    });
    return resultado;
  },
});

function registrarReserva() {
  registrar('reserve_tarologist', comando('reserve_tarologist', 'reserva'));
  registrar('release_reservation', comando('release_reservation', 'liberacao'));
}

module.exports = { registrarReserva, normalizar };
