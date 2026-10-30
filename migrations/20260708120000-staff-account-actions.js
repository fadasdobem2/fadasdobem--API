'use strict';

/**
 * Ações de conta da equipa interna (g34):
 * - must_change_password: força o utilizador a redefinir a senha no próximo login.
 *   Usado por POST /admin/access/staff/:id/force-password-change.
 */
module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE staff_profiles
        ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
    `);
  },

  async down({ sequelize }) {
    await sequelize.query(`
      ALTER TABLE staff_profiles
        DROP COLUMN IF EXISTS must_change_password;
    `);
  },
};
