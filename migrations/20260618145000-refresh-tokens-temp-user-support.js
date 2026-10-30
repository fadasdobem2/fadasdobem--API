'use strict';

/**
 * Adiciona temp_user_id a refresh_tokens para suportar contas temporárias.
 * Exatamente um dos dois (user_id, temp_user_id) é preenchido por linha.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE refresh_tokens
        ADD COLUMN IF NOT EXISTS temp_user_id UUID NULL
          REFERENCES temporary_users(id) ON DELETE CASCADE ON UPDATE CASCADE;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS rt_temp_user_id_idx
        ON refresh_tokens (temp_user_id)
        WHERE temp_user_id IS NOT NULL;
    `);
    // Relaxa o NOT NULL de user_id para permitir linhas com só temp_user_id
    await sequelize.query(`
      ALTER TABLE refresh_tokens ALTER COLUMN user_id DROP NOT NULL;
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`ALTER TABLE refresh_tokens ALTER COLUMN user_id SET NOT NULL;`);
    await sequelize.query(`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS temp_user_id;`);
  },
};
