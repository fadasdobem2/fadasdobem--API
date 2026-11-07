'use strict';

/**
 * Acesso ao banco novo para a Lilly. Os repositórios recebem um `executor` (`execute(sql, valores) -> [linhas]`):
 * o da transação (`emTransacao`) quando a gravação anda junto com um efeito, ou o avulso para leituras soltas.
 * Só `gf_*` (a allowlist do banco novo barra o resto) e sem DELETE.
 */

const { emTransacao, executarAvulso } = require('../../../novo/banco-novo');

const avulso = { execute: (sql, valores) => executarAvulso(sql, valores), query: (sql, valores) => executarAvulso(sql, valores) };

/** jsonb chega como texto pelo executor do banco novo. */
const lerJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v ?? null);
const gravarJson = (v) => (v === undefined || v === null ? null : JSON.stringify(v));
const iso = (v) => (v === null || v === undefined ? null : new Date(v).toISOString());
const dataBr = (v) => (v === null || v === undefined ? null : String(v).slice(0, 10));

module.exports = { avulso, emTransacao, lerJson, gravarJson, iso, dataBr };
