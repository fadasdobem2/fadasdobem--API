'use strict';

/**
 * Verificação OFFLINE (sem banco, sem rede) da exportação XLSX do Gestão Fadas: o gerador (`_comum/xlsx.js`), os builders
 * de Consultas e Recebimentos, a entrega com auditoria ANTES do arquivo (`_comum/exportacao.js`) e as rotas.
 * Auditoria com executor falso em memória; a escrita real (GESTAO_FADAS_ESCRITA_ENABLED) nunca é ligada.
 *
 *   node scripts/verificar-gf-exportacao.js
 */

const assert = require('node:assert/strict');
const { createHash } = require('crypto');

delete process.env.GESTAO_FADAS_ESCRITA_ENABLED;
process.env.LEGADO_DB_HOST = process.env.LEGADO_DB_HOST || '127.0.0.1';
process.env.LEGADO_DB_NAME = process.env.LEGADO_DB_NAME || 'verificacao_offline';
process.env.LEGADO_DB_USER = process.env.LEGADO_DB_USER || 'verificacao';

const { createXlsx, XLSX_TIPO, columnName } = require('../src/gestao-fadas/_comum/xlsx');
const exportacao = require('../src/gestao-fadas/_comum/exportacao');
const consultas = require('../src/gestao-fadas/features/consultas/consultas.exportacao');
const consultasModelo = require('../src/gestao-fadas/features/consultas/consultas.model');
const consultasServico = require('../src/gestao-fadas/features/consultas/consultas.service');
const { lerConsultaLegado } = require('../src/gestao-fadas/features/consultas/helpers/leitura-legado');
const pagamentos = require('../src/gestao-fadas/features/pagamentos/pagamentos.exportacao');
const pagamentosModelo = require('../src/gestao-fadas/features/pagamentos/pagamentos.model');
const pagamentosServico = require('../src/gestao-fadas/features/pagamentos/pagamentos.service');
const { criarAuditoria } = require('../src/gestao-fadas/_comum/auditoria');
const AppError = require('../src/utils/AppError');

let ok = 0;
let falhas = 0;
let fila = Promise.resolve();
function teste(nome, fn) {
  fila = fila.then(async () => {
    try {
      await fn();
      ok += 1;
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas += 1;
      console.log(`  FALHOU  ${nome}\n${e && e.stack}`);
    }
  });
}

/** Entradas de um ZIP "stored" (sem compressão), lidas do diretório central. */
function lerZip(buf) {
  const fim = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const arquivos = {};
  for (let i = 0; i < n; i += 1) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const tam = buf.readUInt32LE(p + 24);
    const nomeLen = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + nomeLen);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    arquivos[nome] = buf.toString('utf8', ini, ini + tam);
    p += 46 + nomeLen;
  }
  return arquivos;
}

// Garante XML bem formado sem dependência: pilha de tags (sem comentários nem CDATA nestes arquivos).
function xmlBemFormado(texto) {
  const pilha = [];
  for (const m of texto.matchAll(/<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+="[^"<]*")*)\s*(\/?)>/g)) {
    if (m[4]) continue;
    if (m[1]) assert.equal(pilha.pop(), m[2], `tag ${m[2]} mal fechada`);
    else pilha.push(m[2]);
  }
  assert.equal(pilha.length, 0);
}

/* A mesma amostra gerada pelo TS da B (lib/xlsx.ts, node --experimental-strip-types): o SHA-256 dourado é o da saída dela. */
const AMOSTRA = {
  sheet: 'Consultas & <Teste> com nome longo demais para caber em 31',
  headers: ['Situação', 'Data', 'Tempo (min)', 'Valor da consulta', 'Desconto', 'Cliente', 'Saldo', 'Pagamento', 'Origem'],
  rows: [
    ['Em curso', '01/10/2026', 12, 59.2, 0.1, 'Ana & "Bia" <x> \'y\'', -3.5, 100, 'Informado nº 1'],
    ['Finalizada', null, 0, 0, 0.0525, 'ÁÉ ção', 0, 0, 'x'],
    ['Anulada', '02/10/2026', 5, 10, null, 'Z', 7, 1, 'y'],
    ['Cancelada', '03/10/2026', 5, 10.123456, 0.5, 'W', 7, 1, 'y'],
    ['Devolvida', '03/10/2026', 5, 10, 0.5, 'W', 7, 1, 'y'],
  ],
  widths: [20, 13, 16, 23, 11, 30, 12, 12, 20],
  options: {
    styled: true, headerRowHeight: 42, columnTones: { 2: 'time', 3: 'charge', 6: 'balance', 7: 'entry' }, headerTones: { 0: 'status', 8: 'pending' },
    cellTones: [{ 0: 'active', 5: 'active' }, { 0: 'warning' }, { 0: 'missing', 8: 'benefit' }, { 0: 'info' }, { 0: 'muted', 1: 'muted' }],
    rowTones: [undefined, undefined, 'cancelled', 'cancelled', undefined], mutedCancelledRows: true, decimalColumns: [3, 6, 7], percentageColumns: [4],
    precisionColumns: [3], dateColumns: [2], boldColumns: [0, 5], centerColumns: [0, 1, 2],
    summaryRow: ['Totais do período', null, 12, 59.2, null, null, null, null, null], subtitle: 'Consultas · 01/10/2026 · lido em x', dataRowHeights: [50],
  },
};
const sha = (b) => createHash('sha256').update(b).digest('hex');

teste('gerador: byte a byte igual ao lib/xlsx.ts da B (amostra com todos os tons, com e sem estilo)', () => {
  const estilizado = createXlsx(AMOSTRA.sheet, AMOSTRA.headers, AMOSTRA.rows, AMOSTRA.widths, AMOSTRA.options);
  const simples = createXlsx(AMOSTRA.sheet, AMOSTRA.headers, AMOSTRA.rows, AMOSTRA.widths, undefined);
  assert.equal(sha(estilizado), '8d1be159cfa281f697dd225365beb7a26f4d3c1bfc22a461df42278994b9c8f6');
  assert.equal(sha(simples), '0eefb649af9d02d2695fdea593b7554bdd20af49110db26df039e48b57fa3653');
});

teste('gerador: ZIP com as 6 partes OOXML, XML bem formado, nome da aba cortado em 31 e texto escapado', () => {
  const z = lerZip(createXlsx(AMOSTRA.sheet, AMOSTRA.headers, AMOSTRA.rows, AMOSTRA.widths, AMOSTRA.options));
  assert.deepEqual(Object.keys(z), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  for (const texto of Object.values(z)) xmlBemFormado(texto);
  assert.match(z['xl/workbook.xml'], /<sheet name="Consultas &amp; &lt;Teste&gt; com nome lo" sheetId="1"/);
  assert.match(z['xl/worksheets/sheet1.xml'], /Ana &amp; &quot;Bia&quot; &lt;x&gt; &apos;y&apos;/);
  assert.match(z['xl/worksheets/sheet1.xml'], /<pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(z['xl/worksheets/sheet1.xml'], /<autoFilter ref="A3:I8"\/>/);
  assert.match(z['xl/worksheets/sheet1.xml'], /<mergeCells count="2"><mergeCell ref="A1:B1"\/><mergeCell ref="A2:I2"\/><\/mergeCells>/);
  assert.equal(columnName(0) + columnName(25) + columnName(26) + columnName(701) + columnName(702), 'AZAAZZAAA');
});

teste('limparXml tira controles proibidos em XML 1.0 e mantém tab, LF e CR', () => {
  assert.equal(exportacao.limparXml('a\u0000b\u0008c\td\ne\rf￾g'), 'abc\td\ne\rfg');
  const sheet = { filename: 'x.xlsx', sheetName: 'S', headers: ['A'], rows: [['n\u0001ome']], widths: [10], options: { summaryRow: ['T\u0002'], subtitle: 's\u0003' } };
  const z = lerZip(exportacao.realExportFile(sheet));
  assert.ok(!/[\u0001-\u0008]/.test(z['xl/worksheets/sheet1.xml']));
  assert.match(z['xl/worksheets/sheet1.xml'], /nome/);
});

teste('nome do arquivo e rótulos (realExportName, periodLabel, readAtLabel)', () => {
  assert.equal(exportacao.realExportName(['consultas', 'todos'], { start: '2026-10-21', end: '2026-10-21' }), 'consultas_todos_2026-10-21.xlsx');
  assert.equal(exportacao.realExportName(['financeiro', 'todos', 'lancados'], { start: '2026-10-01', end: '2026-10-21' }), 'financeiro_todos_lancados_2026-10-01_a_2026-10-21.xlsx');
  assert.equal(exportacao.periodLabel({ start: '2026-10-01', end: '2026-10-21' }), '01/10/2026 a 21/10/2026');
  assert.equal(exportacao.readAtLabel('2026-10-21T15:30:05.000Z'), 'lido em 21/10/2026 12:30:05');
});

/* ---------------- Consultas ---------------- */

const catalogos = { channels: { 7: 'WhatsApp' }, paymentOptions: { 1: 'Pix' } };
let n = 0;
const consulta = (over = {}) => lerConsultaLegado({
  idConsulta: ++n, idUsuario: 10, idTarologo: 27, nome_id: 'Marina', nmuTarologo: 'Osíris',
  iniConsulta: '2026-10-21 10:00:00', fimConsulta: '2026-10-21 10:20:00', tmpConsulta: 20, valor_consulta: '30.00',
  vlBonus: 5, vlDesconto: 10, abatimento: '1.50', idFormaConsulta: 7, idFormaPagto: 1, ...over,
}, catalogos);
const NOW = '2026-10-21T12:30:00';
const cutConsultas = () => consultasModelo.montarRecorteConsultas({
  rows: [consulta(), consulta({ iniConsulta: '2026-10-20 10:00:00', fimConsulta: null, tmpConsulta: null, valor_consulta: '0.00' }),
    consulta({ iniConsulta: '2026-10-01 10:00:00', fimConsulta: null, tmpConsulta: null, valor_consulta: '0.00' }), consulta({ nome_id: 'Zé <&> Ç', idUsuario: 11 })],
  range: { start: '2026-10-20', end: '2026-10-21' }, nowLocal: NOW,
});

teste('Consultas: colunas, ordem dos grupos, totais, subtítulo, nome e estilos da planilha da B', () => {
  const cut = cutConsultas();
  const s = consultas.exportacaoDeConsultas({ cut, today: '2026-10-21', readAt: '2026-10-21T15:30:00.000Z', tarot: { id: '27', name: 'Osíris' } });
  assert.deepEqual(s.headers, consultas.CABECALHOS);
  assert.equal(s.filename, 'consultas_tarologo_27_2026-10-20_a_2026-10-21.xlsx');
  assert.equal(s.sheetName, 'Consultas');
  assert.deepEqual(s.rows.map((r) => r[0]), ['Sem fim registrado no período', 'Sem fim registrado antes do período', 'Finalizada', 'Finalizada']);
  assert.deepEqual(s.widths, [20, 13, 9, 13, 16, 17, 30, 16, 18, 16, 13, 23, 11, 12, 13].map((w, i) => Math.max([20, 13, 9, 13, 16, 14, 30, 16, 18, 16, 13, 18, 11, 12, 13][i], { 5: 17, 7: 16, 11: 23 }[i] || 0)));
  const fin = s.rows.find((r) => r[0] === 'Finalizada' && r[6] === 'Marina');
  assert.deepEqual([fin[0], fin[1], fin[2], fin[3], fin[4], fin[5], fin[6]], ['Finalizada', '21/10/2026', '10:00', '10:20', '21/10/2026', '10', 'Marina']);
  assert.deepEqual([fin[7], fin[8], fin[9], fin[10], fin[11], fin[12], fin[13], fin[14]], [20, 'Osíris', 'Pix', 'WhatsApp', 30, 0.1, 5, 1.5]);
  assert.equal(typeof s.rows[0][11], 'string'); // sem fim e sem valor: "Em andamento", nunca zero
  assert.equal(s.options.summaryRow[0], 'Totais do período');
  assert.equal(s.options.summaryRow[7], cut.totals.recordedMinutes);
  assert.equal(s.options.summaryRow[11], Number(cut.totals.recordedAmount));
  assert.match(s.options.subtitle, /^Consultas · 20\/10\/2026 a 21\/10\/2026 · Osíris · lido em 21\/10\/2026 12:30:00 · 0 em curso · 1 sem fim no período · 1 sem fim de antes do período, fora dos totais · 2 finalizadas/);
  assert.deepEqual(s.options.percentageColumns, [12]);
  assert.ok(s.options.decimalColumns.includes(14) && s.options.decimalColumns.includes(11));
  const z = lerZip(exportacao.realExportFile(s));
  Object.values(z).forEach(xmlBemFormado);
  assert.match(z['xl/worksheets/sheet1.xml'], /Zé &lt;&amp;&gt; Ç/);
});

teste('Consultas: sem tarólogo o arquivo é "todos"; em curso do dia vai primeiro e a linha tem "Decorrido"', () => {
  const rows = [consulta({ fimConsulta: null, tmpConsulta: null, valor_consulta: '0.00' })];
  const cut = consultasModelo.montarRecorteConsultas({ rows, range: { start: '2026-10-21', end: '2026-10-21' }, nowLocal: NOW });
  const s = consultas.exportacaoDeConsultas({ cut, today: '2026-10-21', readAt: '2026-10-21T15:30:00.000Z', tarot: null });
  assert.equal(s.filename, 'consultas_todos_2026-10-21.xlsx');
  assert.equal(s.rows[0][0], 'Em curso');
  assert.match(String(s.rows[0][7]), /^Decorrido: 2 h 30 min$/);
  assert.match(s.options.subtitle, /todos os tarólogos/);
  assert.equal(s.options.cellTones[0][0], 'active');
});

teste('Consultas: exportar() lê o recorte uma vez, nomeia o tarólogo do filtro (inativos inclusive) e ignora `page`', async () => {
  const cut = cutConsultas();
  let query = null;
  const r = await consultasServico.exportar({ tarotId: '27', start: '2026-10-20', end: '2026-10-21', page: 'lixo' }, undefined, {
    recorte: async (q) => { query = q; return { readAt: '2026-10-21T15:30:00.000Z', today: '2026-10-21', cut, filtro: { start: '2026-10-20', end: '2026-10-21', tarotId: '27' } }; },
    tarologos: async () => [{ id: '26', name: 'Outra', active: true }, { id: '27', name: 'Osíris Inativo', active: false }],
  });
  assert.equal(query.tarotId, '27');
  assert.equal(r.screen, 'consultas');
  assert.deepEqual(r.cut, { start: '2026-10-20', end: '2026-10-21', tarotId: '27' });
  assert.match(r.sheet.options.subtitle, /Osíris Inativo/);
});

/* ---------------- Recebimentos ---------------- */

const catalogs = { paymentOptions: new Map([['1', 'Pix']]), banks: new Map([['5', 'Banco X']]) };
const pg = (id, table, over = {}) => pagamentosModelo.readLegacyPayment({
  idPagtoInformado: id, idUsuario: 10, nome_id: 'Marina', vlPagtoInformado: '50.00',
  dtPagtoInformado: '2026-10-21 00:00:00', dt_criado: '2026-10-21 15:00:00', idBanco: 5, idFormaPagto: 1, status: null, id_status_pagto: 2, ...over,
}, table, catalogs);
const cutPagamentos = (by = 'paid') => pagamentosModelo.buildRealReceiptsCut({
  informed: [pg(1, 'tbl_pagtoinformado'), pg(2, 'tbl_pagtoinformado', { vlPagtoInformado: '20.00' }), pg(4, 'tbl_pagtoinformado', { nome_id: null })],
  confirmed: [pg(2, 'tbl_pagtoconfirmado', { vlPagtoInformado: '20.00' })], notFound: [pg(3, 'tbl_pagtonaolocalizado', { vlPagtoInformado: '9.90' })],
  range: { start: '2026-10-21', end: '2026-10-21' }, by,
});

teste('Recebimentos: colunas, valor na coluna do total que alimenta, totais, subtítulo e tons da situação', () => {
  const cut = cutPagamentos();
  const s = pagamentos.exportacaoDeRecebimentos({ cut, readAt: '2026-10-21T15:30:00.000Z' });
  assert.deepEqual(s.headers, ['Pago em', 'Lançado em', 'ID da cliente', 'Cliente', 'Confirmado', 'Informado', 'Fora dos totais', 'Conta', 'Forma', 'Situação', 'Origem']);
  assert.equal(s.filename, 'financeiro_todos_2026-10-21.xlsx');
  assert.equal(s.sheetName, 'Pagamentos');
  assert.equal(s.rows.length, cut.receipts.length);
  for (const r of s.rows) {
    const col = { Confirmado: 4, Informado: 5, 'Não localizado': 6, 'Conferir a origem': 6 }[r[9]];
    assert.equal(typeof r[col], 'number');
    assert.equal([4, 5, 6].filter((c) => r[c] !== null).length, 1);
  }
  assert.equal(s.options.summaryRow[0], 'Totais do período');
  assert.equal(s.options.summaryRow[4], Number(cut.summary.confirmedTotal));
  assert.equal(s.options.summaryRow[5], Number(cut.summary.informedTotal));
  assert.match(s.options.subtitle, /^Pagamentos · 21\/10\/2026 · pela data paga · lido em 21\/10\/2026 12:30:00 · \d+ confirmados?/);
  assert.deepEqual(s.options.headerTones, { 9: 'status' });
  assert.equal(s.options.columnTones[4], 'entry');
  assert.equal(s.options.columnTones[5], 'pending');
  assert.deepEqual(s.options.cellTones.map((t) => t[9]), cut.receipts.map((x) => ({ confirmado: undefined, informado: 'warning', 'nao-localizado': 'muted', 'conferir-origem': 'missing' }[x.situation])));
  assert.match(s.rows.find((r) => /nº 2/.test(r[10]))[10], /^(Informado nº 2 \+ Confirmado nº 2|Confirmado nº 2 \+ Informado nº 2)$/);
  Object.values(lerZip(exportacao.realExportFile(s))).forEach(xmlBemFormado);
});

teste('Recebimentos: by=launched dá "lancados" no nome e "lançados das 06h às 06h" no subtítulo', () => {
  const s = pagamentos.exportacaoDeRecebimentos({ cut: cutPagamentos('launched'), readAt: '2026-10-21T15:30:00.000Z' });
  assert.equal(s.filename, 'financeiro_todos_lancados_2026-10-21.xlsx');
  assert.match(s.options.subtitle, /lançados das 06h às 06h/);
});

teste('Recebimentos: exportar() usa o recorte inteiro e devolve screen/cut como a B', async () => {
  const r = await pagamentosServico.exportar({ start: '2026-10-21', end: '2026-10-21', by: 'launched', page: '9' }, { recorte: async () => cutPagamentos('launched') });
  assert.equal(r.screen, 'recebimentos');
  assert.deepEqual(r.cut, { start: '2026-10-21', end: '2026-10-21', by: 'launched' });
  await assert.rejects(() => pagamentosServico.exportar({ by: 'x' }), (e) => e.statusCode === 400 && e.dados.codigo === 'INVALID_INPUT');
});

/* ---------------- Entrega e auditoria ---------------- */

/** gf_auditoria em memória: INSERT guarda a linha, SELECT por operation_key ou id devolve. */
function bancoFalso({ falharNoInsert = false } = {}) {
  const linhas = [];
  const executor = {
    async execute(sql, v) {
      if (/^INSERT/.test(sql)) {
        if (falharNoInsert) throw Object.assign(new Error('x'), { code: 'ER_DOWN' });
        linhas.push(Object.fromEntries(['id', 'ocorrido_em', 'ator_conta_id', 'ator_funcao', 'acao', 'entidade', 'entidade_id', 'antes', 'depois', 'motivo', 'operation_key'].map((c, i) => [c, v[i]])));
        return [{ affectedRows: 1 }];
      }
      const col = /WHERE (\w+) = \?/.exec(sql)[1];
      return [linhas.filter((l) => l[col] === v[0])];
    },
  };
  return { linhas, executor };
}
function respostaFalsa(eventos) {
  const r = { cabecalhos: {}, corpo: null, codigo: null };
  r.status = (c) => { r.codigo = c; return r; };
  r.set = (h) => { Object.assign(r.cabecalhos, h); return r; };
  r.end = (b) => { eventos.push('end'); r.corpo = b; return r; };
  return r;
}

teste('entrega: grava operations.export.download ANTES de enviar; cabeçalhos da B; entidade_id = SHA-256 do arquivo', async () => {
  const eventos = [];
  const { linhas, executor } = bancoFalso();
  const base = criarAuditoria(executor, { novoId: () => 'id-1', agora: () => 1761060000000 });
  const auditoria = { adicionar: async (f) => { eventos.push('auditoria'); return base.adicionar(f); } };
  const sheet = pagamentos.exportacaoDeRecebimentos({ cut: cutPagamentos(), readAt: '2026-10-21T15:30:00.000Z' });
  const res = respostaFalsa(eventos);
  await exportacao.entregarExportacao(res, { accountId: '7', role: 'assistente' }, { screen: 'recebimentos', cut: { start: '2026-10-21', end: '2026-10-21', by: 'paid' }, sheet }, { auditoria });
  assert.deepEqual(eventos, ['auditoria', 'end']);
  assert.equal(res.codigo, 200);
  assert.deepEqual(res.cabecalhos, { 'Content-Type': XLSX_TIPO, 'Content-Disposition': 'attachment; filename="financeiro_todos_2026-10-21.xlsx"', 'Cache-Control': 'no-store' });
  assert.equal(linhas.length, 1);
  const l = linhas[0];
  assert.deepEqual([l.ator_conta_id, l.ator_funcao, l.acao, l.entidade, l.entidade_id], ['7', 'assistente', 'operations.export.download', 'recebimentos', sha(res.corpo)]);
  assert.deepEqual(JSON.parse(l.depois), { start: '2026-10-21', end: '2026-10-21', by: 'paid', rows: sheet.rows.length });
  assert.equal(l.antes, null);
  assert.equal(l.operation_key, 'id-1');
  assert.deepEqual(lerZip(res.corpo)['[Content_Types].xml'].slice(0, 5), '<?xml');
});

teste('entrega: auditoria que falha (gravação ou escrita desligada) vira 503 e NENHUM arquivo sai', async () => {
  const sheet = pagamentos.exportacaoDeRecebimentos({ cut: cutPagamentos(), readAt: '2026-10-21T15:30:00.000Z' });
  const exp = { screen: 'recebimentos', cut: {}, sheet };
  for (const auditoria of [
    criarAuditoria(bancoFalso({ falharNoInsert: true }).executor),
    // Sem dependência injetada: usa a conexão de escrita REAL, que com a flag desligada recusa antes de conectar.
    undefined,
  ]) {
    const eventos = [];
    const res = respostaFalsa(eventos);
    await assert.rejects(
      () => exportacao.entregarExportacao(res, { accountId: '7', role: 'administradora' }, exp, auditoria ? { auditoria } : {}),
      (e) => e instanceof AppError && e.statusCode === 503 && e.dados.codigo === 'SERVICE_UNAVAILABLE' && e.message === 'Não foi possível acessar o serviço. Tente novamente.',
    );
    assert.deepEqual(eventos, []);
    assert.equal(res.corpo, null);
    assert.equal(res.codigo, null);
  }
});

/* ---------------- Rotas ---------------- */

teste('rotas: GET /consultas/export e GET /pagamentos/recebimentos/export com a mesma proteção da lista, antes das rotas parametrizadas', () => {
  const caminhos = (router) => router.stack.filter((c) => c.route).map((c) => `${Object.keys(c.route.methods)[0]} ${c.route.path} x${c.route.stack.length}`);
  const c = caminhos(require('../src/gestao-fadas/features/consultas/consultas.routes'));
  const p = caminhos(require('../src/gestao-fadas/features/pagamentos/pagamentos.routes'));
  assert.deepEqual(c, ['get /export x3', 'get / x3']);
  assert.deepEqual(p, ['get /recebimentos/export x3', 'get /recebimentos/sem-data x3', 'get /recebimentos x3']);
});

fila.then(() => {
  console.log(`\n${ok} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
});
