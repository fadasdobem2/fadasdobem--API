'use strict';

/**
 * Operações de DADOS sobre `tbl_consultas` (INSERT ao lançar, UPDATE ao iniciar, encerrar ou corrigir), sempre pelo executor com
 * allowlist (`executor.js`/`sql.js`). Nunca DELETE, nunca estrutura. O vínculo com a consulta do Postgres e a idempotência NÃO ficam
 * aqui (não há coluna a acrescentar no legado): ficam em `gf_consultas_ext.id_consulta_legado`, guardado por quem chama.
 */

const sql = require('./sql');
const { linhaDoLegado } = require('./mapeamento');

/** `tarotId` do front (login, ex.: `osiris`) ou código numérico -> `idTarologo` do legado. `null` se não achar ou for ambíguo. */
async function resolverTarologo(ex, tarotId) {
  const valor = `${tarotId}`;
  const numerico = /^\d{1,10}$/.test(valor) ? Number(valor) : -1;
  const [linhas] = await ex.execute(sql.SELECT_TAROLOGO, [valor, numerico]);
  return linhas.length === 1 ? Number(linhas[0].idTarologo) : null;
}

/** INSERT da linha aberta. Devolve o `idConsulta` novo. */
async function inserir(ex, item, idTarologoLegado, agora) {
  const { colunas } = linhaDoLegado(item, idTarologoLegado, agora);
  const [r] = await ex.execute(sql.INSERT_CONSULTA, sql.COLUNAS_INSERT.map((c) => colunas[c]));
  if (r && r.insertId) return String(r.insertId);
  const [[u]] = await ex.execute(sql.SELECT_ULTIMO_ID, []);
  return String(u.id);
}

/** UPDATE da linha já espelhada. Devolve quantas linhas mudaram (0 se a linha não é desta cliente ou não existe). */
async function atualizar(ex, idConsultaLegado, item, idTarologoLegado, agora) {
  const { colunas, total } = linhaDoLegado(item, idTarologoLegado, agora);
  const [r] = await ex.execute(sql.UPDATE_CONSULTA, [...sql.COLUNAS_UPDATE.map((c) => colunas[c]), total, Number(idConsultaLegado), colunas.idUsuario]);
  return Number(r && r.affectedRows) || 0;
}

async function ler(ex, idConsultaLegado) {
  const [linhas] = await ex.execute(sql.SELECT_CONSULTA, [Number(idConsultaLegado)]);
  return linhas[0] || null;
}

/** Linhas do legado que já correspondem à chave natural (`chave.js`), da mais antiga à mais nova (no máximo 5). Só leitura. */
async function buscarCandidatas(ex, ch) {
  const [linhas] = await ex.execute(sql.SELECT_CANDIDATAS, [ch.idUsuario, ch.idTarologo, ch.dtConsulta, ch.iniConsulta]);
  return linhas.map((l) => String(l.idConsulta));
}

async function contar(ex) {
  const [[l]] = await ex.execute(sql.SELECT_CONTAGEM, []);
  return Number(l.n);
}

module.exports = { resolverTarologo, inserir, atualizar, ler, contar, buscarCandidatas };
