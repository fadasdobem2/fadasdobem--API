'use strict';

/**
 * Leitura e recorte de consultas reais, como o Clientes precisa.
 * Porta de: features/integration/legacy-read-model.ts (readLegacyConsultation, legacyClientLabel, catalogValue) e
 * features/consultas/real-consultations-model.ts (buildRealConsultationsCut). Cópia local de propósito: a feature
 * `consultas` da A pode evoluir à parte; aqui a regra fica idêntica à da B.
 */

const {
  legacyId, legacyLocalDateTime, legacyMinutes, legacyMoney, legacyNoteText, legacyText, localOperationalDateKey, requireLegacyId, sumMoney,
} = require('./valores');

// Mesmas correções do leitor de Consultas (virada de dia, tmpConsulta -1, tarólogo sem nome); ver leitura-legado.js.
const { fimCorrigidoPorVirada, minutosDasDatas, rotuloTarologo } = require('../../consultas/helpers/leitura-legado');
const { inicioSemData } = require('../../../_comum/legado-datas');

/** O ASP gravou só a hora (`1899-12-30`): a consulta fica na lista e nos totais, sem data (A4a). */
const SEM_DATA_PLACEHOLDER = 'Data de início não informada (placeholder do sistema antigo)';

/** A consulta cujo fim vem antes do início; a tela de Consultas procura essa pendência. */
const ENDED_BEFORE_START = 'Encerramento anterior ao início registrado';

/**
 * Evidência da modalidade pelo idFormaPagto legado (R4). Só o código 8 ("Pré Pago") prova pré-pago; nenhum código
 * prova pós-pago.
 */
const MODALITY_EVIDENCE = new Map([['8', 'pre']]);

function catalogValue(code, labels) {
  const id = code === null || code === undefined ? null : String(code);
  return { code: id, label: id === null ? null : (labels && labels[id]) ?? null };
}

/** Rótulo da cliente: usuarios.nome_id, senão "Cliente {id}"; nunca o nome civil. */
function legacyClientLabel(clientId, identification) {
  const label = (identification && identification.trim()) || null;
  return { clientLabel: label ?? (clientId ? `Cliente ${clientId}` : null), clientLabelMissing: label === null };
}

/** Modelo histórico independente de uma linha de tbl_consultas. `catalogs` = { channels, paymentOptions, banks } (id -> rótulo). */
function readLegacyConsultation(row, catalogs = {}) {
  const id = requireLegacyId(row.idConsulta, 'tbl_consultas.idConsulta');
  const undatedStart = inicioSemData(row.iniConsulta);
  const startedAtLocal = undatedStart ? null : legacyLocalDateTime(row.iniConsulta);
  // Com o início placeholder o fim também é só hora: nenhum dos dois é data (a duração gravada em tmpConsulta continua valendo).
  const fimGravado = undatedStart ? null : legacyLocalDateTime(row.fimConsulta);
  const recordedMinutes = Number(row.tmpConsulta) === -1 ? minutosDasDatas(startedAtLocal, fimGravado) : legacyMinutes(row.tmpConsulta);
  const endedAtLocal = fimCorrigidoPorVirada(startedAtLocal, fimGravado, recordedMinutes) ?? fimGravado;
  const recordedAmount = legacyMoney(row.valor_consulta);
  const issues = [];
  if (!legacyId(row.idUsuario)) issues.push('Referência da cliente ausente ou inválida');
  if (!legacyId(row.idTarologo)) issues.push('Referência do profissional ausente ou inválida');
  if (undatedStart) issues.push(SEM_DATA_PLACEHOLDER);
  else if (!startedAtLocal) issues.push('Início não informado ou inválido');
  if (!endedAtLocal && !undatedStart) issues.push('Encerramento não informado ou inválido');
  if (endedAtLocal && startedAtLocal && endedAtLocal < startedAtLocal) issues.push(ENDED_BEFORE_START);
  if (recordedMinutes === null) issues.push('Minutagem não informada ou inválida');
  if (recordedAmount === null) issues.push('Valor não informado ou inválido');
  return {
    origin: 'legacy', sourceTable: 'tbl_consultas', readOnly: true, id,
    clientId: legacyId(row.idUsuario), tarotId: legacyId(row.idTarologo),
    clientIdentification: legacyText(row.nome_id), tarotName: rotuloTarologo(legacyId(row.idTarologo), row.nmuTarologo),
    consultationDateLocal: legacyLocalDateTime(row.dtConsulta), startedAtLocal, endedAtLocal, undatedStart,
    recordedMinutes, durationSeconds: recordedMinutes === null ? null : recordedMinutes * 60,
    recordedAmount, unitValue: null, commissionRate: null, commissionAmount: null,
    status: null,
    paymentProfile: row.idFormaPagto !== null && row.idFormaPagto !== undefined && String(row.idFormaPagto) === '8' ? 'Pré-paga' : null,
    channel: catalogValue(row.idFormaConsulta, catalogs.channels), paymentOption: catalogValue(row.idFormaPagto, catalogs.paymentOptions),
    internalObservation: legacyNoteText(row.obsConsulta), attendantLabel: legacyText(row.nmuAtendente),
    lastEditorLabel: legacyText(row.atendenteFinalizou), updatedAtLocal: legacyLocalDateTime(row.dtManutencao),
    appliedBonusMinutes: legacyMinutes(row.vlBonus), discountPercent: legacyMinutes(row.vlDesconto),
    recordedAbatement: legacyMoney(row.abatimento),
    rawTiming: { start: row.iniConsulta ?? null, end: row.fimConsulta ?? null, minutes: row.tmpConsulta ?? null },
    issues,
  };
}

function elapsedMinutes(startedAtLocal, nowLocal) {
  // Os dois textos são o mesmo relógio de parede; ler como UTC cancela qualquer fuso.
  const diff = Date.parse(`${nowLocal}Z`) - Date.parse(`${startedAtLocal}Z`);
  return Math.max(0, Math.floor(diff / 60000));
}

function toRealConsultation(row, operationalDate, situation, nowLocal) {
  const finished = situation === 'finalizada';
  // O legado grava 0.00 enquanto a consulta está aberta: esse zero não é preço (D10).
  const recordedAmount = !finished && row.recordedAmount === '0.00' ? null : row.recordedAmount;
  return {
    id: row.id, clientId: row.clientId, ...legacyClientLabel(row.clientId, row.clientIdentification),
    tarotId: row.tarotId, tarotName: row.tarotName,
    startedAtLocal: row.startedAtLocal, endedAtLocal: row.endedAtLocal, operationalDate, situation,
    ...(row.undatedStart ? { undatedStart: true } : {}),
    elapsedMinutes: finished || row.startedAtLocal === null ? null : elapsedMinutes(row.startedAtLocal, nowLocal),
    recordedMinutes: row.recordedMinutes, recordedAmount,
    amountState: !finished ? 'em-andamento' : recordedAmount === null ? 'nao-informado' : 'registrado',
    modality: MODALITY_EVIDENCE.get(row.paymentOption.code ?? '') ?? null,
    discountPercent: row.discountPercent, bonusMinutes: row.appliedBonusMinutes, abatement: row.recordedAbatement,
    paymentOption: row.paymentOption, channel: row.channel, issues: [...row.issues],
  };
}

function byStart(a, b) {
  return (a.startedAtLocal ?? '').localeCompare(b.startedAtLocal ?? '') || Number(a.id) - Number(b.id);
}

/** O recorte inteiro de consultas (`input` = { rows, range, nowLocal, tarotId? }), antes de qualquer página. */
function buildRealConsultationsCut(input) {
  const { range, nowLocal } = input;
  const today = localOperationalDateKey(nowLocal);
  const includesToday = range.start <= today && today <= range.end;
  const inProgress = [];
  const finished = [];
  const earlier = [];

  // Consulta sem data (A4a) só entra no recorte da história inteira: num recorte por dia ela não tem dia.
  const wholeHistory = range.start <= '0001-01-01';
  for (const row of input.rows) {
    if (input.tarotId !== undefined && row.tarotId !== input.tarotId) continue;
    if (!row.startedAtLocal) {
      if (row.undatedStart && wholeHistory && row.recordedMinutes !== null) finished.push(toRealConsultation(row, null, 'finalizada', nowLocal));
      continue;
    }
    const day = localOperationalDateKey(row.startedAtLocal);
    const open = row.endedAtLocal === null || row.recordedMinutes === null;
    if (day >= range.start && day <= range.end) {
      if (open) inProgress.push(toRealConsultation(row, day, 'em-curso', nowLocal));
      else finished.push(toRealConsultation(row, day, 'finalizada', nowLocal));
    } else if (open && day < range.start && includesToday) {
      earlier.push(toRealConsultation(row, day, 'aberta-antes', nowLocal));
    }
  }
  inProgress.sort(byStart);
  finished.sort((a, b) => byStart(b, a));
  earlier.sort(byStart);

  return {
    range: { start: range.start, end: range.end },
    inProgress, finished, openSinceEarlier: includesToday ? { items: earlier } : null,
    totals: {
      inProgress: inProgress.length, openSinceEarlier: includesToday ? earlier.length : 0, finished: finished.length,
      recordedAmount: sumMoney(finished.map((item) => item.recordedAmount)),
      recordedMinutes: finished.reduce((total, item) => total + (item.recordedMinutes ?? 0), 0),
      missingAmount: finished.filter((item) => item.recordedAmount === null).length,
      missingMinutes: finished.filter((item) => item.recordedMinutes === null).length,
    },
  };
}

module.exports = { SEM_DATA_PLACEHOLDER, ENDED_BEFORE_START, MODALITY_EVIDENCE, buildRealConsultationsCut, legacyClientLabel, readLegacyConsultation };
