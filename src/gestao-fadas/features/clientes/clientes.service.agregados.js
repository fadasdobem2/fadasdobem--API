'use strict';

/** Agregados para a lista (substituem o SQL de CLIENT_CUT_PAGE e CLIENT_SEARCH_PAGE) (fatia de clientes.service.js; leitura SOMENTE LEITURA do legado). */

const { Op, fn, col } = require('sequelize');
const { intervaloDoDia, intervaloDoPeriodo } = require('../../_comum/dia-operacional');
const { readLegacyConsultation } = require('./helpers/consultas');
const { legacyLocalDateTime, localOperationalDateKey, shiftDateKey } = require('./helpers/valores');
const { ANO_MINIMO_CONSULTA } = require('../../_comum/legado-datas');
const { COLUNAS_CONSULTA, LOTE, agregarMaximo, emLotes, modelosDePagamento, numericIds, pagamentoValido } = require('./clientes.service.comum');

// --- agregados para a lista (substituem o SQL de CLIENT_CUT_PAGE e CLIENT_SEARCH_PAGE) --------------------

/** Última movimentação de cada cliente DENTRO do recorte: consulta pelo dia operacional, recebimento pela data civil. */
async function movimentosNoRecorte(m, range) {
  const mapa = new Map();
  const { inicio, fim } = intervaloDoPeriodo(range.start, range.end);
  const civil = { [Op.gte]: `${range.start} 00:00:00`, [Op.lt]: `${shiftDateKey(range.end, 1)} 00:00:00` };
  const maximo = (campo) => [[fn('MAX', col(campo)), 'em']];
  const [consultas, ...recibos] = await Promise.all([
    m.LegadoConsulta.findAll({ attributes: ['idUsuario', ...maximo('iniConsulta')], where: { iniConsulta: { [Op.gte]: inicio, [Op.lt]: fim } }, group: ['idUsuario'], raw: true }),
    ...Object.values(modelosDePagamento(m)).map((Modelo) => Modelo.findAll({ attributes: ['idUsuario', ...maximo('dtPagtoInformado')], where: { dtPagtoInformado: pagamentoValido(civil) }, group: ['idUsuario'], raw: true })),
  ]);
  agregarMaximo(mapa, consultas, 'em');
  for (const linhas of recibos) agregarMaximo(mapa, linhas, 'em');
  return mapa;
}

/** Última consulta e último recebimento da história inteira dos clientes dados (latest(id) e as ordenações por data). */
async function movimentosGerais(m, ids) {
  const consultaAt = new Map();
  const recebAt = new Map();
  const maximo = (campo) => [[fn('MAX', col(campo)), 'em']];
  const unicos = numericIds(ids);
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE);
    const [consultas, ...recibos] = await Promise.all([
      m.LegadoConsulta.findAll({ attributes: ['idUsuario', ...maximo('iniConsulta')], where: { idUsuario: lote, iniConsulta: { [Op.gte]: `${ANO_MINIMO_CONSULTA}-01-01 00:00:00` } }, group: ['idUsuario'], raw: true }),
      // Pagamento com data absurda (A4b) não é "último pagamento": só entre 2000 e amanhã.
      ...Object.values(modelosDePagamento(m)).map((Modelo) => Modelo.findAll({ attributes: ['idUsuario', ...maximo('dtPagtoInformado')], where: { idUsuario: lote, dtPagtoInformado: pagamentoValido() }, group: ['idUsuario'], raw: true })),
    ]);
    agregarMaximo(consultaAt, consultas, 'em');
    for (const linhas of recibos) agregarMaximo(recebAt, linhas, 'em');
  }
  return { consultaAt, recebAt };
}

/** IDs (texto) dos clientes dados com alguma consulta no legado, de qualquer data ("nunca consultou" são os outros). */
async function clientesJaConsultados(m, ids) {
  const linhas = await emLotes(ids, (lote) => m.LegadoConsulta.findAll({ attributes: ['idUsuario'], where: { idUsuario: lote }, group: ['idUsuario'], raw: true }));
  return new Set(linhas.map((l) => String(l.idUsuario)));
}

/** Consultas iniciadas no dia operacional de hoje: base de "em consulta agora". */
async function consultasDeHoje(m, today) {
  const { inicio, fim } = intervaloDoDia(today);
  const linhas = await m.LegadoConsulta.findAll({ attributes: COLUNAS_CONSULTA, where: { iniConsulta: { [Op.gte]: inicio, [Op.lt]: fim } }, raw: true });
  return linhas.map((l) => readLegacyConsultation(l));
}

/** Contagens dos controles de data (só administradora, fora da busca): clientes com movimento em Hoje, Ontem e 7 dias. */
async function contagensDeData(m, today) {
  const ate = { start: shiftDateKey(today, -6), end: today };
  const { inicio, fim } = intervaloDoPeriodo(ate.start, ate.end);
  const civil = { [Op.gte]: `${ate.start} 00:00:00`, [Op.lt]: `${shiftDateKey(ate.end, 1)} 00:00:00` };
  const [consultas, ...recibos] = await Promise.all([
    m.LegadoConsulta.findAll({ attributes: ['idUsuario', 'iniConsulta'], where: { iniConsulta: { [Op.gte]: inicio, [Op.lt]: fim } }, raw: true }),
    ...Object.values(modelosDePagamento(m)).map((Modelo) => Modelo.findAll({ attributes: ['idUsuario', 'dtPagtoInformado'], where: { dtPagtoInformado: civil }, raw: true })),
  ]);
  const movimentos = [];
  for (const l of consultas) {
    const em = legacyLocalDateTime(l.iniConsulta);
    if (em) movimentos.push({ id: String(l.idUsuario), dia: localOperationalDateKey(em) });
  }
  for (const linhas of recibos) {
    for (const l of linhas) {
      const em = legacyLocalDateTime(l.dtPagtoInformado);
      if (em) movimentos.push({ id: String(l.idUsuario), dia: em.slice(0, 10) });
    }
  }
  const clientes = new Set((await emLotes(movimentos.map((x) => x.id), (lote) => m.LegadoUsuario.findAll({ attributes: ['id'], where: { nivel: 0, id: lote }, raw: true }))).map((l) => String(l.id)));
  const contar = (de, ateDia) => new Set(movimentos.filter((x) => clientes.has(x.id) && x.dia >= de && x.dia <= ateDia).map((x) => x.id)).size;
  return { hoje: contar(today, today), ontem: contar(shiftDateKey(today, -1), shiftDateKey(today, -1)), '7dias': contar(ate.start, ate.end) };
}

module.exports = {
  clientesJaConsultados,
  consultasDeHoje,
  contagensDeData,
  movimentosGerais,
  movimentosNoRecorte,
};
