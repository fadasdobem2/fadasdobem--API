'use strict';

/**
 * Escrita no banco do suspiro, restrita às tabelas NOVAS `gf_*`.
 *
 * O legado do ASP32 nunca é alterado: aqui só passam INSERT/UPDATE em `gf_*`, SELECT (com `FOR UPDATE` só em `gf_*`)
 * e o controle de transação. Qualquer outra instrução (DELETE, DDL, escrita em tabela legada, várias instruções)
 * é recusada ANTES de chegar ao servidor.
 *
 * Desligada por padrão: precisa de `GESTAO_FADAS_ESCRITA_ENABLED=true`. Usa as mesmas credenciais `LEGADO_DB_*`,
 * numa conexão própria (a de leitura continua somente leitura).
 */

const path = require('path');
const mysql = require('mysql2/promise');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

const MODO_SQL = 'ONLY_FULL_GROUP_BY,STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';

class EscritaLegadoError extends Error {
  constructor(codigo, detalhe, statusCode = 500) {
    super(detalhe);
    this.name = 'EscritaLegadoError';
    this.codigo = codigo;
    this.statusCode = statusCode;
  }
}

function escritaHabilitada() {
  return process.env.GESTAO_FADAS_ESCRITA_ENABLED === 'true';
}

const SEM_LITERAIS = /'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g;
const TABELA_GF = /^gf_[a-z0-9_]+$/;

function limpar(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*(--[^\n]*\n\s*)*/g, '')
    .trim()
    .replace(/;\s*$/, '');
}

/** Devolve null se a instrução é permitida, ou o motivo da recusa. */
function motivoDeRecusa(sql) {
  const texto = limpar(sql);
  const esqueleto = texto.replace(SEM_LITERAIS, "''");
  if (/;/.test(esqueleto)) return 'mais de uma instrução';
  if (/\binto\s+(outfile|dumpfile)\b|\bget_lock\s*\(|\bload_file\s*\(/i.test(esqueleto)) return 'instrução perigosa';
  if (/^(start\s+transaction|begin|commit|rollback)$/i.test(esqueleto)) return null;
  if (/^(savepoint|release\s+savepoint|rollback\s+to\s+savepoint)\s+ens_[0-9]+$/i.test(esqueleto)) return null;
  const insert = /^insert\s+(?:ignore\s+)?into\s+`?([a-z0-9_]+)`?/i.exec(esqueleto);
  if (insert) return TABELA_GF.test(insert[1]) ? null : `INSERT fora de gf_* (${insert[1]})`;
  const update = /^update\s+(?:ignore\s+)?`?([a-z0-9_]+)`?\s+set\b/i.exec(esqueleto);
  if (update) {
    if (!TABELA_GF.test(update[1])) return `UPDATE fora de gf_* (${update[1]})`;
    return /\bjoin\b/i.test(esqueleto) ? 'UPDATE com JOIN' : null;
  }
  if (/^select\b/i.test(esqueleto)) {
    if (/\block\s+in\s+share\s+mode\b/i.test(esqueleto)) return 'LOCK IN SHARE MODE';
    if (/\bfor\s+update\b/i.test(esqueleto)) {
      const tabelas = [...esqueleto.matchAll(/\b(?:from|join)\s+`?([a-z0-9_]+)`?/gi)].map((m) => m[1]);
      if (!tabelas.length || !tabelas.every((t) => TABELA_GF.test(t))) return 'FOR UPDATE fora de gf_*';
    }
    return null;
  }
  return `instrução não permitida (${texto.slice(0, 30)})`;
}

function conferir(sql) {
  const motivo = motivoDeRecusa(sql);
  if (motivo) throw new EscritaLegadoError('LEGADO_ESCRITA_RECUSADA', `Escrita recusada: ${motivo}`);
}

let pool = null;

function lerConfig() {
  const e = process.env;
  const host = `${e.LEGADO_DB_HOST || ''}`.trim();
  const database = `${e.LEGADO_DB_NAME || ''}`.trim();
  const user = `${e.LEGADO_DB_USER || ''}`.trim();
  if (!host || !database || !user) {
    throw new EscritaLegadoError('LEGADO_NAO_CONFIGURADO', 'Banco do suspiro não configurado (LEGADO_DB_*).', 503);
  }
  return {
    host,
    database,
    user,
    password: e.LEGADO_DB_PASSWORD || '',
    port: Number.parseInt(e.LEGADO_DB_PORT || '3306', 10) || 3306,
    ...(e.LEGADO_DB_SSL === 'true' ? { ssl: { rejectUnauthorized: e.LEGADO_DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
  };
}

function obterPool() {
  if (!escritaHabilitada()) {
    throw new EscritaLegadoError('ESCRITA_DESLIGADA', 'Gravação do Gestão Fadas desligada neste ambiente.', 503);
  }
  if (pool) return pool;
  pool = mysql.createPool({
    ...lerConfig(),
    charset: 'utf8mb4',
    connectionLimit: 2,
    connectTimeout: 10000,
    dateStrings: true,
    timezone: 'Z',
    multipleStatements: false,
  });
  return pool;
}

/** Executor com o mesmo desenho do `SqlExecutor` do suspiro: `execute(sql, valores) -> [linhas]`. */
function envolver(conexao) {
  const chamar = (metodo) => async (sql, valores) => {
    conferir(sql);
    return conexao[metodo](sql, valores);
  };
  return { execute: chamar('execute'), query: chamar('query') };
}

// Ensaio: UMA transação aberta que NUNCA confirma. Enquanto ativo, `emTransacao` e `executarAvulso` rodam nela (cada
// operação num SAVEPOINT), então uma cadeia (criar, confirmar, corrigir) enxerga o que a anterior gravou, e tudo é
// desfeito no fim. Só liga por esta função (nunca por variável de ambiente) e recusa o banco de produção.
let ensaioAtivo = null;
let seqPonto = 0;

async function emEnsaio(trabalho) {
  const nome = lerConfig().database;
  if (!/(01|dev|teste)$/i.test(nome) || /^fadasdobem$/i.test(nome)) {
    throw new EscritaLegadoError('ENSAIO_RECUSADO', `Ensaio só roda em banco de desenvolvimento (recebido: ${nome}).`);
  }
  if (ensaioAtivo) throw new EscritaLegadoError('ENSAIO_ANINHADO', 'Já existe um ensaio em andamento.');
  const conexao = await obterPool().getConnection();
  try {
    await conexao.query('SET SESSION sql_mode = ?', [MODO_SQL]);
    await conexao.query('START TRANSACTION');
    ensaioAtivo = conexao;
    return await trabalho(envolver(conexao));
  } finally {
    ensaioAtivo = null;
    await conexao.query('ROLLBACK').catch(() => {});
    conexao.release();
  }
}

/** Dentro do ensaio: cada transação lógica vira um SAVEPOINT (confirmar = RELEASE, falhar = ROLLBACK TO). */
async function emPontoDeEnsaio(trabalho) {
  const ponto = `ens_${(seqPonto += 1)}`;
  await ensaioAtivo.query(`SAVEPOINT ${ponto}`);
  try {
    const resultado = await trabalho(envolver(ensaioAtivo));
    await ensaioAtivo.query(`RELEASE SAVEPOINT ${ponto}`);
    return resultado;
  } catch (erro) {
    await ensaioAtivo.query(`ROLLBACK TO SAVEPOINT ${ponto}`).catch(() => {});
    throw erro;
  }
}

/** Roda `trabalho(executor)` numa transação; confirma se terminar, desfaz se lançar. */
async function emTransacao(trabalho, { desfazerSempre = false } = {}) {
  if (ensaioAtivo) return emPontoDeEnsaio(trabalho);
  const conexao = await obterPool().getConnection();
  try {
    await conexao.query('SET SESSION sql_mode = ?', [MODO_SQL]);
    await conexao.query('SET SESSION max_statement_time = 10').catch(() => {});
    await conexao.query('START TRANSACTION');
    try {
      const resultado = await trabalho(envolver(conexao));
      if (desfazerSempre) await conexao.query('ROLLBACK');
      else await conexao.query('COMMIT');
      return resultado;
    } catch (erro) {
      await conexao.query('ROLLBACK').catch(() => {});
      throw erro;
    }
  } finally {
    conexao.release();
  }
}

/** Executor avulso (cada instrução sozinha), para leituras e auditoria fora de transação. */
async function executarAvulso(sql, valores) {
  conferir(sql);
  if (ensaioAtivo) return ensaioAtivo.execute(sql, valores);
  return obterPool().execute(sql, valores);
}

async function fecharEscrita() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  MODO_SQL,
  EscritaLegadoError,
  escritaHabilitada,
  motivoDeRecusa,
  emTransacao,
  emEnsaio,
  executarAvulso,
  fecharEscrita,
};
