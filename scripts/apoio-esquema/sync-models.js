'use strict';
/** Filho do comparador: cria o esquema só pelos models (mesma rotina do baseline), no banco de DB_NAME. */
const { sequelize } = require('../../src/config/database');
require('../../src/models');
const { criarEsquemaDosModels } = require('../../migrations/20260208150000-baseline-create-missing-tables');

(async () => {
  try {
    await sequelize.authenticate();
    await criarEsquemaDosModels(sequelize);
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
})();
