'use strict';
/**
 * Filho do comparador: caminho "estrito" de migração. Roda o runner oficial, mas antes tira do baseline
 * (sync dos models) tudo que uma migração posterior cria por SQL próprio: tabelas inteiras (CREATE TABLE
 * IF NOT EXISTS) e colunas (ADD COLUMN IF NOT EXISTS), e as colunas que apontam para tabelas removidas.
 * Assim, o banco resultante reflete o SQL das migrações (a "verdade" dos bancos existentes), e não o
 * que o sync dos models teria criado por baixo delas.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'migrations');
const BASELINE = '20260208150000-baseline-create-missing-tables.js';

function analisarMigracoes() {
  const tabelas = new Set();
  const colunas = new Map(); // tabela -> Set(colunas)
  const add = (t, c) => { if (!colunas.has(t)) colunas.set(t, new Set()); colunas.get(t).add(c); };
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js') && x !== BASELINE)) {
    const txt = fs.readFileSync(path.join(dir, f), 'utf8');
    const up = txt.split(/async down/)[0];
    for (const m of up.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)) tabelas.add(m[1]);
    for (const stmt of up.split(';')) {
      const t = stmt.match(/ALTER TABLE\s+(?:"?(\w+)"?)\s/);
      if (!t || t[1] === '${table}') continue;
      for (const c of stmt.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)) add(t[1], c[1]);
    }
    // laço `for (const table of tables)` com ADD COLUMN IF NOT EXISTS temp_client_id
    if (/ADD COLUMN IF NOT EXISTS temp_client_id/.test(up)) {
      const lista = up.match(/const tables = \[([\s\S]*?)\]/);
      for (const t of lista[1].matchAll(/'(\w+)'/g)) add(t[1], 'temp_client_id');
    }
  }
  return { tabelas, colunas };
}

/** Remove dos models o que as migrações criam por SQL próprio (ver cabeçalho). Chamar antes de rodar migrações. */
function prepararModelosEstritos(sequelize) {
  const { tabelas, colunas } = analisarMigracoes();
  const nome = (m) => { const t = m.getTableName(); return typeof t === 'string' ? t : t.tableName; };
  for (const m of [...sequelize.modelManager.models]) {
    if (tabelas.has(nome(m))) sequelize.modelManager.removeModel(m);
  }
  for (const m of sequelize.modelManager.models) {
    const fora = new Set(colunas.get(nome(m)) || []);
    for (const [k, a] of Object.entries(m.rawAttributes)) {
      const ref = a.references && a.references.model;
      const refT = ref && (typeof ref === 'string' ? ref : ref.tableName || (ref.getTableName && ref.getTableName()));
      if (fora.has(a.field || k) || (refT && tabelas.has(typeof refT === 'string' ? refT : refT.tableName))) {
        fora.add(a.field || k);
        delete m.rawAttributes[k];
      }
    }
    if (fora.size) {
      m.refreshAttributes();
      if (m.options.hooks) delete m.options.hooks.afterSync; // CHECKs dependem de colunas removidas
      const usaFora = (ix) => {
        const onde = ix.where ? (ix.where.val || JSON.stringify(ix.where)) : '';
        return [...fora].some((c) => onde.includes(c));
      };
      m._indexes = (m._indexes || []).filter(
        (ix) => !usaFora(ix) && !(ix.fields || []).some((f) => fora.has(typeof f === 'string' ? f : f.name || f.attribute))
      );
    }
  }
}

module.exports = { prepararModelosEstritos };

if (require.main === module) {
  (async () => {
    const { sequelize } = require('../../src/config/database');
    require('../../src/models');
    const { runMigrations } = require('../run-migrations');
    try {
      await sequelize.authenticate();
      prepararModelosEstritos(sequelize);
      await runMigrations();
    } catch (e) {
      console.error(e);
      process.exitCode = 1;
    } finally {
      await sequelize.close();
    }
  })();
}
