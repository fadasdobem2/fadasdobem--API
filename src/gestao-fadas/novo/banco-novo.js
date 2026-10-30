'use strict';

/**
 * Escrita no BANCO NOVO do Gestão Fadas: o PostgreSQL da própria API A (conexão Sequelize/pg principal), só nas
 * tabelas `gf_*`. Mesma interface de src/models/legado/escrita.js (`emTransacao`, `executarAvulso`, `emEnsaio`,
 * executor com `execute(sql, valores) -> [linhas]` e `query`), então auditoria e stores não mudam.
 *
 * - allowlist equivalente (traducao-sql.js): INSERT/UPDATE em `gf_*`, SELECT só de `gf_*`, FOR UPDATE só em `gf_*`,
 *   sem DELETE nem DDL nem várias instruções;
 * - SQL dos stores em dialeto MySQL é traduzido (`?` -> `$n`, crases, INSERT IGNORE);
 * - leituras no formato que os stores esperam do MySQL (dateStrings): DATE e TIMESTAMP como TEXTO, BIGINT como número
 *   quando seguro, NUMERIC como texto, jsonb como texto JSON;
 * - duplicidade: o erro do Postgres 23505 ganha `errno = 1062` e `code = 'ER_DUP_ENTRY'` (os códigos do MySQL), e guarda
 *   o original em `codigoPg`;
 * - transação real; o ensaio roda numa transação que NUNCA confirma, com um SAVEPOINT por operação lógica.
 * Desligada por padrão: precisa de `GESTAO_FADAS_ESCRITA_ENABLED=true`.
 */

const { EscritaLegadoError, escritaHabilitada } = require('../../models/legado/escrita');
const { traduzir } = require('./traducao-sql');

class BancoNovoError extends EscritaLegadoError {
  constructor(codigo, detalhe, statusCode = 500) {
    super(codigo, detalhe, statusCode);
    this.name = 'BancoNovoError';
  }
}

const recusa = (motivo) => new BancoNovoError('LEGADO_ESCRITA_RECUSADA', `Escrita recusada: ${motivo}`);

// Parsers de leitura: texto para DATE (1082), TIMESTAMP (1114) e JSONB (3802); BIGINT (20) vira número se seguro.
const TEXTO = new Set([1082, 1114, 3802, 114]);
const TIPOS = {
  getTypeParser: (oid, formato) => {
    const pg = require('pg');
    if (TEXTO.has(oid)) return (v) => v;
    if (oid === 20) return (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v);
    return pg.types.getTypeParser(oid, formato);
  },
};

function sequelizePrincipal() {
  return require('../../config/database').sequelize;
}

function traduzirErroPg(erro) {
  if (erro && erro.code === '23505') {
    erro.codigoPg = '23505';
    erro.errno = 1062;
    erro.code = 'ER_DUP_ENTRY';
  }
  return erro;
}

const ehDuplicado = (erro) => Boolean(erro) && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY' || erro.codigoPg === '23505');

function exigirLigada() {
  if (!escritaHabilitada()) throw new BancoNovoError('ESCRITA_DESLIGADA', 'Gravação do Gestão Fadas desligada neste ambiente.', 503);
}

async function obterConexao() {
  exigirLigada();
  const gerente = sequelizePrincipal().connectionManager;
  return { conexao: await gerente.getConnection({ type: 'write' }), liberar: (c) => gerente.releaseConnection(c) };
}

/** Executa uma instrução na conexão pg e devolve no formato mysql2: `[linhas]` num SELECT, `[{ affectedRows }]` nos demais. */
async function rodar(conexao, sql, valores = []) {
  const { texto } = traduzir(sql, recusa);
  const params = (valores || []).map((v) => (v === undefined ? null : v));
  try {
    const r = await conexao.query({ text: texto, values: params, types: TIPOS });
    return /^\s*select\b/i.test(texto) ? [r.rows] : [{ affectedRows: r.rowCount, rows: r.rows }];
  } catch (erro) {
    throw traduzirErroPg(erro);
  }
}

/** Controle de transação (START/COMMIT/ROLLBACK/SAVEPOINT) sem passar pela tradução de valores. */
const controle = (conexao, sql) => conexao.query(sql);

function envolver(conexao) {
  const chamar = () => (sql, valores) => rodar(conexao, sql, valores);
  return { execute: chamar(), query: chamar() };
}

// Ensaio: UMA transação aberta que NUNCA confirma. Enquanto ativo, `emTransacao` e `executarAvulso` rodam nela.
let ensaioAtivo = null;
let seqPonto = 0;

function nomeDoBanco() {
  return `${sequelizePrincipal().config.database || ''}`;
}

async function emEnsaio(trabalho) {
  const nome = nomeDoBanco();
  if (!(/^fdb_[a-z0-9_]+$/.test(nome) || /(01|dev|teste|test|integracao)$/i.test(nome)) || /^fadasdobem(_api)?$/i.test(nome)) {
    throw new BancoNovoError('ENSAIO_RECUSADO', `Ensaio só roda em banco de desenvolvimento (recebido: ${nome}).`);
  }
  if (ensaioAtivo) throw new BancoNovoError('ENSAIO_ANINHADO', 'Já existe um ensaio em andamento.');
  const { conexao, liberar } = await obterConexao();
  try {
    await controle(conexao, 'BEGIN');
    ensaioAtivo = conexao;
    return await trabalho(envolver(conexao));
  } finally {
    ensaioAtivo = null;
    await controle(conexao, 'ROLLBACK').catch(() => {});
    liberar(conexao);
  }
}

/** Dentro do ensaio: cada transação lógica vira um SAVEPOINT (confirmar = RELEASE, falhar = ROLLBACK TO). */
async function emPontoDeEnsaio(trabalho) {
  const ponto = `ens_${(seqPonto += 1)}`;
  await controle(ensaioAtivo, `SAVEPOINT ${ponto}`);
  try {
    const resultado = await trabalho(envolver(ensaioAtivo));
    await controle(ensaioAtivo, `RELEASE SAVEPOINT ${ponto}`);
    return resultado;
  } catch (erro) {
    await controle(ensaioAtivo, `ROLLBACK TO SAVEPOINT ${ponto}`).catch(() => {});
    throw erro;
  }
}

/** Roda `trabalho(executor)` numa transação; confirma se terminar, desfaz se lançar. */
async function emTransacao(trabalho, { desfazerSempre = false } = {}) {
  if (ensaioAtivo) return emPontoDeEnsaio(trabalho);
  const { conexao, liberar } = await obterConexao();
  try {
    await controle(conexao, 'BEGIN');
    await controle(conexao, 'SET LOCAL statement_timeout = 10000');
    try {
      const resultado = await trabalho(envolver(conexao));
      await controle(conexao, desfazerSempre ? 'ROLLBACK' : 'COMMIT');
      return resultado;
    } catch (erro) {
      await controle(conexao, 'ROLLBACK').catch(() => {});
      throw erro;
    }
  } finally {
    liberar(conexao);
  }
}

/** Executor avulso (cada instrução sozinha), para leituras e auditoria fora de transação. */
async function executarAvulso(sql, valores) {
  exigirLigada();
  if (ensaioAtivo) return rodar(ensaioAtivo, sql, valores);
  const { conexao, liberar } = await obterConexao();
  try {
    return await rodar(conexao, sql, valores);
  } finally {
    liberar(conexao);
  }
}

/** O pool é o da A (fechado com a conexão principal): nada a fechar aqui. */
async function fecharEscrita() {}

module.exports = { BancoNovoError, escritaHabilitada, emTransacao, emEnsaio, executarAvulso, fecharEscrita, ehDuplicado };
