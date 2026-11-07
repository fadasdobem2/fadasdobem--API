'use strict';

/**
 * Domínio puro do calendário da operação (dia Fadas, corte das métricas e horário de atendimento), porte versionado de
 * `features/domain/operation-settings.ts` do front da Nice (v706). Substitui, para quem passar uma história, o corte fixo das 06:00:
 * sem história a regra é a de sempre (versão original 06:00, `DEFAULT_OPERATION_SETTINGS`), igual a `dia-operacional.js`.
 * O front guarda a história no navegador; aqui ela é SEMPRE um argumento (o servidor decide de onde vem). Sem banco, sem Express.
 * Se o front mudar a regra, regerar os casos de `scripts/verificar-gf-ponto.js` (`gerar-ouro-gf-ponto.js`).
 */

const FUSO = 'America/Sao_Paulo';
const NOMES_DIA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DEFAULT_OPERATION_SETTINGS = Object.freeze({
  id: 'operation-original-06', effectiveFrom: '1900-01-01', createdAt: '2026-10-02T09:00:00Z', createdBy: 'Configuração original', dayStart: '06:00', metricsTime: '06:00',
  // Não presumir uma escala de atendimento que ainda não foi cadastrada.
  serviceHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, defined: false, closed: false, start: '06:00', end: '06:00', endDayOffset: 1 })),
});

const formatoData = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
const formatoPartes = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

const civilDateInSaoPaulo = (valor) => formatoData.format(new Date(valor));
function nextDate(data, dias = 1) { const d = new Date(`${data}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); }
function validDate(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) && Number.isFinite(Date.parse(`${valor}T12:00:00Z`)) && new Date(`${valor}T12:00:00Z`).toISOString().slice(0, 10) === valor;
}
function timeMinutes(valor) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(valor)) throw new RangeError('Informe um horário válido, de 00:00 a 23:59.');
  const [h, m] = valor.split(':').map(Number); return h * 60 + m;
}

/** Resolve o offset da zona no instante, inclusive em registros com horário de verão antigo. */
function saoPauloWallTimestamp(data, hora) {
  if (!validDate(data)) throw new RangeError('Informe uma data válida.');
  timeMinutes(hora);
  const alvo = Date.parse(`${data}T${hora}:00Z`); let candidato = alvo + 3 * 3_600_000;
  for (let n = 0; n < 4; n++) {
    const partes = formatoPartes.formatToParts(new Date(candidato)); const p = (t) => (partes.find((v) => v.type === t) || {}).value || '';
    const observado = Date.parse(`${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}Z`);
    const ajuste = alvo - observado; if (!ajuste) return new Date(candidato).toISOString(); candidato += ajuste;
  }
  throw new RangeError('Esse horário não existe no fuso de São Paulo nesta data.');
}

function validateOperationVersion(v) {
  if (!v.id || !validDate(v.effectiveFrom) || !Number.isFinite(Date.parse(v.createdAt)) || !`${v.createdBy}`.trim()) throw new RangeError('A versão precisa de identificação, vigência e autoria.');
  timeMinutes(v.dayStart); timeMinutes(v.metricsTime);
  if (timeMinutes(v.metricsTime) < timeMinutes(v.dayStart)) throw new RangeError('A atualização das métricas deve acontecer no fechamento do dia Fadas ou depois dele.');
  if (!Array.isArray(v.serviceHours) || v.serviceHours.length !== 7 || new Set(v.serviceHours.map((x) => x.weekday)).size !== 7) throw new RangeError('Informe os sete dias da semana.');
  for (const row of v.serviceHours) {
    if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6 || typeof row.defined !== 'boolean' || typeof row.closed !== 'boolean' || ![0, 1].includes(row.endDayOffset)) throw new RangeError('Confira os dias de atendimento.');
    const duracao = timeMinutes(row.end) + row.endDayOffset * 1440 - timeMinutes(row.start);
    if (row.defined && !row.closed && (duracao <= 0 || duracao > 1440)) throw new RangeError(`${NOMES_DIA[row.weekday]}: o atendimento deve durar mais de zero e no máximo 24 horas.`);
  }
  for (const row of v.serviceHours) {
    const prox = v.serviceHours.find((r) => r.weekday === (row.weekday + 1) % 7);
    if (row.defined && !row.closed && row.endDayOffset === 1 && prox.defined && !prox.closed && timeMinutes(row.end) > timeMinutes(prox.start)) throw new RangeError(`${NOMES_DIA[row.weekday]}: o término se sobrepõe ao atendimento do dia seguinte.`);
  }
}

function validOperationHistory(valor) {
  if (!Array.isArray(valor) || !valor.length) return false;
  try {
    valor.forEach(validateOperationVersion);
    return valor[0].id === DEFAULT_OPERATION_SETTINGS.id && JSON.stringify(valor[0]) === JSON.stringify(DEFAULT_OPERATION_SETTINGS)
      && valor.every((v, i) => !i || valor[i - 1].effectiveFrom < v.effectiveFrom) && new Set(valor.map((v) => v.id)).size === valor.length;
  } catch (_e) { return false; }
}

const HISTORIA_PADRAO = Object.freeze([DEFAULT_OPERATION_SETTINGS]);
const operationVersionForDate = (data, historia = HISTORIA_PADRAO) => [...historia].reverse().find((v) => v.effectiveFrom <= data) || DEFAULT_OPERATION_SETTINGS;
const operationalDayStart = (data, historia = HISTORIA_PADRAO) => saoPauloWallTimestamp(data, operationVersionForDate(data, historia).dayStart);

function operationalWindow(inicio, fim = inicio, historia = HISTORIA_PADRAO) {
  if (!validDate(inicio) || !validDate(fim) || inicio > fim) throw new RangeError('Informe um período válido.');
  const prox = nextDate(fim);
  return {
    startAt: operationalDayStart(inicio, historia), endAt: operationalDayStart(prox, historia),
    versionIds: [...new Set([operationVersionForDate(inicio, historia).id, ...historia.filter((v) => v.effectiveFrom > inicio && v.effectiveFrom <= prox).map((v) => v.id)])],
  };
}

/** Dia Fadas de um instante: antes do início do dia da versão vigente ainda é o dia civil anterior. */
function operationalDateAt(valor, historia = HISTORIA_PADRAO) {
  const em = new Date(valor).getTime(); if (!Number.isFinite(em)) throw new RangeError('Instante inválido.');
  const civil = civilDateInSaoPaulo(em); return em < Date.parse(operationalDayStart(civil, historia)) ? nextDate(civil, -1) : civil;
}

function operationalWindowLabel(inicio, fim = inicio, historia = HISTORIA_PADRAO) {
  const primeiro = operationVersionForDate(inicio, historia).dayStart; const ultimo = operationVersionForDate(nextDate(fim), historia).dayStart;
  if (historia.some((v) => v.effectiveFrom > inicio && v.effectiveFrom <= nextDate(fim))) return `Corte alterado no período: ${primeiro} → ${ultimo} · São Paulo`;
  return `${primeiro} às ${ultimo} do dia seguinte · São Paulo`;
}

function appendOperationVersion(historia, versao, hoje) {
  validateOperationVersion(versao);
  if (!validDate(hoje) || versao.effectiveFrom <= hoje) throw new RangeError('Escolha uma data futura para preservar os dias já encerrados.');
  if (versao.effectiveFrom <= historia[historia.length - 1].effectiveFrom) throw new RangeError('A nova vigência deve ser posterior à última versão programada.');
  if (historia.some((v) => v.id === versao.id)) throw new RangeError('Essa versão já foi registrada.');
  return [...historia, JSON.parse(JSON.stringify(versao))];
}

/** Dia da última execução devida, sem antecipar a consolidação antes do horário configurado. */
function metricsGenerationDay(valor, historia = HISTORIA_PADRAO) {
  const em = new Date(valor).getTime(); const civil = civilDateInSaoPaulo(em);
  const agendado = saoPauloWallTimestamp(civil, operationVersionForDate(civil, historia).metricsTime);
  return em < Date.parse(agendado) ? nextDate(civil, -1) : civil;
}

module.exports = {
  OPERATION_TIME_ZONE: FUSO, DEFAULT_OPERATION_SETTINGS, NOMES_DIA, civilDateInSaoPaulo, nextDate, validDate, timeMinutes, saoPauloWallTimestamp,
  validateOperationVersion, validOperationHistory, operationVersionForDate, operationalDayStart, operationalWindow, operationalDateAt,
  operationalWindowLabel, appendOperationVersion, metricsGenerationDay,
};
