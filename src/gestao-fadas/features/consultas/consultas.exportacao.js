'use strict';

/**
 * Exportação das Consultas (R23): porte de `features/consultas/real-consultations-export.ts` (B). Monta a planilha
 * (cabeçalhos, larguras, estilos, linha de totais, subtítulo, nome do arquivo) do recorte INTEIRO, todas as páginas, na
 * ordem da tela: em curso (do dia `today`) -> sem fim no período (em curso de outro dia) -> sem fim de antes ->
 * finalizadas. O arquivo sai de `_comum/exportacao.js`; a rota é `GET /consultas/export` (controller).
 */

const { rotuloData: dateKeyLabel } = require('../../_comum/dia-operacional');
const { TOTALS_CAPTION, clientCell, moneyCell, periodLabel, readAtLabel, realExportName } = require('../../_comum/exportacao');
const { NOT_INFORMED, catalogText, countText, dayMonth, hourMinute, plural } = require('../../_comum/texto');
const { ENDED_BEFORE_START } = require('./helpers/leitura-legado');
const { estiloConsultas, largurasConsultas } = require('./helpers/estilo-exportacao');

const GRUPOS = {
  running: 'Em curso',
  'open-in-cut': 'Sem fim registrado no período',
  'open-before': 'Sem fim registrado antes do período',
  finished: 'Finalizada',
};

/** Cabeçalhos da planilha da B, na ordem das colunas. */
const CABECALHOS = ['Situação', 'Data', 'Início', 'Fim', 'Dia operacional', 'ID da cliente', 'Cliente', 'Tempo (min)', 'Tarólogo',
  'Forma / regime', 'Canal', 'Valor da consulta', 'Desconto', 'Bônus (min)', 'Abatimento'];

/** Os itens do recorte inteiro (todas as páginas) com o grupo de cada um, na ordem da planilha da B. */
function itensParaExportacao({ cut, today }) {
  const running = cut.inProgress.filter((item) => item.operationalDate === today);
  const openInCut = cut.inProgress.filter((item) => item.operationalDate !== today);
  const openBefore = (cut.openSinceEarlier && cut.openSinceEarlier.items) || [];
  return [
    ...running.map((item) => ({ group: 'running', groupLabel: GRUPOS.running, item })),
    ...openInCut.map((item) => ({ group: 'open-in-cut', groupLabel: GRUPOS['open-in-cut'], item })),
    ...openBefore.map((item) => ({ group: 'open-before', groupLabel: GRUPOS['open-before'], item })),
    ...cut.finished.map((item) => ({ group: 'finished', groupLabel: GRUPOS.finished, item })),
  ];
}

const WIDTHS = [20, 13, 9, 13, 16, 14, 30, 16, 18, 16, 13, 18, 11, 12, 13];
const coluna = (cabecalho) => CABECALHOS.indexOf(cabecalho);

function elapsedText(minutes) {
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    return `${days} ${days === 1 ? 'dia' : 'dias'}`;
  }
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
  return `${minutes} min`;
}

// O fim só para a finalizada, com o dia quando virou a meia-noite, como a tela escreve as horas.
function endCell(item, group) {
  if (group !== 'finished' || item.endedAtLocal === null) return null;
  const end = item.startedAtLocal?.slice(0, 10) === item.endedAtLocal.slice(0, 10)
    ? hourMinute(item.endedAtLocal) : `${dayMonth(item.endedAtLocal.slice(0, 10))} ${hourMinute(item.endedAtLocal)}`;
  return item.issues.includes(ENDED_BEFORE_START) ? `${end} · fim antes do início` : end;
}

function minutesCell(item, group) {
  if (group === 'running') return item.elapsedMinutes === null ? NOT_INFORMED : `Decorrido: ${elapsedText(item.elapsedMinutes)}`;
  return item.recordedMinutes ?? NOT_INFORMED;
}

// O valor como gravado; sem fim e sem valor é em andamento, nunca grátis nem zero (D10).
function amountCell(item) {
  if (item.recordedAmount !== null) return Number(item.recordedAmount);
  if (item.amountState !== 'em-andamento') return NOT_INFORMED;
  return item.modality === 'pos' ? 'PÓS · Em andamento' : 'Em andamento';
}

function rowOf(item, group) {
  const day = item.startedAtLocal?.slice(0, 10) ?? null;
  return [
    GRUPOS[group], day ? dateKeyLabel(day) : NOT_INFORMED, item.startedAtLocal ? hourMinute(item.startedAtLocal) : NOT_INFORMED, endCell(item, group),
    item.operationalDate ? dateKeyLabel(item.operationalDate) : NOT_INFORMED, item.clientId ?? NOT_INFORMED, clientCell(item), minutesCell(item, group),
    item.tarotName ?? NOT_INFORMED, catalogText(item.paymentOption) ?? NOT_INFORMED, catalogText(item.channel) ?? NOT_INFORMED, amountCell(item),
    // O percentual como fração, para a célula guardar o número e mostrar "10,00%".
    item.discountPercent === null ? NOT_INFORMED : item.discountPercent / 100, item.bonusMinutes ?? NOT_INFORMED, moneyCell(item.abatement),
  ];
}

/** A planilha (RealExportSheet) do recorte. `entrada` = { cut, today, readAt, tarot: { id, name } | null }. */
function exportacaoDeConsultas({ cut, today, readAt, tarot }) {
  const running = cut.inProgress.filter((item) => item.operationalDate === today);
  const openInCut = cut.inProgress.filter((item) => item.operationalDate !== today);
  const openBefore = cut.openSinceEarlier?.items ?? [];
  const rows = [
    ...running.map((item) => rowOf(item, 'running')), ...openInCut.map((item) => rowOf(item, 'open-in-cut')),
    ...openBefore.map((item) => rowOf(item, 'open-before')), ...cut.finished.map((item) => rowOf(item, 'finished')),
  ];
  const { totals } = cut;
  const summaryRow = CABECALHOS.map((header, index) =>
    (index === 0 ? TOTALS_CAPTION : header === 'Tempo (min)' ? totals.recordedMinutes : header === 'Valor da consulta' ? Number(totals.recordedAmount) : null));
  const subtitle = [
    `Consultas · ${periodLabel(cut.range)}`, tarot ? tarot.name ?? `tarólogo ${tarot.id}` : 'todos os tarólogos', readAtLabel(readAt),
    ...(cut.openSinceEarlier ? [`${countText(running.length)} em curso`] : []),
    ...(openInCut.length > 0 ? [`${countText(openInCut.length)} sem fim no período`] : []),
    ...(openBefore.length > 0 ? [`${countText(openBefore.length)} sem fim de antes do período, fora dos totais`] : []),
    plural(totals.finished, 'finalizada', 'finalizadas'),
    ...(totals.missingAmount + totals.missingMinutes > 0
      ? [`não informados: ${plural(totals.missingAmount, 'valor', 'valores')} e ${plural(totals.missingMinutes, 'minutagem', 'minutagens')}`] : []),
  ].join(' · ');
  const style = estiloConsultas(CABECALHOS, rows);
  return {
    filename: realExportName(['consultas', ...(tarot ? ['tarologo', tarot.id] : ['todos'])], cut.range),
    sheetName: 'Consultas', headers: CABECALHOS, rows, widths: largurasConsultas(CABECALHOS, WIDTHS),
    options: {
      ...style, summaryRow, subtitle,
      decimalColumns: [...(style.decimalColumns ?? []), coluna('Abatimento')],
      percentageColumns: [coluna('Desconto')],
    },
  };
}

module.exports = { GRUPOS, CABECALHOS, itensParaExportacao, exportacaoDeConsultas };
