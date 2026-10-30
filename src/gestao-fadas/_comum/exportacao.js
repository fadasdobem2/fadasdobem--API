'use strict';

/**
 * Porte de `features/shared/real-export.ts` e da entrega de `serveRealExport` (features/auth/real-access.server.ts) do
 * suspiro/B: textos de célula, rótulos de período/leitura, nome do arquivo, limpeza de caracteres proibidos em XML 1.0,
 * o arquivo `.xlsx` (gerador em `./xlsx.js`) e a ENTREGA com a trilha `operations.export.download` em `gf_auditoria`
 * gravada ANTES do arquivo: sem a linha, 503 e nenhum arquivo.
 */

const { createHash } = require('crypto');
const AppError = require('../../utils/AppError');
const { NOT_INFORMED } = require('./texto');
const { timestampSaoPaulo, rotuloData } = require('./dia-operacional');

const { createXlsx, XLSX_TIPO } = require('./xlsx');

const TOTALS_CAPTION = 'Totais do período';

/** Decimal em texto do legado como o número que a célula soma; o ausente pela palavra, nunca zero. */
const moneyCell = (amount) => (amount === null ? NOT_INFORMED : Number(amount));

/** A cliente como a tela a mostra: o rótulo, marcado quando o registro legado tem ID e não tem nome. */
const clientCell = (item) => {
  if (item.clientLabel === null) return NOT_INFORMED;
  return item.clientLabelMissing && item.clientId ? `${item.clientLabel} · sem nome registrado` : item.clientLabel;
};

const periodLabel = (range) =>
  range.start === range.end ? rotuloData(range.start) : `${rotuloData(range.start)} a ${rotuloData(range.end)}`;

/** O instante da leitura (UTC ISO) no relógio de São Paulo, ao segundo. */
function readAtLabel(readAt) {
  const local = timestampSaoPaulo(new Date(readAt));
  return `lido em ${rotuloData(local.slice(0, 10))} ${local.slice(11, 19)}`;
}

/** O nome no padrão de excel-download-name.ts: as partes unidas por "_", depois o dia ou "início_a_fim". */
function realExportName(parts, range) {
  const period = range.start === range.end ? range.start : `${range.start}_a_${range.end}`;
  return `${[...parts, period].join('_')}.xlsx`;
}

// O legado guarda texto livre; um caractere de controle colado num nome não cabe em XML 1.0. Dos controles C0 ficam só
// tab, LF e CR; U+FFFE, U+FFFF e substituto solto também saem.
const NOT_IN_XML = /(?![\t\n\r\u007F-\u009F])[\p{Cc}\p{Cs}￾￿]/gu;
const limparXml = (texto) => texto.replace(NOT_IN_XML, '');
const xmlCell = (value) => (typeof value === 'string' ? limparXml(value) : value);

/** O .xlsx de uma planilha (RealExportSheet) pelo gerador das planilhas aprovadas, com o texto do legado legível como XML. */
function realExportFile(sheet) {
  const { options } = sheet;
  return createXlsx(sheet.sheetName, sheet.headers, sheet.rows.map((row) => row.map(xmlCell)), sheet.widths, {
    ...options, summaryRow: options.summaryRow.map(xmlCell), subtitle: options.subtitle.replace(NOT_IN_XML, ''),
  });
}

const indisponivel = () => new AppError('Não foi possível acessar o serviço. Tente novamente.', 503, { codigo: 'SERVICE_UNAVAILABLE' });

/** Auditoria sobre a conexão de escrita (só gf_*, flag GESTAO_FADAS_ESCRITA_ENABLED). Carregada sob demanda. */
function auditoriaPadrao() {
  const { criarAuditoria } = require('./auditoria');
  const { executarAvulso } = require('../novo/escritor');
  return criarAuditoria({ execute: executarAvulso });
}

/**
 * Constrói o arquivo, grava `operations.export.download` (conta, função, tela, recorte e nº de linhas; entidade_id = SHA-256
 * do arquivo; nada da cliente) e SÓ ENTÃO envia. Qualquer falha de gravação (escrita desligada inclusive) é 503, sem arquivo.
 * `ator` = { accountId, role }; `exportacao` = { screen, cut, sheet }; `dependencias.auditoria` serve à verificação offline.
 */
async function entregarExportacao(res, ator, exportacao, dependencias = {}) {
  const arquivo = realExportFile(exportacao.sheet);
  try {
    const auditoria = dependencias.auditoria || auditoriaPadrao();
    await auditoria.adicionar({
      actorUserId: ator.accountId,
      actorRole: ator.role,
      action: 'operations.export.download',
      entity: exportacao.screen,
      entityId: createHash('sha256').update(arquivo).digest('hex'),
      after: { ...exportacao.cut, rows: exportacao.sheet.rows.length },
    });
  } catch (_e) {
    throw indisponivel();
  }
  // O nome é ASCII por construção (realExportName): não precisa de forma codificada.
  res.status(200);
  res.set({ 'Content-Type': XLSX_TIPO, 'Content-Disposition': `attachment; filename="${exportacao.sheet.filename}"`, 'Cache-Control': 'no-store' });
  return res.end(arquivo);
}

module.exports = { realExportFile, entregarExportacao, TOTALS_CAPTION, NOT_IN_XML, moneyCell, clientCell, periodLabel, readAtLabel, realExportName, limparXml, xmlCell };
