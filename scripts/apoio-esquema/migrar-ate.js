'use strict';
/**
 * Filho dos ensaios: aplica só as N primeiras migrações de uma árvore do projeto (padrão: esta),
 * registrando em `_schema_migrations` como o runner oficial. Uso: node migrar-ate.js <N> [raiz] [--sem-registro] [--historico]
 * `--sem-registro` simula um banco criado só pelos models (sem tabela de controle de migrações).
 */
const fs = require('fs');
const path = require('path');

const N = Number(process.argv[2]);
const raiz = path.resolve(process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : path.join(__dirname, '..', '..'));
const semRegistro = process.argv.includes('--sem-registro');
const historico = process.argv.includes('--historico'); // models sem o que as migrações criam por SQL (estado dos bancos antigos)

const { sequelize } = require(path.join(raiz, 'src/config/database'));
require(path.join(raiz, 'src/models'));
if (historico) require('./migrar-estrito').prepararModelosEstritos(sequelize);

(async () => {
  try {
    await sequelize.authenticate();
    if (!semRegistro) {
      await sequelize.query(`CREATE TABLE IF NOT EXISTS "_schema_migrations" ("name" VARCHAR(255) NOT NULL PRIMARY KEY, "executed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    }
    const dir = path.join(raiz, 'migrations');
    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && !f.startsWith('.')).sort().slice(0, N);
    for (const f of arquivos) {
      await require(path.join(dir, f)).up({ sequelize, queryInterface: sequelize.getQueryInterface(), Sequelize: require('sequelize') });
      if (!semRegistro) await sequelize.query(`INSERT INTO "_schema_migrations" ("name") VALUES (:f)`, { replacements: { f } });
    }
    console.log(`aplicadas ${arquivos.length}`);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
