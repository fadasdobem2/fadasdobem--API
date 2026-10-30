'use strict';

/**
 * Travas de somente leitura da conexão com o banco LEGADO.
 *
 * O ASP32 ainda grava nessas tabelas (processaPgto.asp, updCliente.asp, salvaConsulta.asp...). Nada desta API pode
 * alterá-las. As travas são em camadas, para que uma falha de uma não abra o legado para escrita:
 *   1. Hooks do Sequelize recusam create/update/destroy/upsert nos models marcados `somenteLeitura`.
 *   2. `sequelize.query` só aceita SELECT/SHOW/DESCRIBE/EXPLAIN/WITH, sem `FOR UPDATE`, `LOCK IN SHARE MODE`
 *      nem `INTO OUTFILE`.
 *   3. A sessão do MySQL/MariaDB é aberta em `SET SESSION TRANSACTION READ ONLY` (ver connection.js).
 */

class LegadoSomenteLeituraError extends Error {
  constructor(detalhe) {
    super(`Banco legado é somente leitura: ${detalhe}`);
    this.name = 'LegadoSomenteLeituraError';
    this.statusCode = 500;
    this.codigo = 'LEGADO_SOMENTE_LEITURA';
  }
}

const COMANDOS_LEITURA = /^(select|show|describe|desc|explain|with)\b/i;
const PERIGOSOS = /\bfor\s+update\b|\block\s+in\s+share\s+mode\b|\binto\s+(outfile|dumpfile)\b|\bget_lock\s*\(/i;

function normalizarSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*(--[^\n]*\n\s*)*/g, '')
    .trim();
}

/** true se o texto SQL é uma leitura simples (uma só instrução). */
function ehLeitura(sql) {
  const limpo = normalizarSql(sql);
  if (!COMANDOS_LEITURA.test(limpo)) return false;
  if (PERIGOSOS.test(limpo)) return false;
  const semFinal = limpo.replace(/;\s*$/, '');
  return !/;/.test(semFinal.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, ''));
}

function aplicarSomenteLeitura(sequelize) {
  const recusar = (modelo, acao) => {
    throw new LegadoSomenteLeituraError(`${acao} em ${modelo && modelo.tableName ? modelo.tableName : 'tabela legada'}`);
  };
  const doModelo = (instancia) => (instancia && instancia.constructor) || null;

  for (const hook of ['beforeCreate', 'beforeUpdate', 'beforeSave', 'beforeDestroy', 'beforeUpsert']) {
    sequelize.addHook(hook, (instancia) => {
      const modelo = doModelo(instancia);
      if (modelo && modelo.options && modelo.options.somenteLeitura) recusar(modelo, hook.replace('before', '').toLowerCase());
    });
  }
  for (const hook of ['beforeBulkCreate', 'beforeBulkUpdate', 'beforeBulkDestroy']) {
    sequelize.addHook(hook, (arg) => {
      const modelo = Array.isArray(arg) ? doModelo(arg[0]) : arg && arg.model;
      if (!modelo || (modelo.options && modelo.options.somenteLeitura)) recusar(modelo, hook.replace('before', '').toLowerCase());
    });
  }

  const original = sequelize.query.bind(sequelize);
  sequelize.query = function consultaSomenteLeitura(sql, opcoes) {
    const texto = typeof sql === 'string' ? sql : sql && sql.query;
    if (!texto || !ehLeitura(texto)) {
      return Promise.reject(new LegadoSomenteLeituraError(`instrução recusada (${String(texto).slice(0, 60)}...)`));
    }
    return original(sql, opcoes);
  };
}

module.exports = { aplicarSomenteLeitura, ehLeitura, LegadoSomenteLeituraError };
