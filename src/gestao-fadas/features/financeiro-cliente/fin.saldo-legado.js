'use strict';

/**
 * Leitura do histórico do legado para o saldo de abertura calculado (Maturacao/52). SOMENTE SELECT, uma única consulta (UNION ALL) para
 * todas as clientes pedidas, indexada por `idUsuario` (tbl_pagtoinformado, tbl_pagtoconfirmado, tbl_consultas). Só colunas de dinheiro,
 * datas, minutos e status: nenhum dado pessoal. A conta em si é `_comum/dominio/saldo-legado.js`.
 */

const { QueryTypes } = require('sequelize');
const { lendo } = require('../../_comum/legado');
const calculo = require('../../_comum/dominio/saldo-legado');

const SQL = `
SELECT 'P' AS tipo, i.idUsuario AS cliente, CAST(i.dtPagtoInformado AS CHAR) AS t1, CAST(i.dt_criado AS CHAR) AS t2, CAST(i.vlPagtoInformado AS CHAR) AS valor,
       i.id_status_pagto AS numero, i.status AS texto, NULL AS minutos, NULL AS bonus
  FROM tbl_pagtoinformado i WHERE i.idUsuario IN (:ids)
UNION ALL
SELECT 'P', c.idUsuario, CAST(c.dtPagtoInformado AS CHAR), NULL, CAST(c.vlPagtoInformado AS CHAR), NULL, 'confirmado', NULL, NULL
  FROM tbl_pagtoconfirmado c WHERE c.idUsuario IN (:ids)
   AND NOT EXISTS (SELECT 1 FROM tbl_pagtoinformado x WHERE x.idPagtoInformado = c.idPagtoInformado)
UNION ALL
SELECT 'C', k.idUsuario, CAST(k.fimConsulta AS CHAR), CAST(k.iniConsulta AS CHAR), CAST(k.dtConsulta AS CHAR), NULL, NULL, k.tmpConsulta, k.vlBonus
  FROM tbl_consultas k WHERE k.idUsuario IN (:ids)`;

/** Agrupa as linhas lidas por cliente no formato do cálculo puro. */
function agrupar(linhas, ids) {
  const por = new Map(ids.map((id) => [String(id), { pagamentos: [], consultas: [] }]));
  for (const l of linhas) {
    const h = por.get(String(l.cliente)); if (!h) continue;
    if (l.tipo === 'P') h.pagamentos.push({ pagoEm: l.t1, criadoEm: l.t2, valor: l.valor, numero: l.numero, texto: l.texto });
    else h.consultas.push({ fim: l.t1, ini: l.t2, dia: l.valor, minutos: l.minutos, bonus: l.bonus });
  }
  return por;
}

/** Saldo de abertura calculado (centavos e detalhes) das clientes pedidas: `Map(id -> resultado do cálculo)`. Uma ida ao legado. */
async function saldosCalculados(ids) {
  const numericos = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!numericos.length) return new Map();
  const linhas = await lendo((m) => m.LegadoUsuario.sequelize.query(SQL, { replacements: { ids: numericos }, type: QueryTypes.SELECT }));
  return new Map([...agrupar(linhas, numericos)].map(([id, h]) => [id, calculo.saldoDaAbertura(h)]));
}

module.exports = { SQL, agrupar, saldosCalculados };
