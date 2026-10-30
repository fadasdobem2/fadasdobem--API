'use strict';

const { Op, fn, col, where: onde } = require('sequelize');
const AppError = require('../../../utils/AppError');
const { lendo } = require('../../_comum/legado');
const { intervaloDoPeriodo } = require('../../_comum/dia-operacional');
const { montarConsultas, montarRecorteConsultas } = require('./consultas.model');
const { lerConsultaLegado } = require('./helpers/leitura-legado');
const { lerQueryConsultas, entradaInvalida } = require('./helpers/consulta-http');
const { chaveDiaOperacional, carimboSaoPaulo } = require('./helpers/periodo');
const { PaginaForaDoIntervalo } = require('./helpers/pagina');
const tarologos = require('../tarologos/tarologos.service');
const { exportacaoDeConsultas } = require('./consultas.exportacao');

/**
 * Consultas reais: leitura de `tbl_consultas` (legado, SOMENTE LEITURA) com o DTO IDÊNTICO ao de
 * `GET /api/operations/consultations` da B: { readAt, today, range, inProgress, finished, openSinceEarlier, page, totals }.
 * Porte de `readRealConsultations` / `readRealConsultationsCut` / `consultationRows` (legacy-operations.server.ts).
 */

/**
 * Lista branca de colunas de `tbl_consultas` (a mesma das frases SQL da B). Nunca `obsConsulta`, `nmuAtendente`,
 * `saldo`, `vlPre` etc. De `usuarios` só `nome_id`; de `tbl_tarologos` só `nmuTarologo`.
 */
const COLUNAS = [
  'idConsulta', 'idUsuario', 'idTarologo', 'iniConsulta', 'fimConsulta', 'tmpConsulta',
  'valor_consulta', 'vlDesconto', 'vlBonus', 'abatimento', 'idFormaConsulta', 'idFormaPagto',
];

/**
 * Aberta como os leitores a veem (R4): fim que não é data válida (zero-date incluído) ou minutos que não são uma contagem.
 * `c.fimConsulta` qualificado pelo nome do model (alias da tabela principal no Sequelize).
 */
function condicaoAberta() {
  const fim = col('LegadoConsulta.fimConsulta');
  return {
    [Op.or]: [
      onde(fn('YEAR', fim), Op.lt, 1000),
      onde(fn('MONTH', fim), Op.eq, 0),
      onde(fn('DAYOFMONTH', fim), Op.eq, 0),
      { tmpConsulta: null },
      { tmpConsulta: { [Op.lt]: 0 } },
    ],
  };
}

/** O WHERE da B: o intervalo [from, to) e, quando inclui hoje, as abertas iniciadas antes dele (uma passada só). */
function filtroConsultas({ from, to, incluiHoje }) {
  const noIntervalo = { iniConsulta: { [Op.gte]: from, [Op.lt]: to } };
  if (!incluiHoje) return noIntervalo;
  return { [Op.or]: [noIntervalo, { [Op.and]: [{ iniConsulta: { [Op.lt]: from } }, condicaoAberta()] }] };
}

/** Catálogo código -> rótulo; linha sem um dos dois fica de fora. */
function rotulos(linhas, campoCodigo, campoRotulo) {
  const mapa = {};
  for (const l of linhas) {
    const codigo = l[campoCodigo];
    const rotulo = l[campoRotulo];
    if (codigo === null || codigo === undefined || rotulo === null || rotulo === undefined) continue;
    mapa[String(codigo)] = rotulo;
  }
  return mapa;
}

/** As linhas do período, lidas uma vez: a tela leva uma página do modelo construído sobre elas, a exportação o recorte inteiro. */
async function linhasDasConsultas({ start, end, nowLocal }) {
  const hoje = chaveDiaOperacional(nowLocal);
  const { inicio: from, fim: to } = intervaloDoPeriodo(start, end);
  const incluiHoje = start <= hoje && hoje <= end; // as abertas de dias anteriores só aparecem se o intervalo inclui hoje (R7)
  return lendo(async (m) => {
    // As linhas primeiro, para tomarem as conexões do pool antes dos catálogos pequenos.
    const [consultas, canais, formas] = await Promise.all([
      m.LegadoConsulta.findAll({
        attributes: COLUNAS,
        where: filtroConsultas({ from, to, incluiHoje }),
        include: [
          { model: m.LegadoUsuario, as: 'cliente', attributes: ['nome_id'], required: false },
          { model: m.LegadoTarologo, as: 'tarologo', attributes: ['nmuTarologo'], required: false },
        ],
      }),
      m.LegadoFormaConsulta.findAll({ attributes: ['idFormaConsulta', 'tpFormaConsulta'], raw: true }),
      m.LegadoOpcaoPagamento.findAll({ attributes: ['idOpcaoPagto', 'tpOpcaoPagto'], raw: true }),
    ]);
    const catalogos = {
      channels: rotulos(canais, 'idFormaConsulta', 'tpFormaConsulta'),
      paymentOptions: rotulos(formas, 'idOpcaoPagto', 'tpOpcaoPagto'),
    };
    try {
      return consultas.map((r) => {
        const l = r.get({ plain: true });
        return lerConsultaLegado({ ...l, nome_id: l.cliente ? l.cliente.nome_id : null, nmuTarologo: l.tarologo ? l.tarologo.nmuTarologo : null }, catalogos);
      });
    } catch (e) {
      // Linha que a leitura não consegue manter (ID inválido) é defeito: 503, nunca dado parcial.
      throw new AppError('Banco legado devolveu uma consulta em formato inesperado.', 503, { codigo: 'LEGADO_LINHA_INVALIDA' });
    }
  });
}

/** Momento da leitura: UTC ISO (`readAt`), relógio de parede de São Paulo (`nowLocal`) e o dia operacional (`today`). */
function relogio(agora = new Date()) {
  const nowLocal = carimboSaoPaulo(agora);
  return { readAt: agora.toISOString(), nowLocal, today: chaveDiaOperacional(nowLocal) };
}

/** `GET /consultas?start=&end=&tarotId=&page=` */
async function listar(query, agora) {
  const { readAt, nowLocal, today } = relogio(agora);
  const q = lerQueryConsultas(query, today);
  const rows = await linhasDasConsultas({ start: q.start, end: q.end, nowLocal });
  try {
    const resultado = montarConsultas({ rows, range: { start: q.start, end: q.end }, nowLocal, tarotId: q.tarotId, page: q.page });
    return { readAt, today, ...resultado };
  } catch (e) {
    if (e instanceof PaginaForaDoIntervalo) throw entradaInvalida();
    throw e;
  }
}

/** O recorte inteiro (todas as páginas) da exportação (sem `page`: a B ignora esse parâmetro no export). */
async function recorte(query, agora) {
  const { readAt, nowLocal, today } = relogio(agora);
  const q = lerQueryConsultas({ ...query, page: undefined }, today);
  const rows = await linhasDasConsultas({ start: q.start, end: q.end, nowLocal });
  const cut = montarRecorteConsultas({ rows, range: { start: q.start, end: q.end }, nowLocal, tarotId: q.tarotId });
  return { readAt, today, cut, filtro: { start: q.start, end: q.end, tarotId: q.tarotId ?? null } };
}

/**
 * `GET /consultas/export`: lê o recorte uma vez e monta a planilha da tela. O arquivo nomeia o tarólogo do filtro como a
 * lista do filtro o faz, inativos incluídos. Devolve { screen, cut, sheet } para `entregarExportacao`.
 */
async function exportar(query, agora, dependencias = {}) {
  const { readAt, today, cut, filtro } = await (dependencias.recorte || recorte)(query, agora);
  const tarot = filtro.tarotId === null ? null
    : { id: filtro.tarotId, name: (await (dependencias.tarologos || tarologos.listar)()).find((item) => item.id === filtro.tarotId)?.name ?? null };
  return { screen: 'consultas', cut: filtro, sheet: exportacaoDeConsultas({ cut, today, readAt, tarot }) };
}

module.exports = { listar, recorte, exportar, COLUNAS, filtroConsultas };
