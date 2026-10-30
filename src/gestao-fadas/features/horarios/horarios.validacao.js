'use strict';

/**
 * Validação das entradas de Horários e escala. Mensagens de regra (422 RULE_VIOLATION) são as do front
 * (`tarologas/tarologist-self-profile-model.ts` e `horarios/schedule-experience.tsx`) para a tela não mudar.
 * Nada do que o cliente manda escolhe perfil, conta ou revisão: só a sessão.
 */

const AppError = require('../../../utils/AppError');
const { periodosDoTexto } = require('../../_comum/dominio/horarios');

const DIAS_SEMANA = Object.freeze(['segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo']);
const AUSENCIAS = Object.freeze(['Nenhuma', 'Férias', 'Licença', 'Folga estendida']);
const MAX_DIAS = 366;

const invalido = (campo) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo }, true);
const regra = (mensagem) => new AppError(mensagem, 422, { codigo: 'RULE_VIOLATION' }, true);
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function texto(v, campo, { max, vazio = false, opcional = false } = {}) {
  if (v === undefined || v === null) { if (opcional) return undefined; throw invalido(campo); }
  if (typeof v !== 'string' || v.length > max || (!vazio && !v.trim())) throw invalido(campo);
  return v;
}

function data(v, campo, opcional = false) {
  if (v === undefined || v === null) { if (opcional) return undefined; throw invalido(campo); }
  const m = typeof v === 'string' && v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw invalido(campo);
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) throw invalido(campo);
  return v;
}

const minutos = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); const v = h * 60 + m; return v < 360 ? v + 1440 : v; };

/**
 * `validateOwnWorkPeriods` do front (tarologist-self-profile-model.ts), mesmas frases e mesma ordem: 1 a 3 períodos (a união dos caminhos do
 * front: o editor da equipe aceita 2, a resposta da escala e "Mudar horário" aceitam 3), formato, saída depois da entrada, sem sobreposição.
 * A equipe vem do editor de horários (schedule-experience.tsx), que avisa antes "A entrada e a saída de um período não podem ser iguais."
 */
function periodos(lista, { tarologa = false } = {}) {
  if (!Array.isArray(lista) || !lista.length || lista.length > 3) throw regra('Informe de um a três períodos.');
  let ultimoFim = -1;
  const saida = lista.map((p) => {
    if (!ehObjeto(p) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.end)) throw regra('Preencha a entrada e a saída de cada período.');
    if (!tarologa && p.start === p.end) throw regra('A entrada e a saída de um período não podem ser iguais.');
    const ini = minutos(p.start);
    const fim = p.end === '06:00' && ini > 360 ? 1800 : minutos(p.end);
    if (fim <= ini) throw regra('A saída precisa ser depois da entrada, dentro do dia de atendimento.');
    if (ini < ultimoFim) throw regra('Os períodos não podem se sobrepor.');
    ultimoFim = fim;
    return { start: p.start, end: p.end };
  });
  return saida;
}

/** `operationKey`: 8 a 128 caracteres (D6 do contrato 28). */
function chaveOperacao(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(v)) throw invalido('operationKey');
  return v;
}

function idTarologo(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) throw invalido('tarotId');
  return v;
}

function dias(inicio, fim) {
  const n = (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86400000;
  if (n < 0) throw regra('A data final não pode ser anterior à inicial.');
  if (n + 1 > MAX_DIAS) throw invalido('endDate');
}

/** Consulta: `tarotId`, `from`, `to` opcionais. */
function consulta(q = {}) {
  const de = data(q.from, 'from', true);
  const ate = data(q.to, 'to', true);
  if (de && ate && ate < de) throw invalido('to');
  return { tarotId: q.tarotId === undefined ? undefined : idTarologo(q.tarotId), de, ate };
}

/** Corpo de `PUT /schedules/:tarotId/overrides`: `{ operationKey, expectedRevision, replaceKey?, override }`. */
function corpoExcecao(corpo, contexto = {}) {
  if (!ehObjeto(corpo) || !ehObjeto(corpo.override)) throw invalido('override');
  const o = corpo.override;
  const ausencia = o.absenceType === undefined ? 'Nenhuma' : o.absenceType;
  if (!AUSENCIAS.includes(ausencia)) throw invalido('absenceType');
  const startDate = data(o.startDate, 'startDate');
  const endDate = data(o.endDate, 'endDate');
  // `availabilityChange` (tarologist-availability-model.ts): sem "Nenhuma" a data final é a inicial; a taróloga não grava dia passado.
  if (contexto.tarologa && contexto.hoje && startDate < contexto.hoje) throw regra('Datas passadas são somente para consulta. Escolha hoje ou uma data futura.');
  dias(startDate, endDate);
  // Só "Nenhuma" traz períodos (1 a 3); folga, férias e licença gravam lista vazia (todos os caminhos do front).
  const lista = o.periods === undefined ? [] : o.periods;
  if (ausencia !== 'Nenhuma' && (!Array.isArray(lista) || lista.length)) throw invalido('periods');
  const periodosOk = ausencia === 'Nenhuma' ? periodos(lista, contexto) : []; // a frase dos períodos vem antes (é a primeira que a tela mostra)
  const override = {
    todayHours: texto(o.todayHours, 'todayHours', { max: 200 }),
    periods: periodosOk,
    note: texto(o.note === undefined ? '' : o.note, 'note', { max: 4000, vazio: true }),
    updatedAt: texto(o.updatedAt, 'updatedAt', { max: 40 }),
    absenceType: ausencia, startDate, endDate,
  };
  const comando = texto(o.commandId, 'commandId', { max: 64, opcional: true });
  if (comando !== undefined) override.commandId = comando;
  const notaEm = texto(o.noteUpdatedAt, 'noteUpdatedAt', { max: 40, opcional: true });
  if (notaEm !== undefined) override.noteUpdatedAt = notaEm;
  for (const campo of ['noteStartDate', 'noteEndDate']) {
    const v = data(o[campo], campo, true);
    if (v !== undefined) override[campo] = v;
  }
  if (o.rosterResponse !== undefined) {
    if (!ehObjeto(o.rosterResponse)) throw invalido('rosterResponse');
    override.rosterResponse = { actor: texto(o.rosterResponse.actor, 'rosterResponse.actor', { max: 120 }), at: texto(o.rosterResponse.at, 'rosterResponse.at', { max: 40 }) };
  }
  return {
    operationKey: chaveOperacao(corpo.operationKey),
    expectedRevision: texto(corpo.expectedRevision, 'expectedRevision', { max: 64 }),
    replaceKey: texto(corpo.replaceKey, 'replaceKey', { max: 160, opcional: true }),
    override,
  };
}

/** Corpo de `DELETE .../overrides/:key` (também aceito na query): `{ operationKey, expectedRevision }`. */
function corpoRemocao(corpo) {
  const c = ehObjeto(corpo) ? corpo : {};
  return { operationKey: chaveOperacao(c.operationKey), expectedRevision: texto(c.expectedRevision, 'expectedRevision', { max: 64 }) };
}

/** Corpo de `PUT /schedules/:tarotId/weekly`: `{ operationKey, weeklySchedule, commandId? }`. */
function corpoSemanal(corpo) {
  if (!ehObjeto(corpo) || !ehObjeto(corpo.weeklySchedule)) throw invalido('weeklySchedule');
  const semana = {};
  for (const [dia, horas] of Object.entries(corpo.weeklySchedule)) {
    if (!DIAS_SEMANA.includes(dia)) throw invalido('weeklySchedule');
    // `registration-model.ts:120-125` do front: vazio ou uma das frases sem horário passam; o resto precisa de 1 a 3 períodos válidos.
    texto(horas, `weeklySchedule.${dia}`, { max: 240, vazio: true });
    const t = horas.trim();
    if (t && !/^(folga|não atende|não vou atender|horário não informado|horário a informar|sem horário informado)$/i.test(t)) {
      const lista = periodosDoTexto(t).map((p) => ({ start: p.start, end: p.end }));
      try { if (!lista.length) throw new Error('x'); periodos(lista, { tarologa: true }); } catch (_e) { throw regra(`Confira os horários de ${dia}. Use períodos como 9h às 12h e 14h às 18h, ou Folga.`); }
    }
    semana[dia] = t;
  }
  if (!Object.keys(semana).length) throw invalido('weeklySchedule');
  return { operationKey: chaveOperacao(corpo.operationKey), weeklySchedule: semana, commandId: texto(corpo.commandId, 'commandId', { max: 64, opcional: true }) };
}

module.exports = { DIAS_SEMANA, AUSENCIAS, consulta, corpoExcecao, corpoRemocao, corpoSemanal, idTarologo, chaveOperacao };
