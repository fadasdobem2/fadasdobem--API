'use strict';

const { Op, literal } = require('sequelize');
const AppError = require('../../../utils/AppError');
const { lendo } = require('../../_comum/legado');
const { hojeOperacional } = require('../../_comum/dia-operacional');
const { OPERATIONAL_DAY_START_HOUR, shiftDateKey, isRealDay, withinRealPeriod } = require('./helpers/datas');
const { PageOutOfRange } = require('./helpers/paginacao');
const { sqlDataInvalida } = require('../../_comum/legado-datas');
const {
  INFORMED_TABLE,
  CONFIRMED_TABLE,
  NOT_FOUND_TABLE,
  readLegacyPayment,
  buildRealReceipts,
  buildRealReceiptsCut,
  buildUndatedReceipts,
} = require('./pagamentos.model');
const { exportacaoDeRecebimentos } = require('./pagamentos.exportacao');

/**
 * Leitura de RECEBIMENTOS do legado, em SOMENTE LEITURA (porte de features/integration/legacy-operations.server.ts,
 * parte de recebimentos, do suspiro). Lê as três tabelas, entrega ao model (regra pura R5) e devolve EXATAMENTE o DTO
 * do contrato da B (`contracts/operations-http.md`): receipts[], page, summary, tarologistPayouts, mais readAt/today.
 * O controller embrulha no envelope da A; o DTO interno não muda.
 *
 * Colunas, filtros, ordenação e paginação são os da B:
 *  - a conciliação por ID acontece ANTES do filtro de período, então cada lado também traz os gêmeos por ID do outro
 *    (subconsulta IN), e um gêmeo sem data paga só vem para o pareamento (R22);
 *  - by=paid recorta pela data civil do pagamento; by=launched pelo dia operacional do lançamento (dt_criado, que é
 *    UTC e só existe em tbl_pagtoinformado; o model conserva o dia operacional exato);
 *  - sem data paga (D9): lista própria, fora de qualquer período e de qualquer total.
 *
 * Exportação XLSX (R23): `exportar` monta a planilha da B (pagamentos.exportacao.js) sobre `listarRecorteInteiro`.
 */

const CAMPOS_BASE = ['idPagtoInformado', 'idUsuario', 'dtPagtoInformado', 'vlPagtoInformado', 'idBanco', 'idFormaPagto'];
const CAMPOS_INFORMADO = [...CAMPOS_BASE, 'status', 'id_status_pagto', 'dt_criado'];

const relogio = (hora) => `${String(hora).padStart(2, '0')}:00:00`;
// São Paulo é UTC-3 e teve UTC-2 no horário de verão até 2019: estas duas horas UTC cercam o início local do dia
// (o model depois conserva o dia operacional exato).
const DAY_START_UTC_EARLIEST = relogio(OPERATIONAL_DAY_START_HOUR + 2);
const DAY_START_UTC_LATEST = relogio(OPERATIONAL_DAY_START_HOUR + 3);

/* ------------------------------------------- entrada ------------------------------------------- */

const invalida = (campo) => new AppError('Parâmetros inválidos.', 400, { codigo: 'INVALID_INPUT', campo });

/** Valor único da query, ou undefined quando ausente; parâmetro repetido é inválido (como na B). */
function unico(query, nome) {
  const v = query[nome];
  if (v === undefined) return undefined;
  if (Array.isArray(v) || typeof v !== 'string') throw invalida(nome);
  return v;
}

function lerPagina(query) {
  const v = unico(query, 'page');
  if (v === undefined) return 1;
  if (!/^[1-9]\d*$/.test(v) || !Number.isSafeInteger(Number(v))) throw invalida('page');
  return Number(v);
}

function lerPeriodo(query, hoje) {
  const start = unico(query, 'start') ?? hoje;
  const end = unico(query, 'end') ?? hoje;
  if (!isRealDay(start)) throw invalida('start');
  if (!isRealDay(end)) throw invalida('end');
  if (!withinRealPeriod({ start, end })) throw invalida('end');
  return { start, end };
}

function lerConsulta(query, hoje) {
  const by = unico(query, 'by') ?? 'paid';
  if (by !== 'paid' && by !== 'launched') throw invalida('by');
  return { ...lerPeriodo(query, hoje), by };
}

/* ------------------------------------------- consultas ------------------------------------------- */

/** "Sem data" (A4b): nula, zero-date, ano < 2000 ou depois de amanhã. Regra única em `_comum/legado-datas.js`. */
const semData = sqlDataInvalida;

function incluirCliente(m) {
  return [{ model: m.LegadoUsuario, as: 'cliente', attributes: ['nome_id'], required: false }];
}

/** Rótulos código -> texto de um catálogo; linha sem um dos dois fica de fora. */
async function lerRotulos(Modelo, colunaCodigo, colunaRotulo) {
  const linhas = await Modelo.findAll({ attributes: [colunaCodigo, colunaRotulo], raw: true });
  const mapa = new Map();
  for (const l of linhas) {
    const codigo = l[colunaCodigo];
    const rotulo = l[colunaRotulo];
    if (codigo !== null && codigo !== undefined && rotulo !== null && rotulo !== undefined) mapa.set(String(codigo), rotulo);
  }
  return mapa;
}

async function buscar(Modelo, m, campos, where) {
  const linhas = await Modelo.findAll({
    attributes: campos,
    where,
    include: incluirCliente(m),
    order: [['idPagtoInformado', 'ASC']],
  });
  return linhas.map((r) => {
    const p = r.get({ plain: true });
    const { cliente, ...resto } = p;
    return { ...resto, nome_id: cliente ? cliente.nome_id : null };
  });
}

/** Subconsulta de IDs do outro lado (os gêmeos por ID). Os valores são datas já validadas e ainda escapadas. */
function idsDe(sequelize, tabela, condicao) {
  return `SELECT idPagtoInformado FROM ${tabela} WHERE ${condicao(sequelize)}`;
}

const ref = (modelo, coluna) => `\`${modelo}\`.\`${coluna}\``;

async function lerFontes(m, { modo, janela }) {
  const { LegadoPagamentoInformado: Inf, LegadoPagamentoConfirmado: Conf, LegadoPagamentoNaoLocalizado: Nl } = m;
  const sequelize = Inf.sequelize;
  const q = (v) => sequelize.escape(v);
  const idInf = ref('LegadoPagamentoInformado', 'idPagtoInformado');
  const idConf = ref('LegadoPagamentoConfirmado', 'idPagtoInformado');
  let wInf;
  let wConf;
  let wNl = null;

  if (modo === 'paid') {
    const [de, ate] = janela;
    const noPeriodo = (col) => `${col} >= ${q(de)} AND ${col} < ${q(ate)}`;
    wInf = {
      [Op.or]: [
        { dtPagtoInformado: { [Op.gte]: de, [Op.lt]: ate } },
        literal(`${idInf} IN (${idsDe(sequelize, CONFIRMED_TABLE, () => noPeriodo('dtPagtoInformado'))})`),
      ],
    };
    wConf = {
      [Op.or]: [
        { dtPagtoInformado: { [Op.gte]: de, [Op.lt]: ate } },
        literal(`${idConf} IN (${idsDe(sequelize, INFORMED_TABLE, () => noPeriodo('dtPagtoInformado'))})`),
      ],
    };
    wNl = { dtPagtoInformado: { [Op.gte]: de, [Op.lt]: ate } };
  } else if (modo === 'launched') {
    // Só tbl_pagtoinformado tem dt_criado: o dia do lançamento chega às outras duas só pelo gêmeo informado.
    const [de, ate] = janela;
    wInf = { dt_criado: { [Op.gte]: de, [Op.lt]: ate } };
    wConf = literal(`${idConf} IN (${idsDe(sequelize, INFORMED_TABLE, () => `dt_criado >= ${q(de)} AND dt_criado < ${q(ate)}`)})`);
  } else {
    // Sem data paga: NULL (só tbl_pagtonaolocalizado admite) ou data que os leitores não aceitam, inclusive zero-date.
    wInf = {
      [Op.or]: [
        literal(semData(ref('LegadoPagamentoInformado', 'dtPagtoInformado'))),
        literal(`${idInf} IN (${idsDe(sequelize, CONFIRMED_TABLE, () => semData('dtPagtoInformado'))})`),
      ],
    };
    wConf = {
      [Op.or]: [
        literal(semData(ref('LegadoPagamentoConfirmado', 'dtPagtoInformado'))),
        literal(`${idConf} IN (${idsDe(sequelize, INFORMED_TABLE, () => semData('dtPagtoInformado'))})`),
      ],
    };
    wNl = literal(semData(ref('LegadoPagamentoNaoLocalizado', 'dtPagtoInformado')));
  }

  // As linhas primeiro, para tomarem as conexões do pool antes dos catálogos pequenos (pool de 2).
  const [informed, confirmed, notFound] = [
    await buscar(Inf, m, CAMPOS_INFORMADO, wInf),
    await buscar(Conf, m, CAMPOS_BASE, wConf),
    // Sem dt_criado, tbl_pagtonaolocalizado nunca cai num dia de lançamento.
    wNl === null ? [] : await buscar(Nl, m, CAMPOS_BASE, wNl),
  ];
  const paymentOptions = await lerRotulos(m.LegadoOpcaoPagamento, 'idOpcaoPagto', 'tpOpcaoPagto');
  const banks = await lerRotulos(m.LegadoBanco, 'idBanco', 'nmBanco');
  const catalogs = { paymentOptions, banks };
  return {
    informed: informed.map((r) => readLegacyPayment(r, INFORMED_TABLE, catalogs)),
    confirmed: confirmed.map((r) => readLegacyPayment(r, CONFIRMED_TABLE, catalogs)),
    notFound: notFound.map((r) => readLegacyPayment(r, NOT_FOUND_TABLE, catalogs)),
  };
}

function janelaDe({ start, end, by }) {
  const depois = shiftDateKey(end, 1);
  return by === 'paid'
    ? [`${start} 00:00:00`, `${depois} 00:00:00`]
    : [`${start} ${DAY_START_UTC_EARLIEST}`, `${depois} ${DAY_START_UTC_LATEST}`];
}

function traduzirPagina(e) {
  if (e instanceof PageOutOfRange) return new AppError(e.message, 400, { codigo: 'INVALID_INPUT', campo: 'page' });
  return e;
}

/* ------------------------------------------- casos de uso ------------------------------------------- */

/** GET recebimentos: DTO da B (`readAt`, `today`, `range`, `receipts`, `page`, `summary`, `tarologistPayouts`). */
async function listar(query = {}) {
  const hoje = hojeOperacional();
  const consulta = lerConsulta(query, hoje);
  const page = lerPagina(query);
  const readAt = new Date().toISOString();
  const fontes = await lendo((m) => lerFontes(m, { modo: consulta.by, janela: janelaDe(consulta) }));
  try {
    const result = buildRealReceipts({ ...fontes, range: { start: consulta.start, end: consulta.end }, by: consulta.by, page });
    return { readAt, today: hoje, ...result };
  } catch (e) {
    throw traduzirPagina(e);
  }
}

/** O recorte inteiro, todas as páginas (a exportação, R23). */
async function listarRecorteInteiro(query = {}) {
  const consulta = lerConsulta(query, hojeOperacional());
  const fontes = await lendo((m) => lerFontes(m, { modo: consulta.by, janela: janelaDe(consulta) }));
  return buildRealReceiptsCut({ ...fontes, range: { start: consulta.start, end: consulta.end }, by: consulta.by });
}

/**
 * `GET /recebimentos/export`: o recorte inteiro lido uma vez, como .xlsx. A query é a da lista sem `page` (ignorado, como
 * na B). Devolve { screen, cut, sheet } para `entregarExportacao`.
 */
async function exportar(query = {}, dependencias = {}) {
  const readAt = new Date().toISOString();
  const consulta = lerConsulta(query, hojeOperacional());
  const cut = await (dependencias.recorte || listarRecorteInteiro)(query);
  return {
    screen: 'recebimentos',
    cut: { start: consulta.start, end: consulta.end, by: consulta.by },
    sheet: exportacaoDeRecebimentos({ cut, readAt }),
  };
}

/** GET recebimentos sem data paga (D9): lista própria, sem período, fora de qualquer total. */
async function listarSemDataPaga(query = {}) {
  const page = lerPagina(query);
  const readAt = new Date().toISOString();
  const fontes = await lendo((m) => lerFontes(m, { modo: 'undated', janela: null }));
  try {
    return { readAt, ...buildUndatedReceipts({ ...fontes, page }) };
  } catch (e) {
    throw traduzirPagina(e);
  }
}

module.exports = { listar, listarRecorteInteiro, exportar, listarSemDataPaga };
