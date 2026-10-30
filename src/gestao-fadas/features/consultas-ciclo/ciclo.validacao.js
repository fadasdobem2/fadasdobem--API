'use strict';

/**
 * Validação da FORMA das entradas da Consulta. As REGRAS de negócio (422, com a mensagem do front) ficam em
 * `_comum/dominio/consulta-*.js`. Nada do que o cliente manda escolhe perfil, conta, versão nova, instante, comissão nem autor.
 */

const AppError = require('../../../utils/AppError');

const invalido = (campo) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const CANAIS = ['WhatsApp Áudio', 'PABX', 'WhatsApp Ligação', 'WhatsApp Texto', 'WhatsApp', 'Telefone'];

const chaveOperacao = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(v)) throw invalido('operationKey'); return v; };
const idConsulta = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(v)) throw invalido('id'); return v; };
const idCliente = (v) => { if (typeof v !== 'string' || !/^\d{1,10}$/.test(v) || Number(v) < 1 || Number(v) > 2147483647) throw invalido('clientId'); return v; };
const idTarologo = (v) => { if (typeof v !== 'string' || !/^[A-Za-z0-9._:@-]{1,64}$/.test(v)) throw invalido('tarotId'); return v; };
const instante = (v, campo) => { if (typeof v !== 'string' || !Number.isFinite(Date.parse(v))) throw invalido(campo); return v; };

/** Consulta de listagem: `from` (data civil), `tarotId`, `clientId`, `includeClosed`. */
function consulta(q) {
  const de = q.from === undefined ? undefined : (/^\d{4}-\d{2}-\d{2}$/.test(`${q.from}`) ? `${q.from}` : (() => { throw invalido('from'); })());
  return { de, tarotId: q.tarotId === undefined ? undefined : idTarologo(`${q.tarotId}`), clientId: q.clientId === undefined ? undefined : idCliente(`${q.clientId}`), incluirEncerradas: `${q.includeClosed}` !== 'false' };
}

/** `POST /consultations`: `{ operationKey, record }`. O registro é o que o front montou; o servidor decide o resto. */
function corpoLancar(b) {
  if (!ehObjeto(b) || !ehObjeto(b.record)) throw invalido('corpo');
  const r = b.record;
  idConsulta(r.id); idCliente(r.clientId); idTarologo(r.tarotId);
  if (typeof r.client !== 'string' || !r.client.trim() || r.client.length > 200) throw invalido('client');
  if (typeof r.tarot !== 'string' || !r.tarot.trim() || r.tarot.length > 200) throw invalido('tarot');
  if (r.paymentProfile !== 'Pré-paga' && r.paymentProfile !== 'Pós-paga') throw invalido('paymentProfile');
  if (!CANAIS.includes(r.channel)) throw invalido('channel');
  if (r.startedAt !== undefined) instante(r.startedAt, 'startedAt');
  if (r.agendaItemId !== undefined) idConsulta(r.agendaItemId);
  if (r.observation !== undefined && typeof r.observation !== 'string') throw invalido('observation');
  return { operationKey: chaveOperacao(b.operationKey), record: r };
}

/** Início, pausa e retomada: `{ operationKey }`. */
function corpoSimples(b) {
  if (!ehObjeto(b)) throw invalido('corpo');
  return { operationKey: chaveOperacao(b.operationKey) };
}

/** `POST /:id/finish[-by-staff]`: `{ operationKey, minutes, timeEntry?, timingConfirmed?, clientWantsMoreTime?, earlyFinish? }`. */
function corpoTermino(b) {
  if (!ehObjeto(b)) throw invalido('corpo');
  if (typeof b.minutes !== 'number' || !Number.isFinite(b.minutes)) throw invalido('minutes');
  const e = b.timeEntry;
  if (e !== undefined && !(ehObjeto(e) && e.mode === 'clock' && typeof e.startTime === 'string' && typeof e.endTime === 'string' && typeof e.nextDay === 'boolean')) throw invalido('timeEntry');
  const f = b.earlyFinish;
  if (f !== undefined && !(ehObjeto(f) && (f.reason === undefined || typeof f.reason === 'string') && typeof f.note === 'string')) throw invalido('earlyFinish');
  return { operationKey: chaveOperacao(b.operationKey), minutes: b.minutes, timeEntry: e, timingConfirmed: b.timingConfirmed === true, clientWantsMoreTime: b.clientWantsMoreTime === undefined ? undefined : b.clientWantsMoreTime === true, earlyFinish: f };
}

/** `POST /:id/cancel-by-reader`: `{ operationKey, reason, note }`. */
function corpoDevolucao(b) {
  if (!ehObjeto(b)) throw invalido('corpo');
  if (typeof b.reason !== 'string' || (b.note !== undefined && typeof b.note !== 'string')) throw invalido('reason');
  return { operationKey: chaveOperacao(b.operationKey), reason: b.reason, note: b.note === undefined ? '' : b.note };
}

/** `POST /:id/finish/correction-request`: `{ operationKey, minutes, reason }`. */
function corpoCorrecao(b) {
  if (!ehObjeto(b) || typeof b.minutes !== 'number' || !Number.isFinite(b.minutes) || typeof b.reason !== 'string') throw invalido('corpo');
  return { operationKey: chaveOperacao(b.operationKey), minutes: b.minutes, reason: b.reason };
}

/** `POST /:id/revise`: `{ operationKey, expectedVersion, record }` (`expectedVersion` = o `updatedAt` que o front leu). */
function corpoRevisao(b) {
  if (!ehObjeto(b) || !ehObjeto(b.record)) throw invalido('corpo');
  instante(b.expectedVersion, 'expectedVersion');
  if (!Array.isArray(b.record.audit)) throw invalido('record.audit');
  return { operationKey: chaveOperacao(b.operationKey), expectedVersion: b.expectedVersion, record: b.record };
}

module.exports = { invalido, chaveOperacao, idConsulta, idCliente, idTarologo, consulta, corpoLancar, corpoSimples, corpoTermino, corpoDevolucao, corpoCorrecao, corpoRevisao, CANAIS };
