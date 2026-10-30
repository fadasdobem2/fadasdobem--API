'use strict';

/**
 * Módulo RBAC — núcleo de autorização (flexível e escalável).
 *
 * Este é o ÚNICO ponto de entrada público do RBAC. Qualquer feature que
 * precise checar permissões, carregar contexto de acesso ou ler o catálogo
 * deve importar daqui — nunca dos arquivos internos:
 *
 *   const { pode, loadUserAccessContext, STAFF_ROLES } = require('../../rbac');
 *
 * Estrutura interna:
 *   - authorization.service.js  → motor (pode, contexto, cache)
 *   - rbac.constants.js         → papéis/níveis/flags (step-up, motivo)
 *   - rbac.catalog.js           → catálogo semente de permissões/papéis/setores/cargos
 *   - rbac.route-registry.js    → registro canônico de rotas ↔ permissões
 *   - rbac.root-admin.guard.js  → proteção do admin-raiz
 *   - rbac.seed.js              → seeding idempotente do catálogo
 *   - staff-invite.service.js   → tokens/convites de staff (compartilhado auth + admin)
 *
 * Middleware HTTP correlato mora em `src/middlewares/authorization.middleware.js`.
 */
const authorizationService = require('./authorization.service');
const rbacConstants = require('./rbac.constants');
const rbacCatalog = require('./rbac.catalog');
const routeRegistry = require('./rbac.route-registry');
const rootAdminGuard = require('./rbac.root-admin.guard');
const staffInviteService = require('./staff-invite.service');

module.exports = {
  ...authorizationService,
  ...rbacConstants,
  ...rootAdminGuard,
  catalog: rbacCatalog,
  routeRegistry,
  getRouteRegistry: routeRegistry.getRouteRegistry,
  staffInviteService,
};
