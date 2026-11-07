'use strict';

/**
 * Notas do horário do tarólogo (Maturacao/59, 2.6 e 17). `GET /lilly/schedule-notes` lê `gf_lilly_notas_horario`;
 * `gravarNotaHorario` fica pronto para o executor da ação `tarologist_schedule_note` (dentro da transação da guarda).
 */

const { randomUUID } = require('crypto');
const repo = require('../dados/notas-horario.repo');
const { avulso } = require('../dados/executor');
const { AcaoRecusadaError } = require('../acoes/acoes.erros');

const STATUS = ['waiting', 'arrived', 'resolved'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const instante = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Resposta do GET: só o que o contrato lê (`id, tarologistId, date, text, at, status`). */
async function listarNotasDoHorario({ tarologistId, date }, executor = avulso) {
  const notas = await repo.listarNotas(executor, { tarologistId: tarologistId.trim(), date });
  return { notes: notas.map((n) => ({ id: n.id, tarologistId: n.tarologistId, date: n.date, text: n.text, at: n.at, status: n.status })) };
}

/**
 * Valida e grava a nota (idempotente por `id`: sem `id`, gera um). Recusa com `AcaoRecusadaError` (422).
 * Devolve o `result` da ação: `{ id, tarologistId, date, status, text, at }`.
 */
async function gravarNotaHorario(executor, p = {}) {
  const recusar = (msg) => { throw new AcaoRecusadaError('INVALID_INPUT', msg); };
  const tarologistId = `${p.tarologistId ?? ''}`.trim();
  const text = `${p.text ?? ''}`.trim();
  if (!tarologistId) recusar('Informe o tarólogo da nota.');
  if (!text) recusar('Informe o texto da nota.');
  if (!DATA.test(`${p.date ?? ''}`)) recusar('Informe a data da nota (AAAA-MM-DD).');
  if (!STATUS.includes(p.status)) recusar('Estado da nota inválido.');
  const at = instante(p.at);
  if (!at) recusar('Informe o instante da nota.');
  const expectedAt = p.expectedAt == null ? null : instante(p.expectedAt);
  const endsAt = p.endsAt == null ? null : instante(p.endsAt);
  if ((p.expectedAt != null && !expectedAt) || (p.endsAt != null && !endsAt)) recusar('Horário esperado ou fim inválido.');
  if (expectedAt && endsAt && endsAt < expectedAt) recusar('O fim não pode ser antes do horário esperado.');
  const { nota, repetida } = await repo.gravarNota(executor, {
    id: p.id || randomUUID(), tarologistId, date: p.date, scheduleId: p.scheduleId, expectedAt, endsAt, status: p.status, text,
    conversationId: p.conversationId, messageId: p.messageId, at,
  });
  return { id: nota.id, tarologistId: nota.tarologistId, date: nota.date, status: nota.status, text: nota.text, at: nota.at, repeated: repetida };
}

module.exports = { listarNotasDoHorario, gravarNotaHorario, STATUS };
