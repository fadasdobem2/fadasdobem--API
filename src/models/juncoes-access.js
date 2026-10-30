'use strict';
/**
 * Tabelas de junção do RBAC (migração 20260706190000): só `created_at` (sem `updated_at`).
 * O Sequelize cria a junção implícita com `updated_at`, e as opções da associação não conseguem
 * desligá-lo (as do model de origem prevalecem); por isso as junções são definidas aqui, antes das
 * associações `belongsToMany` que apontam para elas pelo mesmo nome.
 */
const JUNCOES = ['access_role_permissions', 'access_department_permissions', 'access_user_roles'];

module.exports = (sequelize) => {
  for (const nome of JUNCOES) {
    sequelize.define(nome, {}, {
      tableName: nome,
      timestamps: true,
      createdAt: 'created_at',
      updatedAt: false,
      paranoid: false,
      indexes: [],
      validate: {},
    });
  }
};
