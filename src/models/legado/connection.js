'use strict';

/**
 * Conexão com o banco LEGADO (MySQL/MariaDB do ASP32), separada do PostgreSQL da API.
 *
 * - É criada sob demanda: a API sobe normalmente sem o legado configurado.
 * - Credenciais só por variáveis de ambiente `LEGADO_DB_*` (nunca no código). Use um usuário com `SELECT`
 *   apenas; este módulo ainda assim abre a sessão em somente leitura.
 * - Datas e horas voltam como TEXTO: o `sql_mode` do servidor é vazio e há valores `0000-00-00`.
 * - Pool pequeno (padrão 2) para não competir com o ASP no servidor compartilhado.
 */

const path = require('path');
const { Sequelize } = require('sequelize');
const { aplicarSomenteLeitura } = require('./somente-leitura');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '..', '.env') });

class LegadoNaoConfiguradoError extends Error {
  constructor() {
    super('Banco legado não configurado. Defina LEGADO_DB_HOST, LEGADO_DB_NAME, LEGADO_DB_USER e LEGADO_DB_PASSWORD.');
    this.name = 'LegadoNaoConfiguradoError';
    this.statusCode = 503;
    this.codigo = 'LEGADO_NAO_CONFIGURADO';
  }
}

function envInt(nome, padrao) {
  const n = Number.parseInt(`${process.env[nome] ?? ''}`.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : padrao;
}

function lerConfig() {
  const e = process.env;
  const host = `${e.LEGADO_DB_HOST || ''}`.trim();
  const nome = `${e.LEGADO_DB_NAME || ''}`.trim();
  const usuario = `${e.LEGADO_DB_USER || ''}`.trim();
  return {
    configurado: Boolean(host && nome && usuario),
    host,
    port: envInt('LEGADO_DB_PORT', 3306),
    nome,
    usuario,
    senha: e.LEGADO_DB_PASSWORD || '',
    ssl: e.LEGADO_DB_SSL === 'true',
    poolMax: envInt('LEGADO_DB_POOL_MAX', 2),
    statementSegundos: envInt('LEGADO_DB_STATEMENT_TIMEOUT_S', 10),
    somenteLeitura: e.LEGADO_DB_READ_ONLY !== 'false',
    logging: e.LEGADO_DB_LOGGING === 'true' ? console.log : false,
  };
}

function legadoConfigurado() {
  return lerConfig().configurado;
}

/** Datas/horas como texto, exatamente como o servidor devolve (inclusive `0000-00-00`). */
const TIPOS_DATA = new Set(['DATETIME', 'TIMESTAMP', 'DATE', 'NEWDATE', 'TIME']);
function datasComoTexto(campo, proximo) {
  if (TIPOS_DATA.has(campo.type)) return campo.string();
  return proximo();
}

let instancia = null;

function getLegadoSequelize() {
  if (instancia) return instancia;
  const cfg = lerConfig();
  if (!cfg.configurado) throw new LegadoNaoConfiguradoError();

  const sequelize = new Sequelize(cfg.nome, cfg.usuario, cfg.senha, {
    dialect: 'mysql',
    host: cfg.host,
    port: cfg.port,
    logging: cfg.logging,
    timezone: '+00:00',
    pool: { max: cfg.poolMax, min: 0, acquire: 10000, idle: 10000 },
    define: { timestamps: false, freezeTableName: true, underscored: false },
    dialectOptions: {
      charset: 'utf8mb4',
      connectTimeout: 10000,
      typeCast: datasComoTexto,
      ...(cfg.ssl ? { ssl: { rejectUnauthorized: process.env.LEGADO_DB_SSL_REJECT_UNAUTHORIZED !== 'false' } } : {}),
    },
  });

  // Ajustes de sessão, cada um tolerante a diferença entre MySQL e MariaDB.
  sequelize.addHook('afterConnect', async (conexao) => {
    const executar = async (sql) => {
      try {
        await conexao.promise().query(sql);
      } catch (e) {
        if (cfg.logging) cfg.logging(`[legado] sessão ignorou "${sql}": ${e.message}`);
      }
    };
    await executar("SET SESSION time_zone = '+00:00'");
    await executar(`SET SESSION max_statement_time = ${cfg.statementSegundos}`); // MariaDB
    await executar(`SET SESSION max_execution_time = ${cfg.statementSegundos * 1000}`); // MySQL 5.7.8+
    if (cfg.somenteLeitura) await executar('SET SESSION TRANSACTION READ ONLY');
  });

  if (cfg.somenteLeitura) aplicarSomenteLeitura(sequelize);
  instancia = sequelize;
  return instancia;
}

async function fecharLegado() {
  if (instancia) {
    await instancia.close();
    instancia = null;
  }
}

/** Verificação rápida para health/diagnóstico. Não expõe credenciais. */
async function statusLegado() {
  const cfg = lerConfig();
  if (!cfg.configurado) return { configurado: false, conectado: false };
  try {
    const sequelize = getLegadoSequelize();
    const [linhas] = await sequelize.query('SELECT 1 AS ok');
    return { configurado: true, conectado: Boolean(linhas && linhas.length), somenteLeitura: cfg.somenteLeitura };
  } catch (e) {
    return { configurado: true, conectado: false, erro: e.name };
  }
}

module.exports = { legadoConfigurado, getLegadoSequelize, fecharLegado, statusLegado, LegadoNaoConfiguradoError, datasComoTexto };
