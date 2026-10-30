'use strict';

/**
 * Mapa canónico rota → permissão RBAC.
 * Usado por novos módulos admin/staff e como referência para auditoria.
 * Formato: { method, path, permission, stepUp?, motivo? }
 */
const REGISTRY = [
  /* --- Access / RBAC --- */
  { method: 'GET', path: '/admin/access/meta', permission: null, note: 'staff + snapshot UI' },
  { method: 'GET', path: '/admin/access/me', permission: null },
  { method: 'POST', path: '/admin/access/check', permission: null },
  { method: 'GET', path: '/admin/access/catalog', permission: null },
  { method: 'GET', path: '/admin/access/registry', permission: 'auditoria.ver' },

  /* --- Papéis --- */
  { method: 'GET', path: '/admin/access/roles', permission: 'papeis.editar' },
  { method: 'POST', path: '/admin/access/roles', permission: 'papeis.criar', motivo: true },
  { method: 'PATCH', path: '/admin/access/roles/:id', permission: 'papeis.editar', stepUp: true },
  { method: 'DELETE', path: '/admin/access/roles/:id', permission: 'papeis.excluir', stepUp: true, motivo: true },
  { method: 'PATCH', path: '/admin/access/roles/:id/permissions', permission: 'papeis.editar', stepUp: true },

  /* --- Staff --- */
  { method: 'GET', path: '/admin/access/staff', permission: 'usuarios.editar' },
  { method: 'POST', path: '/admin/access/staff', permission: 'usuarios.criar', motivo: true },
  { method: 'PATCH', path: '/admin/access/staff/:id/status', permission: 'usuarios.excluir', stepUp: true, motivo: true },
  { method: 'POST', path: '/admin/access/staff/:id/exceptions', permission: 'usuarios.editar', motivo: true },
  { method: 'POST', path: '/admin/access/staff/:id/resend-invite', permission: 'usuarios.criar' },
  { method: 'POST', path: '/admin/access/staff/:id/reset-password', permission: 'usuarios.editar' },
  { method: 'POST', path: '/admin/access/staff/:id/force-password-change', permission: 'usuarios.editar' },
  { method: 'POST', path: '/admin/access/staff/:id/end-sessions', permission: 'usuarios.editar' },
  { method: 'POST', path: '/admin/access/staff/:id/cancel-invite', permission: 'usuarios.criar' },

  /* --- Auditoria --- */
  { method: 'GET', path: '/admin/audit', permission: 'auditoria.ver', stepUp: true },

  /* --- Admin existente --- */
  { method: 'GET', path: '/admin/metrics/dashboard', permission: 'relatorios.ver' },
  { method: 'GET', path: '/admin/specialists/list', permission: 'tarologas.ver' },
  { method: 'PATCH', path: '/admin/specialists/approve/:id', permission: 'tarologas.aprovar_cand' },
  { method: 'GET', path: '/admin/finance/transactions', permission: 'dinheiro.recebimentos' },
  { method: 'PATCH', path: '/admin/finance/payouts/:id', permission: 'dinheiro.pagar_tarologas', motivo: true },
  { method: 'GET', path: '/admin/users/search', permission: 'clientes.buscar' },
  { method: 'PATCH', path: '/admin/users/block/:id', permission: 'clientes.bloquear', motivo: true },

  /* --- Futuro: chat (ASAS proxy) --- */
  { method: 'GET', path: '/admin/chat/conversations', permission: 'chat.trabalhar', future: true },
  { method: 'POST', path: '/admin/chat/conversations/:id/reply', permission: 'chat.trabalhar', future: true },
  { method: 'GET', path: '/admin/chat/grupo', permission: 'chat.ver_grupo', future: true },
  { method: 'PATCH', path: '/admin/chat/rapidas/:id', permission: 'chat.rapidas_time', future: true },

  /* --- Futuro: consultas --- */
  { method: 'GET', path: '/admin/consultas', permission: 'consultas.ver', future: true },
  { method: 'GET', path: '/admin/consultas/fila', permission: 'consultas.fila', future: true },
  { method: 'PATCH', path: '/admin/consultas/:id/encerrar', permission: 'consultas.encerrar', motivo: true, future: true },
  { method: 'PATCH', path: '/admin/consultas/:id/tempo', permission: 'consultas.ajustar_tempo', motivo: true, future: true },
  { method: 'PATCH', path: '/admin/consultas/:id/cancelar-cobranca', permission: 'consultas.cancelar_cobranca', stepUp: true, motivo: true, future: true },

  /* --- Futuro: clientes --- */
  { method: 'GET', path: '/admin/clientes', permission: 'clientes.listar', stepUp: true, future: true },
  { method: 'GET', path: '/admin/clientes/:id/historico-completo', permission: 'clientes.historico_completo', stepUp: true, future: true },
  { method: 'GET', path: '/admin/clientes/:id/cpf', permission: 'clientes.cpf_completo', future: true },

  /* --- Futuro: conteúdo / ajustes --- */
  { method: 'PATCH', path: '/admin/conteudo/:id/publicar', permission: 'conteudo.publicar', future: true },
  { method: 'POST', path: '/admin/conteudo/newsletter', permission: 'conteudo.newsletter', motivo: true, future: true },
  { method: 'PATCH', path: '/admin/ajustes/integracoes', permission: 'ajustes.integracoes', stepUp: true, motivo: true, future: true },
  { method: 'PATCH', path: '/admin/dinheiro/precos', permission: 'dinheiro.precos', motivo: true, future: true },
];

function getRouteRegistry({ includeFuture = true } = {}) {
  return includeFuture ? REGISTRY : REGISTRY.filter((r) => !r.future);
}

function findPermissionForRoute(method, path) {
  const m = `${method || 'GET'}`.toUpperCase();
  return REGISTRY.find((r) => r.method === m && r.path === path) || null;
}

module.exports = {
  REGISTRY,
  getRouteRegistry,
  findPermissionForRoute,
};
