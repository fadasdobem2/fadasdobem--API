'use strict';

/**
 * Executor do espelho no legado: conexão própria (`LEGADO_DB_*`), sessão com `sql_mode` ESTRITO, e cada instrução passa pela
 * allowlist de `sql.js` ANTES de ir ao servidor. Desligado por padrão: `GF_LEGADO_ESCRITA_ENABLED=true` é o único interruptor do
 * espelho real. O ensaio (`emEnsaio`) NÃO usa o interruptor: roda numa transação que NUNCA confirma (ROLLBACK no fim) e recusa
 * qualquer banco que não seja de desenvolvimento (nome terminando em 01/dev/teste) e o de produção `fadasdobem`.
 */

const mysql = require('mysql2/promise');
const { motivoDeRecusa } = require('./sql');

/** Estrito, sem `NO_ZERO_DATE`: o legado usa `0000-00-00 00:00:00` como "aberta" em `fimConsulta`. */
const MODO_SQL = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION';

class EspelhoLegadoError extends Error {
  constructor(codigo, detalhe) { super(detalhe); this.name = 'EspelhoLegadoError'; this.codigo = codigo; }
}

const ligada = (env, nome) => `${env[nome] || ''}`.trim().toLowerCase() === 'true';

/** Uma flag POR ENTIDADE, além do interruptor geral (`GF_LEGADO_ESCRITA_ENABLED`). Consulta segue só com o geral (comportamento de antes). Nenhuma é ligada no local. */
const FLAGS_ENTIDADE = Object.freeze({ clientes: 'GF_LEGADO_CLIENTES', tarologos: 'GF_LEGADO_TAROLOGOS', pagamentos: 'GF_LEGADO_PAGAMENTOS' });

function espelhoLigado(env = process.env, entidade) {
  if (!ligada(env, 'GF_LEGADO_ESCRITA_ENABLED')) return false;
  if (entidade === undefined) return true;
  return FLAGS_ENTIDADE[entidade] ? ligada(env, FLAGS_ENTIDADE[entidade]) : false;
}

function configuracao(env = process.env) {
  const host = `${env.LEGADO_DB_HOST || ''}`.trim(); const database = `${env.LEGADO_DB_NAME || ''}`.trim(); const user = `${env.LEGADO_DB_USER || ''}`.trim();
  if (!host || !database || !user) throw new EspelhoLegadoError('LEGADO_NAO_CONFIGURADO', 'Banco do suspiro não configurado (LEGADO_DB_*).');
  return { host, database, user, password: env.LEGADO_DB_PASSWORD || '', port: Number.parseInt(env.LEGADO_DB_PORT || '3306', 10) || 3306,
    ...(env.LEGADO_DB_SSL === 'true' ? { ssl: { rejectUnauthorized: env.LEGADO_DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}) };
}

const bancoDeDev = (nome) => /(01|dev|teste)$/i.test(nome) && !/^fadasdobem$/i.test(nome);

let pool = null;
function obterPool() {
  if (pool) return pool;
  pool = mysql.createPool({ ...configuracao(), charset: 'utf8mb4', connectionLimit: 2, connectTimeout: 10000, dateStrings: true, timezone: 'Z', multipleStatements: false });
  return pool;
}

/** Interface `execute(sql, valores) -> [linhas]`, com a allowlist na frente. */
function envolver(conexao) {
  return {
    execute: async (sql, valores) => {
      const motivo = motivoDeRecusa(sql);
      if (motivo) throw new EspelhoLegadoError('LEGADO_ESCRITA_RECUSADA', `Escrita recusada: ${motivo}`);
      return conexao.execute(sql, valores);
    },
    // `query` só para o controle da transação (também passa pela allowlist).
    query: async (sql) => {
      const motivo = motivoDeRecusa(sql);
      if (motivo) throw new EspelhoLegadoError('LEGADO_ESCRITA_RECUSADA', `Escrita recusada: ${motivo}`);
      return conexao.query(sql);
    },
  };
}

async function abrir() {
  const conexao = await obterPool().getConnection();
  await conexao.query('SET SESSION sql_mode = ?', [MODO_SQL]);
  const modo = (await conexao.query('SELECT @@SESSION.sql_mode AS m'))[0][0].m;
  if (!/STRICT_ALL_TABLES/.test(modo)) { conexao.release(); throw new EspelhoLegadoError('MODO_NAO_ESTRITO', 'A sessão do legado não ficou em modo estrito.'); }
  await conexao.query('SET SESSION max_statement_time = 10').catch(() => {});
  return conexao;
}

/** Espelho real: precisa de `GF_LEGADO_ESCRITA_ENABLED=true` (e da flag da entidade, quando `entidade` é dada). Confirma se terminar, desfaz se lançar. */
async function emTransacao(trabalho, { entidade } = {}) {
  if (!espelhoLigado(process.env, entidade)) throw new EspelhoLegadoError('ESPELHO_DESLIGADO', `O espelho no legado está desligado (GF_LEGADO_ESCRITA_ENABLED${entidade ? ` e ${FLAGS_ENTIDADE[entidade] || 'flag da entidade'}` : ''}).`);
  const conexao = await abrir();
  const ex = envolver(conexao);
  try {
    await ex.query('START TRANSACTION');
    try { const r = await trabalho(ex); await ex.query('COMMIT'); return r; } catch (e) { await conexao.query('ROLLBACK').catch(() => {}); throw e; }
  } finally { conexao.release(); }
}

/** Só estas tabelas podem ser trocadas por cópia no ensaio (o nome entra no SQL: lista fixa, nunca texto livre). */
const TABELAS_ENSAIO = Object.freeze(['tbl_consultas', 'usuarios', 'tbl_tarologos']);

/**
 * Troca cada tabela pedida por uma tabela TEMPORÁRIA InnoDB da mesma estrutura, SÓ nesta sessão. Motivo (achado de 29/10/2026): no legado
 * `tbl_consultas` e `tbl_tarologos` são MyISAM, inclusive no banco de dev, e o ROLLBACK NÃO desfaz escrita em MyISAM. Sem a troca, o "ensaio com
 * rollback" gravaria de verdade (`usuarios` é InnoDB, mas também é trocada: o ensaio nunca depende do engine). A DDL é uma única instrução
 * `CREATE TEMPORARY TABLE` montada do `SHOW CREATE TABLE` (nunca um ALTER: se a criação falhar, nada acontece com a tabela real) e some sozinha
 * quando a conexão fecha. `sementes` (`{ tabela: { coluna, valores } }`) copia para a cópia ALGUMAS linhas reais (leitura da real, antes da troca),
 * para o ensaio poder fazer UPDATE; a cópia começa vazia quando não há semente.
 */
async function isolarTabelasNoEnsaio(conexao, tabelas, sementes = {}) {
  const ddls = {};
  for (const t of tabelas) {
    if (!TABELAS_ENSAIO.includes(t)) throw new EspelhoLegadoError('ENSAIO_RECUSADO', `Tabela fora da lista do ensaio: ${t}.`);
    const [[linha]] = await conexao.query('SHOW CREATE TABLE ??', [t]);
    const ddl = String(linha['Create Table'] || '')
      .replace(/^CREATE TABLE/i, 'CREATE TEMPORARY TABLE')
      .replace(/\bENGINE=\w+/i, 'ENGINE=InnoDB')
      .replace(/\bAUTO_INCREMENT=\d+/i, 'AUTO_INCREMENT=1')
      .replace(/\s(PACK_KEYS|DELAY_KEY_WRITE|CHECKSUM)=\d+/gi, '');
    if (!new RegExp(`^CREATE TEMPORARY TABLE \`${t}\``).test(ddl) || !/ENGINE=InnoDB/.test(ddl)) throw new EspelhoLegadoError('ENSAIO_RECUSADO', `Não foi possível montar a tabela temporária do ensaio (${t}).`);
    ddls[t] = ddl;
    const s = sementes[t];
    if (s) await conexao.query('CREATE TEMPORARY TABLE ?? AS SELECT * FROM ?? WHERE ?? IN (?)', [`__semente_${t}`, t, s.coluna, s.valores]);
  }
  for (const t of tabelas) {
    await conexao.query(ddls[t]);
    if (sementes[t]) await conexao.query('INSERT INTO ?? SELECT * FROM ??', [t, `__semente_${t}`]);
  }
}

/**
 * ENSAIO: uma transação que NUNCA confirma, só em banco de desenvolvimento, sobre cópias TEMPORÁRIAS InnoDB das tabelas pedidas
 * (`tabelas`, padrão `tbl_consultas`; ver `isolarTabelasNoEnsaio`): a tabela de verdade não recebe nada, e o ROLLBACK é de verdade na cópia.
 */
async function emEnsaio(trabalho, { tabelas = ['tbl_consultas'], sementes = {} } = {}) {
  const nome = configuracao().database;
  if (!bancoDeDev(nome)) throw new EspelhoLegadoError('ENSAIO_RECUSADO', `Ensaio só roda em banco de desenvolvimento (recebido: ${nome}).`);
  const conexao = await abrir();
  const ex = envolver(conexao);
  try {
    await isolarTabelasNoEnsaio(conexao, tabelas, sementes);
    await ex.query('START TRANSACTION');
    // `leitura`: SELECT puro (uma instrução) direto na conexão do ensaio, para o ensaio conferir linhas inteiras que a allowlist de escrita não lê. Nunca escreve.
    const leitura = async (sql, valores) => {
      if (!/^\s*SELECT\b/i.test(sql) || /;/.test(sql)) throw new EspelhoLegadoError('LEGADO_ESCRITA_RECUSADA', 'A leitura do ensaio só aceita um SELECT.');
      return (await conexao.query(sql, valores))[0];
    };
    return await trabalho(ex, leitura);
  } finally {
    await conexao.query('ROLLBACK').catch(() => {});
    // Destrói (não devolve ao pool): a conexão carrega as tabelas temporárias e não pode servir a mais ninguém.
    conexao.destroy();
  }
}

async function fechar() { if (pool) { await pool.end(); pool = null; } }

module.exports = { MODO_SQL, EspelhoLegadoError, FLAGS_ENTIDADE, TABELAS_ENSAIO, espelhoLigado, bancoDeDev, emTransacao, emEnsaio, fechar };
