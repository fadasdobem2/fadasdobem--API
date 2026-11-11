'use strict';

// Só PostgreSQL novo. Não altera nem lê a estrutura do legado.
const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');
module.exports = {
  async up({ sequelize }) {
    await sequelize.query('ALTER TABLE gf_clientes_novos ALTER COLUMN nome TYPE VARCHAR(255)');
    for (const [nome, expr] of CHECKS.gf_clientes_novos.filter(([n]) => ['chk_clientes_novos_origem', 'chk_clientes_novos_nascimento'].includes(n))) {
      await sequelize.query(`ALTER TABLE gf_clientes_novos DROP CONSTRAINT IF EXISTS ${nome}`);
      await sequelize.query(`ALTER TABLE gf_clientes_novos ADD CONSTRAINT ${nome} CHECK (${expr})`);
    }
  },
};
