'use strict';

/**
 * Mensagens trocadas entre usuário e suporte em um pedido de recuperação de conta.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS account_recovery_messages (
        id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id      UUID          NOT NULL
          REFERENCES account_recovery_requests(id) ON DELETE CASCADE ON UPDATE CASCADE,
        -- NULL = mensagem do sistema; preenchido = quem enviou (usuário ou admin)
        sender_user_id  UUID          NULL
          REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
        -- 'USER' | 'ADMIN' | 'SYSTEM'
        sender_role     VARCHAR(16)   NOT NULL DEFAULT 'SYSTEM',
        body            TEXT          NOT NULL,
        -- Admin pode marcar como lida para controle de fila
        read_at         TIMESTAMPTZ   NULL,
        -- Timestamps
        created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
        deleted_at      TIMESTAMPTZ   NULL
      );
    `);

    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arm_request_id_created_idx
        ON account_recovery_messages (request_id, created_at ASC)
        WHERE deleted_at IS NULL;
    `);
    await sequelize.query(`
      CREATE INDEX IF NOT EXISTS arm_sender_user_id_idx
        ON account_recovery_messages (sender_user_id)
        WHERE sender_user_id IS NOT NULL;
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`DROP TABLE IF EXISTS account_recovery_messages;`);
  },
};
