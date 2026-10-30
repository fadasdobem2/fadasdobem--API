'use strict';

/**
 * Transação das contas: UMA conexão do Postgres da A com duas portas. `t` é a transação Sequelize (tabelas da A: `users`,
 * `staff_profiles`, `specialists`, `access_user_roles`, `refresh_tokens`) e `ex` é o executor do banco novo (só `gf_*`, mesma allowlist
 * de `novo/banco-novo.js`) sobre a MESMA conexão. Efeito, `gf_contas_ext`, `gf_operacoes` e `gf_auditoria` confirmam ou desfazem juntos.
 * O MySQL legado nunca é tocado aqui.
 */

const AppError = require('../../../utils/AppError');
const { escritaHabilitada } = require('../../novo/escritor');
const { traduzir } = require('../../novo/traducao-sql');

const recusa = (motivo) => new Error(`Escrita recusada: ${motivo}`);
const TEXTO = new Set([1082, 1114, 3802, 114]);
const TIPOS = {
  getTypeParser: (oid, formato) => {
    const pg = require('pg');
    if (TEXTO.has(oid)) return (v) => v;
    if (oid === 20) return (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : v);
    return pg.types.getTypeParser(oid, formato);
  },
};

function executorSobre(conexao) {
  const rodar = async (sql, valores = []) => {
    const { texto } = traduzir(sql, recusa);
    const r = await conexao.query({ text: texto, values: valores.map((v) => (v === undefined ? null : v)), types: TIPOS });
    return /^\s*select\b/i.test(texto) ? [r.rows] : [{ affectedRows: r.rowCount, rows: r.rows }];
  };
  return { execute: rodar, query: rodar };
}

/** `trabalho(ex, t)`. Escrita desligada: 503 WRITE_DISABLED (a leitura segue funcionando). */
async function emTransacaoContas(trabalho) {
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  const { sequelize } = require('../../../config/database');
  return sequelize.transaction(async (t) => {
    await sequelize.query('SET LOCAL statement_timeout = 15000', { transaction: t });
    return trabalho(executorSobre(t.connection), t);
  });
}

module.exports = { emTransacaoContas };
