'use strict';

/**
 * Adiciona temp_client_id (nullable) a todas as tabelas que atualmente
 * têm client_id → clients.id, para que contas temporárias (temporary_clients)
 * possam usar a plataforma normalmente até a sincronização.
 *
 * Regra: exatamente um dos dois é preenchido por linha:
 *   client_id      → conta regular (users/clients)
 *   temp_client_id → conta temporária (temporary_users/temporary_clients)
 */
module.exports = {
  async up({ sequelize }) {
    const tables = [
      'sessions',
      'payment_orders',
      'client_credit_lots',
      'reviews',
      'client_diaries',
      'queues',
      'ledger_accounts',
    ];

    for (const table of tables) {
      await sequelize.query(`
        ALTER TABLE ${table}
          ADD COLUMN IF NOT EXISTS temp_client_id UUID NULL
            REFERENCES temporary_clients(id) ON DELETE SET NULL ON UPDATE CASCADE;
      `);

      await sequelize.query(`
        CREATE INDEX IF NOT EXISTS ${table}_temp_client_id_idx
          ON ${table} (temp_client_id)
          WHERE temp_client_id IS NOT NULL;
      `);
    }
  },

  async down({ sequelize }) {
    const tables = [
      'sessions',
      'payment_orders',
      'client_credit_lots',
      'reviews',
      'client_diaries',
      'queues',
      'ledger_accounts',
    ];

    for (const table of tables) {
      await sequelize.query(`
        ALTER TABLE ${table} DROP COLUMN IF EXISTS temp_client_id;
      `);
    }
  },
};
