'use strict';

/**
 * Estilo da planilha de Consultas: porte fiel de `features/consultas/consultation-export-style.ts` (B). Só apresentação:
 * tons de coluna/célula/linha, larguras mínimas e quais colunas são decimais, em negrito ou centralizadas.
 */

/** Opções de `createXlsx` para os cabeçalhos e as linhas dadas (a B chama de `consultationExportStyle`). */
function estiloConsultas(headers, rows) {
  const compact = headers.includes('$ Consulta');
  const aliases = { '$ Consulta': 'Valor da consulta', 'A confirmar': 'Pagamento a confirmar', 'Saldo ant.': 'Saldo anterior', Previsto: 'Tempo previsto', 'Máx.': 'Tempo máximo' };
  headers = headers.map((header) => aliases[header] || header);
  const columnTones = {};
  const headerTones = {};
  const centerHeaders = new Set(['Data', 'Id', 'ID', 'ID da cliente', 'Pré/Pós', 'Perfil', 'Início', 'Fim', 'Previsto (min)', 'Tempo (min)', 'Tempo', 'Tempo previsto', 'Tempo máximo', 'Valor/min', 'Pagamento', 'Pagamento a confirmar', 'Saldo', 'Saldo anterior', 'Cobertura (min)', 'Valor da consulta', 'Saldo cliente', 'Situação']);
  headers.forEach((header, index) => {
    if (['Início', 'Fim', 'Previsto (min)', 'Tempo (min)', 'Tempo', 'Tempo previsto', 'Tempo máximo', 'Valor/min'].includes(header)) headerTones[index] = 'time';
    if (['Previsto (min)', 'Tempo (min)', 'Tempo', 'Tempo previsto', 'Tempo máximo'].includes(header)) columnTones[index] = 'time';
    if (header === 'Valor da consulta') columnTones[index] = 'charge';
    if (header === 'Saldo cliente' || header === 'Saldo' || header === 'Saldo anterior') columnTones[index] = 'balance';
    if (header === 'Pagamento') columnTones[index] = 'entry';
    if (header === 'Pagamento a confirmar') columnTones[index] = 'pending';
    if (header === 'Situação') headerTones[index] = 'status';
  });
  const statusIndex = headers.indexOf('Situação');
  const coverageIndex = headers.indexOf('Cobertura');
  const clientIndex = headers.indexOf('Cliente');
  const actualIndex = headers.findIndex((h) => h === 'Tempo' || h === 'Tempo (min)');
  const expectedIndex = headers.findIndex((h) => h === 'Tempo previsto' || h === 'Previsto (min)');
  const cellTones = [];
  const rowTones = [];
  for (const row of rows) {
    const status = String(row[statusIndex] || '');
    const coverage = String(row[coverageIndex] || '');
    const invalid = ['Anulada', 'Erro', 'Não houve'].includes(status);
    const tones = {};
    if (!invalid && typeof row[actualIndex] === 'number' && typeof row[expectedIndex] === 'number' && row[actualIndex] !== row[expectedIndex]) tones[expectedIndex] = 'warning';
    if (status === 'Em curso') {
      if (statusIndex >= 0) tones[statusIndex] = 'active';
      if (clientIndex >= 0) tones[clientIndex] = 'active';
    }
    // Um cancelamento pela cliente ainda pode ser cobrado. Só os registros inválidos saem riscados.
    if (status === 'Cancelada' && statusIndex >= 0) tones[statusIndex] = 'warning';
    if (status === 'Devolvida' && statusIndex >= 0) tones[statusIndex] = 'muted';
    if (!invalid && coverageIndex >= 0) {
      if (coverage === 'Sem pagamento' || coverage === 'Pagamento em conferência' || coverage.includes('faltam')) tones[coverageIndex] = 'warning';
      else if (coverage.startsWith('Cortesia')) tones[coverageIndex] = 'info';
      else if (coverage.startsWith('Bônus')) tones[coverageIndex] = 'benefit';
      else if (coverage.startsWith('Crédito') || coverage.startsWith('Complemento')) tones[coverageIndex] = 'info';
      else if (coverage === 'Não se aplica') tones[coverageIndex] = 'muted';
    }
    cellTones.push(tones);
    rowTones.push(invalid ? 'cancelled' : undefined);
  }
  const indices = (nomes) => headers.flatMap((header, index) => (nomes.includes(header) ? [index] : []));
  return {
    styled: true, columnTones, headerTones, cellTones, rowTones, mutedCancelledRows: true, headerRowHeight: compact ? 42 : 30,
    decimalColumns: indices(['Valor da consulta', 'Saldo cliente', 'Valor/min', 'Pagamento', 'Pagamento a confirmar', 'Saldo', 'Saldo anterior']),
    boldColumns: indices(['Id', 'ID', 'ID da cliente', 'Cliente', 'Tempo (min)', 'Tempo']),
    centerColumns: headers.flatMap((header, index) => (centerHeaders.has(header) ? [index] : [])),
  };
}

/** Larguras com os mínimos da B (`consultationStyledWidths`). */
function largurasConsultas(headers, widths) {
  if (headers.includes('$ Consulta')) {
    const compact = { Data: 11, Id: 8, Cliente: 30, 'Saldo ant.': 12, 'Taróloga': 15, Tempo: 9, 'Valor/min': 11, '$ Consulta': 13, Pagamento: 14, 'A confirmar': 13, Saldo: 12, 'Pré/Pós': 9, Canal: 13, 'Início': 9, Fim: 9, Previsto: 11, 'Máx.': 9, 'Situação': 15, 'Em nome de': 24, 'Observação': 62 };
    return headers.map((header, index) => compact[header] || widths[index] || 18);
  }
  const minimums = { 'ID da cliente': 17, 'Tempo (min)': 16, 'Previsto (min)': 19, 'Valor da consulta': 23, 'Saldo cliente': 18 };
  return headers.map((header, index) => Math.max(widths[index] || 18, minimums[header] || 0));
}

module.exports = { estiloConsultas, largurasConsultas };
