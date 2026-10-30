'use strict';

/**
 * Exportação dos Recebimentos (R23): porte de `features/finance/real-receipts-export.ts` e de `financial-export-style.ts`
 * (B). O recorte INTEIRO, todas as páginas, na ordem e nas colunas da tela. O valor vai para a coluna do total que alimenta
 * (Confirmado, Informado, Fora dos totais), então a linha de totais (o `summary` do recorte) fica sobre os valores que soma.
 * Lançamento que o legado não prova é "Data do lançamento não disponível" (D8). O arquivo sai de `_comum/exportacao.js`.
 */

const { rotuloData: dateKeyLabel } = require('../../_comum/dia-operacional');
const { TOTALS_CAPTION, clientCell, moneyCell, periodLabel, readAtLabel, realExportName } = require('../../_comum/exportacao');
const { NOT_INFORMED, catalogText, countText, dayMonth, hourMinute, plural } = require('../../_comum/texto');
const { originName } = require('./pagamentos.model');

const HEADERS = ['Pago em', 'Lançado em', 'ID da cliente', 'Cliente', 'Confirmado', 'Informado', 'Fora dos totais', 'Conta', 'Forma', 'Situação', 'Origem'];
const WIDTHS = [13, 22, 14, 30, 15, 15, 16, 18, 16, 18, 34];
const column = (header) => HEADERS.indexOf(header);
const VALUE_COLUMNS = [column('Confirmado'), column('Informado'), column('Fora dos totais')];

// Os rótulos e as marcas da tela (real-receipts-view.tsx, R5 revisada pela D4), como tons que o gerador tem.
const SITUATIONS = {
  confirmado: { label: 'Confirmado', value: 'Confirmado' },
  informado: { label: 'Informado', value: 'Informado', tone: 'warning' },
  'nao-localizado': { label: 'Não localizado', value: 'Fora dos totais', tone: 'muted' },
  'conferir-origem': { label: 'Conferir a origem', value: 'Fora dos totais', tone: 'missing' },
};

// `creditRefundHeaders` de features/finance/payment-credit-refund.ts: só entra no estilo financeiro comum da B.
const CREDIT_REFUND_HEADERS = ['Crédito retirado (min)', 'Crédito retirado (R$)', 'Saldo anterior do pagamento (min)', 'Saldo anterior do pagamento (R$)',
  'Saldo restante do pagamento (min)', 'Saldo restante do pagamento (R$)'];

/** Estilo financeiro comum (`financialExportStyle` da B). */
function estiloFinanceiro(headers) {
  const decimals = ['Entrada', 'Saída', 'Saldo inicial', 'Saldo cliente', 'Valor/min', 'Consulta', 'Pagamento', 'Saídas', 'Saldo', ...CREDIT_REFUND_HEADERS];
  const centered = [...decimals, 'Data', 'ID da cliente', 'Tempo (min)'];
  const columnTones = {};
  headers.forEach((header, index) => {
    if (['Entrada', 'Pagamento'].includes(header)) columnTones[index] = 'entry';
    if (['Saída', 'Saídas', 'Consulta', 'Crédito retirado (R$)', 'Crédito retirado (min)'].includes(header)) columnTones[index] = 'exit';
    if (['Saldo inicial', 'Saldo cliente', 'Saldo', ...CREDIT_REFUND_HEADERS.filter((item) => item.startsWith('Saldo'))].includes(header)) columnTones[index] = 'balance';
  });
  return {
    styled: true, headerRowHeight: 42, columnTones,
    decimalColumns: headers.flatMap((h, i) => (decimals.includes(h) ? [i] : [])),
    boldColumns: headers.flatMap((h, i) => (['ID da cliente', 'Cliente', 'Tempo (min)'].includes(h) ? [i] : [])),
    centerColumns: headers.flatMap((h, i) => (centered.includes(h) ? [i] : [])),
  };
}

function launchCell(item) {
  const launched = item.launchedAtLocal;
  if (launched === null) return 'Data do lançamento não disponível';
  const when = `${dateKeyLabel(launched.slice(0, 10))} ${hourMinute(launched)}`;
  return item.launchOperationalDate && item.launchOperationalDate !== launched.slice(0, 10) ? `${when} · dia operacional ${dayMonth(item.launchOperationalDate)}` : when;
}

function rowOf(item) {
  const situation = SITUATIONS[item.situation];
  const row = [
    item.paidOn ? dateKeyLabel(item.paidOn) : 'Data do pagamento não disponível', launchCell(item), item.clientId ?? NOT_INFORMED, clientCell(item),
    null, null, null, catalogText(item.bank) ?? 'Banco não informado', catalogText(item.method) ?? 'forma não informada', situation.label,
    item.origins.map(originName).join(' + '),
  ];
  row[column(situation.value)] = moneyCell(item.amount);
  return row;
}

/** A planilha (RealExportSheet) do recorte. `entrada` = { cut, readAt }. */
function exportacaoDeRecebimentos({ cut, readAt }) {
  const rows = cut.receipts.map(rowOf);
  const { summary, range } = cut;
  const summaryRow = HEADERS.map((header, index) =>
    (index === 0 ? TOTALS_CAPTION : header === 'Confirmado' ? Number(summary.confirmedTotal) : header === 'Informado' ? Number(summary.informedTotal) : null));
  const { counts } = summary;
  const subtitle = [
    `Pagamentos · ${periodLabel(range)}`, range.by === 'paid' ? 'pela data paga' : 'lançados das 06h às 06h', readAtLabel(readAt),
    plural(counts.confirmado, 'confirmado', 'confirmados'), plural(counts.informado, 'informado', 'informados'),
    plural(counts['nao-localizado'], 'não localizado', 'não localizados'), `${countText(counts['conferir-origem'])} para conferir a origem`,
  ].join(' · ');
  const style = estiloFinanceiro(HEADERS);
  const columnTones = { ...style.columnTones, [column('Confirmado')]: 'entry', [column('Informado')]: 'pending' };
  const situationColumn = column('Situação');
  return {
    filename: realExportName(['financeiro', 'todos', ...(range.by === 'launched' ? ['lancados'] : [])], range),
    sheetName: 'Pagamentos', headers: HEADERS, rows, widths: WIDTHS,
    options: {
      ...style, columnTones, headerTones: { [situationColumn]: 'status' }, summaryRow, subtitle,
      decimalColumns: [...(style.decimalColumns ?? []), ...VALUE_COLUMNS],
      centerColumns: [...(style.centerColumns ?? []), column('Pago em'), column('Lançado em'), ...VALUE_COLUMNS, situationColumn],
      cellTones: cut.receipts.map((item) => {
        const tone = SITUATIONS[item.situation].tone;
        return tone ? { [situationColumn]: tone } : {};
      }),
    },
  };
}

module.exports = { HEADERS, WIDTHS, exportacaoDeRecebimentos };
