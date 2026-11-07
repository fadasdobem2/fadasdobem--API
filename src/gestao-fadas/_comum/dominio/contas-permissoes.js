'use strict';

/**
 * Permissão adicional "Ver minutagem total" (v706). Regras do CÓDIGO do front: features/auth/account-permissions.ts
 * (canReceiveDailyMinutesPermission, setDailyMinutesPermission, validAccountPermissions, assertAccountPermissionWrite) e
 * `canViewDailyMinutes` de features/domain/permissions.ts (`permissionsFor`). Puro; o relógio e o id do evento chegam por parâmetro.
 * Substituída: `canViewDailyMinutes = administradora || assistente || supervisora` (supervisora via papel). Agora a supervisora e a
 * atendente só veem com a permissão individual ligada pela administradora; administradora e assistente veem sempre.
 */

const MSG_SOMENTE_ADMIN = 'Somente a administradora pode alterar a permissão de minutagem total.';
const MSG_CONFIRA = 'Confira a permissão de minutagem total.';
const MSG_REGISTRO = 'Não foi possível registrar a alteração da permissão.';

const podeReceberMinutagem = (role) => role === 'atendente' || role === 'supervisora';

/** `canViewDailyMinutes` de `permissionsFor(role, individual)`. */
function veMinutagemTotal(role, individual = {}) {
  return role === 'administradora' || role === 'assistente' || ((role === 'supervisora' || role === 'atendente') && individual.viewDailyMinutes === true);
}

/** `setDailyMinutesPermission`: devolve a conta com a permissão e a trilha; lança `Error` com a mensagem do front. */
function definirMinutagem(conta, enabled, ator, at, eventId) {
  if (!ator || !ator.active || ator.role !== 'administradora') throw new Error(MSG_SOMENTE_ADMIN);
  if (typeof enabled !== 'boolean') throw new Error(MSG_CONFIRA);
  const proximo = podeReceberMinutagem(conta.role) && enabled;
  const anterior = Boolean(conta.permissions) && conta.permissions.viewDailyMinutes === true;
  if (anterior === proximo) return conta;
  if (!Number.isFinite(Date.parse(at)) || !`${eventId}`.trim() || typeof eventId !== 'string') throw new Error(MSG_REGISTRO);
  return {
    ...conta, permissions: { ...conta.permissions, viewDailyMinutes: proximo },
    permissionAudit: [...(conta.permissionAudit || []), { id: eventId, permission: 'viewDailyMinutes', before: anterior, after: proximo, at, actorId: ator.id, actorName: ator.name, actorRole: 'administradora' }],
  };
}

/** `validAccountPermissions`. */
function permissoesValidas(conta) {
  const p = conta.permissions;
  if (p !== undefined && (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((k) => k !== 'viewDailyMinutes') || (p.viewDailyMinutes !== undefined && typeof p.viewDailyMinutes !== 'boolean'))) return false;
  const a = conta.permissionAudit;
  if (a === undefined) return true;
  return Array.isArray(a) && new Set(a.map((l) => l && l.id)).size === a.length && a.every((l) => Boolean(l) && typeof l.id === 'string' && Boolean(l.id.trim()) && l.permission === 'viewDailyMinutes'
    && typeof l.before === 'boolean' && typeof l.after === 'boolean' && Number.isFinite(Date.parse(l.at)) && typeof l.actorId === 'string' && typeof l.actorName === 'string' && l.actorRole === 'administradora');
}

/** `assertAccountPermissionWrite`: quem não é administradora não muda a permissão nem a trilha de nenhuma conta. */
function exigirAdminParaPermissao(antes, depois, papelDoAtor) {
  if (papelDoAtor === 'administradora') return;
  const a = new Map((antes || []).map((c) => [c.id, c])); const d = new Map((depois || []).map((c) => [c.id, c]));
  const valor = (c) => JSON.stringify({ enabled: Boolean(c && c.permissions && c.permissions.viewDailyMinutes === true), audit: (c && c.permissionAudit) || [] });
  if ([...new Set([...a.keys(), ...d.keys()])].some((id) => valor(a.get(id)) !== valor(d.get(id)))) throw new Error(MSG_SOMENTE_ADMIN);
}

module.exports = { MSG_SOMENTE_ADMIN, MSG_CONFIRA, MSG_REGISTRO, podeReceberMinutagem, veMinutagemTotal, definirMinutagem, permissoesValidas, exigirAdminParaPermissao };
