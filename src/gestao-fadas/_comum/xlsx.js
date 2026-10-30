'use strict';

/**
 * Gerador de .xlsx sem dependência externa: porte fiel de `lib/xlsx.ts` (suspiro/B). Escreve o OOXML à mão e o empacota
 * num ZIP sem compressão (método "stored"), então a saída é BYTE A BYTE a da B para as mesmas entradas.
 * Diferença única: devolve um `Buffer` (a B devolve um `Blob`, que só existe no navegador/Workers); o tipo do arquivo
 * fica em `XLSX_TIPO`. `downloadXlsx` (âncora no DOM) não se aplica ao servidor e não foi portado.
 *
 * `CellValue` = string | number | null | undefined. As opções (`options`) são as de `XlsxOptions` da B: decimalColumns,
 * dateColumns, precisionColumns, percentageColumns, styled, boldColumns, columnTones, headerTones, mutedCancelledRows,
 * rowTones, cellTones, centerColumns, summaryRow, subtitle, headerRowHeight, dataRowHeights.
 */

const XLSX_TIPO = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

/** Índice de coluna (base 0) -> letra: 0 = A, 26 = AA. */
function columnName(index) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (value) => [value & 255, (value >>> 8) & 255];
const u32 = (value) => [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255];

/** ZIP sem compressão: cabeçalhos locais, diretório central e o fim do diretório, como createZip da B. */
function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const crc = crc32(data);
    const local = Buffer.from([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0),
      ...name, ...data,
    ]);
    localParts.push(local);
    centralParts.push(Buffer.from([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name,
    ]));
    offset += local.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.from([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

const FONT_COLORS = ['FF47354E', 'FFFFFFFF', 'FF47354E', 'FF176344', 'FFA32C4C', 'FF68448B', 'FF94601E', 'FF665970', 'FF164E70', 'FF195A3D', 'FF613B85', 'FF535660'];
const FILL_COLORS = [
  'FF5D3776', 'FFFFFFFF', 'FFF0E8F7', 'FFE7B0CB', 'FFF3CA94', 'FFD4CFD8', 'FFF0D587', 'FFF2CBDE', 'FFFBE2BE', 'FFFAE8B0',
  'FF236D4F', 'FFA23555', 'FF68448B', 'FFE8E2EB', 'FFE3D3EF', 'FFD5BEE8', 'FFFFE8B9', 'FFF6C2CE',
  // Entradas acrescentadas para preservar os estilos das exportações financeiras (como na B).
  'FF205F7A', 'FF305F54', 'FFE3EFFA', 'FFCCDFEF', 'FFFCE2EA', 'FFF3C9D8', 'FFBFE3CF', 'FFD0E5F5', 'FFDFC9F0', 'FFE1DFE4',
  'FF825215', 'FFECF7EF', 'FFD7EBDD', 'FFFFF6E3',
];
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** Fábrica de estilos (`cellXfs`): cada combinação fonte|preenchimento|formato|alinhamento vira um índice, reaproveitado. */
function criarEstilos(options, headers) {
  const styles = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const lookup = new Map([['0|0|0|left', 0]]);
  const hasSummary = Boolean(options?.summaryRow);
  const hasSubtitle = Boolean(options?.subtitle);
  const subtitleIndex = hasSummary ? 1 : 0;
  const headerRowIndex = (hasSummary ? 1 : 0) + (hasSubtitle ? 1 : 0);
  const bodyStartIndex = headerRowIndex + 1;

  function cellStyle(rowIndex, columnIndex, value) {
    const numeric = typeof value === 'number';
    const decimal = numeric && options?.decimalColumns?.includes(columnIndex);
    const tone = options?.columnTones?.[columnIndex];
    const headerTone = options?.headerTones?.[columnIndex] || tone;
    const summary = hasSummary && rowIndex === 0;
    const header = rowIndex === headerRowIndex;
    const subtitle = hasSubtitle && rowIndex === subtitleIndex;
    const dataIndex = rowIndex - bodyStartIndex;
    const rowTone = dataIndex >= 0 ? options?.rowTones?.[dataIndex] : undefined;
    const cellTone = dataIndex >= 0 ? options?.cellTones?.[dataIndex]?.[columnIndex] : undefined;
    let font = summary || header ? 1 : 0;
    let fill = summary || header ? 2 : 0;
    if (options?.styled) {
      if (summary || header) {
        fill = headerTone === 'pending' ? 30 : headerTone === 'entry' ? 12 : headerTone === 'exit' || headerTone === 'charge' ? 13
          : headerTone === 'balance' ? 14 : headerTone === 'time' ? 20 : headerTone === 'status' ? 21 : 2;
      } else {
        fill = dataIndex % 2 === 0 ? 3 : 4;
        if (options.boldColumns?.includes(columnIndex)) font = 2;
        if (tone === 'entry') font = 3;
        if (tone === 'pending') { fill = dataIndex % 2 === 0 ? 33 : 18; font = 6; }
        if (tone === 'exit') font = 4;
        if (tone === 'time') { fill = dataIndex % 2 === 0 ? 22 : 23; font = 8; }
        if (tone === 'charge') { fill = dataIndex % 2 === 0 ? 24 : 25; font = 4; }
        if (tone === 'balance') {
          fill = dataIndex % 2 === 0 ? 17 : 16;
          font = numeric && value < 0 ? 4 : numeric && value === 0 ? 2 : 5;
        }
        if (cellTone === 'warning') { fill = 18; font = 6; }
        if (cellTone === 'missing') { fill = 19; font = 4; }
        if (cellTone === 'active') { fill = 26; font = 9; }
        if (cellTone === 'info') { fill = 27; font = 8; }
        if (cellTone === 'benefit') { fill = 28; font = 10; }
        if (cellTone === 'muted') { fill = 29; font = 11; }
        if (rowTone === 'cancelled') { font = 7; if (options.mutedCancelledRows) fill = 29; }
      }
    }
    // A legenda do total e as células sem uso ficam sem preenchimento; só as somas de fato levam cor.
    if ((summary || subtitle) && !numeric) { fill = 0; font = 2; }
    const format = numeric && options?.dateColumns?.includes(columnIndex) ? 164
      : numeric && options?.percentageColumns?.includes(columnIndex) ? 10
        : numeric && options?.precisionColumns?.includes(columnIndex) ? 165 : decimal ? 4 : 0;
    const alignment = options?.centerColumns?.includes(columnIndex) ? 'center' : numeric ? 'right' : 'left';
    const key = `${font}|${fill}|${format}|${alignment}|${numeric ? 'number' : 'text'}`;
    const present = lookup.get(key);
    if (present !== undefined) return present;
    const index = styles.length;
    styles.push(`<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${options?.styled ? 1 : 0}" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="${alignment}" vertical="center" indent="${options?.styled && alignment === 'left' ? 1 : 0}" wrapText="${numeric ? 0 : 1}"/></xf>`);
    lookup.set(key, index);
    return index;
  }
  return { styles, cellStyle, hasSummary, hasSubtitle, subtitleIndex, headerRowIndex, bodyStartIndex, headers };
}

/** `styles.xml`: formatos numéricos, fontes, preenchimentos, borda e os `cellXfs` montados até aqui. */
function stylesXml(options, styles) {
  const customFormats = [
    ...(options?.dateColumns?.length ? ['<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>'] : []),
    ...(options?.precisionColumns?.length ? ['<numFmt numFmtId="165" formatCode="0.00####"/>'] : []),
  ];
  const fonts = FONT_COLORS.map((color, index) => `<font>${[1, 2, 3, 4, 5, 6, 8, 9, 10].includes(index) ? '<b/>' : ''}${index === 7 ? '<strike/>' : ''}<sz val="${index === 1 ? 12 : 11}"/><color rgb="${color}"/><name val="Calibri"/></font>`).join('');
  const fills = FILL_COLORS.map((color) => `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('');
  return `${XML_DECL}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${customFormats.length ? `<numFmts count="${customFormats.length}">${customFormats.join('')}</numFmts>` : ''}<fonts count="${FONT_COLORS.length}">${fonts}</fonts><fills count="${FILL_COLORS.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fills}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFA18AAA"/></left><right style="thin"><color rgb="FFA18AAA"/></right><top style="thin"><color rgb="FFA18AAA"/></top><bottom style="medium"><color rgb="FF9079A1"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${styles.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SHEET_CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';

/** Planilha de uma aba. `rows` = linhas de CellValue; `columnWidths` em caracteres. Devolve o arquivo (Buffer). */
function createXlsx(sheetName, headers, rows, columnWidths = [], options) {
  const e = criarEstilos(options, headers);
  const allRows = [...(e.hasSummary ? [options.summaryRow] : []), ...(e.hasSubtitle ? [[options.subtitle]] : []), headers, ...rows];
  const columns = columnWidths.length
    ? `<cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>` : '';
  const sheetRows = allRows.map((row, rowIndex) => {
    const cells = headers.map((_, columnIndex) => {
      const value = row[columnIndex];
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      const style = e.cellStyle(rowIndex, columnIndex, value);
      if (typeof value === 'number') return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
      return `<c r="${reference}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${escapeXml(String(value ?? ''))}</t></is></c>`;
    }).join('');
    const altura = () => (rowIndex === e.headerRowIndex ? options.headerRowHeight || 30
      : (e.hasSummary && rowIndex === 0) || (e.hasSubtitle && rowIndex === e.subtitleIndex) ? 30
        : options.dataRowHeights?.[rowIndex - e.bodyStartIndex] || 36);
    return `<row r="${rowIndex + 1}"${options?.styled ? ` ht="${altura()}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  const firstSummaryValue = options?.summaryRow?.findIndex((value, index) => index > 0 && typeof value === 'number') ?? -1;
  const mergedRanges = [
    ...(e.hasSummary && firstSummaryValue > 1 ? [`A1:${columnName(firstSummaryValue - 1)}1`] : []),
    ...(e.hasSubtitle ? [`A${e.subtitleIndex + 1}:${columnName(headers.length - 1)}${e.subtitleIndex + 1}`] : []),
  ];
  const summaryMerge = mergedRanges.length ? `<mergeCells count="${mergedRanges.length}">${mergedRanges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
  const frozenRows = e.bodyStartIndex;
  const headerNumber = e.headerRowIndex + 1;
  const files = [
    { name: '[Content_Types].xml', content: `${XML_DECL}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${SHEET_CT}.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="${SHEET_CT}.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="${SHEET_CT}.styles+xml"/></Types>` },
    { name: '_rels/.rels', content: `${XML_DECL}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: 'xl/workbook.xml', content: `${XML_DECL}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL}"><sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `${XML_DECL}<Relationships xmlns="${PKG_REL}"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: stylesXml(options, e.styles) },
    { name: 'xl/worksheets/sheet1.xml', content: `${XML_DECL}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="${frozenRows}" topLeftCell="A${frozenRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/>${columns}<sheetData>${sheetRows}</sheetData><autoFilter ref="A${headerNumber}:${columnName(headers.length - 1)}${allRows.length}"/>${summaryMerge}</worksheet>` },
  ];
  return createZip(files);
}

module.exports = { XLSX_TIPO, createXlsx, createZip, columnName, crc32, escapeXml };
