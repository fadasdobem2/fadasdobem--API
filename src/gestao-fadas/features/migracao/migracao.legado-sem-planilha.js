'use strict';

/**
 * Leitura do LEGADO para o relatório "sem planilha" (Maturacao/55), SOMENTE SELECT, pensada para o servidor compartilhado com o ASP:
 *   - candidatas: clientes (nível 0) COM movimento (pagamento em `tbl_pagtoinformado`/`tbl_pagtoconfirmado` ou consulta em `tbl_consultas`), em ordem de id,
 *     a partir de um cursor e com LIMIT pequeno (a chave primária de `usuarios` e o índice `idUsuario` das três tabelas; nada de varrer tudo a cada pedido);
 *   - agregados: contagem e soma por cliente, UMA consulta para o lote de ids da página (índice `idUsuario`);
 *   - contagens totais: feitas uma vez e guardadas em memória por alguns minutos.
 * Só id, contagens e centavos: nenhum nome nem dado pessoal sai daqui.
 */

const { QueryTypes } = require('sequelize');
const { lendo } = require('../../_comum/legado');

const MOVIMENTO = `(EXISTS (SELECT 1 FROM tbl_pagtoinformado p WHERE p.idUsuario = u.id)
   OR EXISTS (SELECT 1 FROM tbl_pagtoconfirmado c WHERE c.idUsuario = u.id)
   OR EXISTS (SELECT 1 FROM tbl_consultas k WHERE k.idUsuario = u.id))`;

const SQL_CANDIDATAS = `SELECT u.id AS id FROM usuarios u WHERE u.nivel = 0 AND u.id > :depois AND ${MOVIMENTO} ORDER BY u.id LIMIT :limite`;
const SQL_TOTAL = `SELECT COUNT(*) AS n FROM usuarios u WHERE u.nivel = 0 AND ${MOVIMENTO}`;
const SQL_ENTRE = `SELECT u.id AS id FROM usuarios u WHERE u.nivel = 0 AND u.id IN (:ids) AND ${MOVIMENTO}`;
// Pagamento que conta como crédito (mesmo critério de `saldo-legado.js#contaComoCredito`: status 0/1/2, texto fora pendente/bloqueado/cancelado).
const SQL_AGREGADOS = `
SELECT 'P' AS tipo, i.idUsuario AS cliente, COUNT(*) AS n, SUM(i.vlPagtoInformado) AS valor FROM tbl_pagtoinformado i
 WHERE i.idUsuario IN (:ids) AND i.id_status_pagto IN (0, 1, 2) AND LOWER(TRIM(i.status)) NOT IN ('pendente', 'bloqueado', 'cancelado') GROUP BY i.idUsuario
UNION ALL
SELECT 'P', c.idUsuario, COUNT(*), SUM(c.vlPagtoInformado) FROM tbl_pagtoconfirmado c
 WHERE c.idUsuario IN (:ids) AND NOT EXISTS (SELECT 1 FROM tbl_pagtoinformado x WHERE x.idPagtoInformado = c.idPagtoInformado) GROUP BY c.idUsuario
UNION ALL
SELECT 'C', k.idUsuario, COUNT(*), NULL FROM tbl_consultas k WHERE k.idUsuario IN (:ids) GROUP BY k.idUsuario`;

const consulta = (sql, replacements) => lendo((m) => m.LegadoUsuario.sequelize.query(sql, { replacements, type: QueryTypes.SELECT }));
const centavosDe = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100));

const leitorReal = {
  async candidatas(depois, limite) { return (await consulta(SQL_CANDIDATAS, { depois: Number(depois) || 0, limite })).map((l) => String(l.id)); },
  async total() { return Number((await consulta(SQL_TOTAL, {}))[0].n); },
  /** Dos ids pedidos, os que têm movimento no legado (em blocos de 1.000). */
  async comMovimento(ids) {
    const achados = new Set();
    for (let i = 0; i < ids.length; i += 1000) {
      const bloco = ids.slice(i, i + 1000).map(Number);
      for (const l of await consulta(SQL_ENTRE, { ids: bloco })) achados.add(String(l.id));
    }
    return achados;
  },
  async agregados(ids) {
    const por = new Map(ids.map((id) => [id, { pagamentos: 0, pagamentosCentavos: 0, consultas: 0 }]));
    if (!ids.length) return por;
    for (const l of await consulta(SQL_AGREGADOS, { ids: ids.map(Number) })) {
      const a = por.get(String(l.cliente)); if (!a) continue;
      if (l.tipo === 'P') { a.pagamentos += Number(l.n); a.pagamentosCentavos += centavosDe(l.valor); } else a.consultas += Number(l.n);
    }
    return por;
  },
};

let leitor = leitorReal;
/** Troca o leitor (nos testes o MySQL legado nem é configurado). */
const definirLeitorDoLegado = (fn) => { leitor = fn || leitorReal; limparCache(); };

const VALIDADE_MS = 10 * 60 * 1000;
let cache = null;
function limparCache() { cache = null; }
/** Total de clientes com movimento no legado, e quantas dessas têm planilha (cache de 10 min, chave = quantidade de planilhas). */
async function totais(idsComPlanilha, agora = Date.now()) {
  const chave = idsComPlanilha.length;
  if (cache && cache.chave === chave && agora - cache.em < VALIDADE_MS) return cache;
  const [comMovimento, comPlanilhaEMovimento] = await Promise.all([leitor.total(), idsComPlanilha.length ? leitor.comMovimento(idsComPlanilha) : new Set()]);
  cache = { chave, em: agora, comMovimento, comPlanilhaEMovimento: comPlanilhaEMovimento.size };
  return cache;
}

module.exports = { definirLeitorDoLegado, limparCache, totais, candidatas: (...a) => leitor.candidatas(...a), comMovimento: (...a) => leitor.comMovimento(...a), agregados: (...a) => leitor.agregados(...a), SQL_CANDIDATAS, SQL_TOTAL, SQL_AGREGADOS };
