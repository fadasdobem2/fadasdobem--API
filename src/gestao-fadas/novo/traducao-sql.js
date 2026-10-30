'use strict';

/**
 * Do SQL dos stores (escrito para MySQL, com `?`) para o Postgres, mais a allowlist do banco novo.
 * Traduz: crases, `?` -> `$n` (fora de literais) e `INSERT IGNORE` -> `ON CONFLICT DO NOTHING`.
 * Recusa o que não tem tradução segura: `ON DUPLICATE KEY`, `LAST_INSERT_ID`, `REPLACE INTO`.
 */

const { motivoDeRecusa: motivoDoLegado } = require('../../models/legado/escrita');

const TABELA_GF = /^gf_[a-z0-9_]+$/;
const LITERAIS = /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`/g;
const PERIGOSO = /\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|set_config|dblink|pg_terminate_backend|pg_cancel_backend)\b/i;

/** Mesmo texto sem literais, para as regras olharem só a estrutura. */
const esqueleto = (sql) => String(sql).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(LITERAIS, "''");

/** Devolve null se permitido, ou o motivo da recusa. Só INSERT/UPDATE em gf_*; SELECT só de gf_*; FOR UPDATE só em gf_*. */
function motivoDeRecusa(sqlOriginal) {
  // Crases envolvem só nomes de tabela/coluna; sem elas a allowlist do legado enxerga o nome da tabela.
  const sql = String(sqlOriginal).replace(LITERAIS, (m) => (m.startsWith('`') ? m.slice(1, -1) : m));
  const base = motivoDoLegado(sql); // várias instruções, DELETE/DDL, escrita fora de gf_*, LOCK IN SHARE MODE, etc.
  if (base) return base;
  const e = esqueleto(sql).trim();
  if (/^(start\s+transaction|begin|commit|rollback|savepoint|release|rollback\s+to)\b/i.test(e)) return null;
  if (/\bon\s+duplicate\s+key\b|\blast_insert_id\s*\(|^replace\b/i.test(e)) return 'sintaxe MySQL sem tradução (ON DUPLICATE KEY / LAST_INSERT_ID / REPLACE)';
  if (PERIGOSO.test(e)) return 'instrução perigosa';
  if (/\bfor\s+(share|no\s+key\s+update|key\s+share)\b/i.test(e)) return 'bloqueio não permitido';
  if (/^select\b/i.test(e)) {
    const tabelas = [...e.matchAll(/\b(?:from|join)\s+`?([a-z0-9_.]+)`?/gi)].map((m) => m[1]);
    if (!tabelas.every((t) => TABELA_GF.test(t))) return 'SELECT fora de gf_*';
  }
  return null;
}

/** Troca cada `?` fora de literal por `$n`; devolve { texto, n }. */
function trocarPlaceholders(sql) {
  let n = 0;
  let saida = '';
  let ultimo = 0;
  for (const m of sql.matchAll(LITERAIS)) {
    saida += sql.slice(ultimo, m.index).replace(/\?/g, () => `$${(n += 1)}`) + m[0];
    ultimo = m.index + m[0].length;
  }
  saida += sql.slice(ultimo).replace(/\?/g, () => `$${(n += 1)}`);
  return { texto: saida, n };
}

/** SQL do store -> { texto, n } em dialeto Postgres. Lança se a instrução não for permitida. */
function traduzir(sql, criarErro) {
  const motivo = motivoDeRecusa(sql);
  if (motivo) throw criarErro(motivo);
  let texto = String(sql).trim().replace(/;\s*$/, '');
  // Crases só envolvem nomes minúsculos: basta tirá-las (fora de literais).
  texto = texto.replace(LITERAIS, (m) => (m.startsWith('`') ? m.slice(1, -1) : m));
  const ignorar = /^insert\s+ignore\s+into\b/i.test(texto);
  if (ignorar) texto = `${texto.replace(/^insert\s+ignore\s+into\b/i, 'INSERT INTO')} ON CONFLICT DO NOTHING`;
  return trocarPlaceholders(texto);
}

module.exports = { motivoDeRecusa, traduzir, trocarPlaceholders };
