'use strict';

/**
 * Histórico da cliente no legado para a elegibilidade de "primeira consulta" (A3). SOMENTE SELECT, UMA consulta (UNION ALL) para todas as clientes pedidas,
 * indexada por `idUsuario` (tbl_consultas, tbl_pagtoinformado, tbl_pagtoconfirmado), só agregados (contagem e menor data válida): nenhum dado pessoal,
 * nenhum valor em dinheiro. A regra é `_comum/dominio/historico-legado.js`.
 *   - consulta: `iniConsulta` válida entre 2000-01-02 e amanhã;
 *   - pagamento: só com `vlPagtoInformado > 0` (a linha vazia do ASP não prova nada), data paga entre 2000 e amanhã.
 */

const { QueryTypes } = require('sequelize');
const { lendo } = require('../../_comum/legado');
const { perfilDoHistorico, SEM_HISTORICO } = require('../../_comum/dominio/historico-legado');
const { agoraSaoPaulo, ANO_MINIMO_PAGAMENTO } = require('../../_comum/legado-datas');

const VALIDA = (col) => `${col} >= '${ANO_MINIMO_PAGAMENTO}-01-02' AND ${col} < DATE_ADD(CURDATE(), INTERVAL 2 DAY)`;
const SQL = `
SELECT 'C' AS tipo, idUsuario AS cliente, COUNT(*) AS n, CAST(MIN(CASE WHEN ${VALIDA('iniConsulta')} THEN iniConsulta END) AS CHAR) AS primeira
  FROM tbl_consultas WHERE idUsuario IN (:ids) GROUP BY idUsuario
UNION ALL
SELECT 'P', idUsuario, COUNT(*), CAST(MIN(CASE WHEN ${VALIDA('dtPagtoInformado')} THEN dtPagtoInformado END) AS CHAR)
  FROM tbl_pagtoinformado WHERE idUsuario IN (:ids) AND vlPagtoInformado > 0 GROUP BY idUsuario
UNION ALL
SELECT 'P', idUsuario, COUNT(*), CAST(MIN(CASE WHEN ${VALIDA('dtPagtoInformado')} THEN dtPagtoInformado END) AS CHAR)
  FROM tbl_pagtoconfirmado WHERE idUsuario IN (:ids) AND vlPagtoInformado > 0 GROUP BY idUsuario`;

/** Junta as linhas do SQL por cliente no formato do domínio. */
function agrupar(linhas) {
  const por = new Map();
  for (const l of linhas) {
    const h = por.get(String(l.cliente)) || { consultas: { n: 0, primeira: null }, pagamentos: { n: 0, primeira: null } };
    const alvo = l.tipo === 'C' ? h.consultas : h.pagamentos;
    alvo.n += Number(l.n) || 0;
    if (l.primeira && (!alvo.primeira || `${l.primeira}` < alvo.primeira)) alvo.primeira = `${l.primeira}`;
    por.set(String(l.cliente), h);
  }
  return por;
}

/** `Map(id -> { hasPriorConsultations, firstConsultationAt? })` das clientes pedidas (todas as pedidas aparecem no mapa). Uma ida ao legado. */
async function historicoDoLegadoReal(ids) {
  const numericos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const saida = new Map(ids.map((id) => [String(id), SEM_HISTORICO]));
  if (!numericos.length) return saida;
  const linhas = await lendo((m) => m.LegadoUsuario.sequelize.query(SQL, { replacements: { ids: numericos }, type: QueryTypes.SELECT }));
  const agora = agoraSaoPaulo();
  for (const [id, h] of agrupar(linhas)) saida.set(id, perfilDoHistorico(h, agora));
  return saida;
}

module.exports = { SQL, agrupar, historicoDoLegadoReal };
