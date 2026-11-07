'use strict';

/**
 * `tarologist_schedule_note` (Maturacao/59, 5.1 item 12; Maturacao/60, item 5): grava a nota do horário por `gravarNotaHorario`
 * (`gf_lilly_notas_horario`). NUNCA escreve em escala, exceções de horário, presença ou agenda: a ação tem de vir marcada
 * `informationOnly:true` e `changesSchedule:false`. Cada evento de origem gera uma nota própria (id estável): a repetição não duplica,
 * e a chegada vira uma nota nova `arrived` sem apagar a anterior.
 * NÃO RESPONDIDO: conferir o `scheduleId` contra a escala do dia (ainda não há montador de `schedules[]`); aceita o id como veio.
 */

const { registrar } = require('../acoes/acoes.registro');
const { gravarNotaHorario } = require('../notas/notas-horario.servico');
const { hojeOperacional } = require('../../../_comum/dia-operacional');
const { conferirBase, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, sha, auditar } = require('./executores.comum');

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const instante = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v) : null);

/** Normaliza o payload (as duas formas do contrato) ou devolve o motivo da recusa. */
function normalizar(acao, agora = new Date()) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados da nota.' };
  if (p.informationOnly !== true || p.changesSchedule !== false) return { motivo: 'A nota do horário é só informativa: não pode mudar a escala.' };
  const tarologistId = texto(acao.tarologistId);
  const scheduleId = texto(p.scheduleId);
  const texto_ = texto(p.text);
  const eventoOrigem = texto(p.sourceEventId);
  if (!tarologistId || tarologistId === 'afila') return { motivo: 'Informe o tarólogo da nota.' };
  if (!scheduleId || scheduleId.length > 80) return { motivo: 'Informe o turno (scheduleId) da nota.' };
  if (!texto_ || texto_.length > 4000) return { motivo: 'Informe o texto da nota (até 4000 caracteres).' };
  if (!eventoOrigem) return { motivo: 'Informe o evento de origem da nota.' };
  const status = p.status === 'arrived' ? 'arrived' : 'waiting';
  const origem = instante(p.sourceAt);
  const date = DATA.test(`${p.date ?? ''}`) ? p.date : hojeOperacional(origem || agora);
  let expectedAt = null;
  if (p.expectedAt !== undefined && p.expectedAt !== null) {
    if (HORA.test(`${p.expectedAt}`)) expectedAt = new Date(`${date}T${p.expectedAt}:00-03:00`).toISOString();
    else if (instante(p.expectedAt)) expectedAt = new Date(p.expectedAt).toISOString();
    else return { motivo: 'O horário esperado é inválido (use HH:mm).' };
  }
  return { nota: { tarologistId, scheduleId, text: texto_, status, date, expectedAt, eventoOrigem, conversationId: texto(p.sourceConversationId) || texto(acao.conversationId) } };
}

function registrarNotaHorario() {
  registrar('tarologist_schedule_note', {
    async validar(acao) {
      const { motivo } = normalizar(acao);
      if (motivo) return nao(motivo);
      const recusa = await conferirBase(acao, { exigirTarologo: true });
      return recusa || permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const { motivo, nota } = normalizar(acao);
      if (motivo) recusar('INVALID_INPUT', motivo);
      const resultado = await gravarNotaHorario(executor, {
        id: `SN-${sha(`${nota.scheduleId}|${nota.eventoOrigem}`).slice(0, 40)}`, tarologistId: nota.tarologistId, date: nota.date, scheduleId: nota.scheduleId,
        expectedAt: nota.expectedAt, status: nota.status, text: nota.text, conversationId: nota.conversationId, messageId: nota.eventoOrigem, at: new Date().toISOString(),
      });
      await auditar(executor, chave, { acao: 'tarologist_schedule_note', entidade: 'nota-horario', entidadeId: resultado.id, depois: { tarologistId: nota.tarologistId, date: nota.date, status: nota.status, scheduleId: nota.scheduleId, sourceEventId: nota.eventoOrigem } });
      return resultado;
    },
  });
}

module.exports = { registrarNotaHorario, normalizar };
