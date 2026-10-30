'use strict';

/**
 * Helpers compartilhados do módulo de acesso (RBAC admin).
 * Apresentadores (`*ToFront`), formatadores, includes e queries usadas por 2+
 * submódulos (roles / permissions / departments / jobtitles / staff / meta).
 * NÃO contém regras de escrita — só leitura/formatação reutilizável.
 */
const { Op } = require('sequelize');
const {
  User,
  StaffProfile,
  AccessPermission,
  AccessRole,
  AccessDepartment,
  AccessJobTitle,
  AccessUserException,
} = require('../../../models');
const { roleHasAllAccess } = require('../../../rbac/authorization.service');

function httpCtxNormalize(httpCtx = {}) {
  return {
    ip: httpCtx.ip,
    user_agent: httpCtx.userAgent || httpCtx.user_agent,
    correlation_id: httpCtx.correlationId || httpCtx.correlation_id,
  };
}

function slugifyId(raw, prefix = '') {
  const base = `${raw || ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const stamp = Date.now().toString(36);
  return `${prefix}${base || 'item'}_${stamp}`.slice(0, 64);
}

function initialsFromName(name) {
  const parts = `${name || ''}`.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatRelativeDate(date) {
  if (!date) return '—';
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 60_000) return 'agora';
  if (ms < 3_600_000) return `há ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `há ${Math.floor(ms / 3_600_000)}h`;
  if (ms < 604_800_000) return `há ${Math.floor(ms / 86_400_000)} dias`;
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(new Date(date));
}

function formatCreatedDate(date) {
  if (!date) return '—';
  return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' }).format(new Date(date));
}

function permissionsRecord(perms = []) {
  const out = {};
  for (const p of perms) {
    if (p?.chave) out[p.chave] = 1;
  }
  return out;
}

function roleToFront(role, pessoas = 0) {
  if (!role) return null;
  const plain = role.get ? role.get({ plain: true }) : role;
  const all = roleHasAllAccess(role);
  return {
    id: plain.id,
    nome: plain.nome,
    desc: plain.descricao || '',
    ico: plain.icone,
    g: plain.cor_gradient || 'linear-gradient(135deg,#a9b6c4,#6b7f92)',
    pessoas,
    sistema: !!plain.sistema,
    off: plain.ativo === false,
    perms: all ? 'ALL' : permissionsRecord(plain.permissions),
  };
}

function setorToFront(dept) {
  if (!dept) return null;
  const plain = dept.get ? dept.get({ plain: true }) : dept;
  return {
    id: plain.id,
    nome: plain.nome,
    desc: plain.descricao || '',
    ico: plain.icone,
    cor: plain.cor,
    off: plain.ativo === false,
    perms: permissionsRecord(plain.permissions),
  };
}

function cargoToFront(job) {
  if (!job) return null;
  const plain = job.get ? job.get({ plain: true }) : job;
  return {
    id: plain.id,
    nome: plain.nome,
    desc: plain.descricao || '',
    papel: plain.default_role_id,
    ico: plain.icone,
    cor: plain.cor,
    off: plain.ativo === false,
  };
}

function usuarioToFront(userRow) {
  const user = userRow.get ? userRow.get({ plain: true }) : userRow;
  const profile = user.staff_profile || {};
  const dept = profile.access_department;
  const job = profile.access_job_title;
  const roleIds = (user.access_roles || []).map((r) => r.id);
  const addr = profile.address_json || {};
  const pay = profile.payment_json || {};
  const displayName = profile.display_name || user.email?.split('@')[0] || '—';

  return {
    id: user.id,
    nome: displayName,
    ini: profile.avatar_initials || initialsFromName(displayName),
    g: profile.avatar_gradient || 'linear-gradient(135deg,#86a7bd,#51829b)',
    email: user.email,
    papeis: roleIds,
    setor: dept?.nome || profile.department || '',
    setorId: profile.department_id || dept?.id || null,
    cargo: job?.nome || '',
    cargoId: profile.job_title_id || job?.id || null,
    status: profile.staff_status || 'ativo',
    mustChangePassword: !!profile.must_change_password,
    ultimo: formatRelativeDate(user.last_login_at),
    criado: formatCreatedDate(user.created_at || profile.created_at),
    cpf: profile.cpf || '',
    nasc: profile.birth_date || '',
    whats: profile.whatsapp || '',
    whats2: profile.whatsapp2 || '',
    emailPessoal: profile.personal_email || '',
    vinculo: profile.vinculo || '',
    cep: addr.cep || '',
    rua: addr.rua || '',
    num: addr.num || '',
    compl: addr.compl || '',
    bairro: addr.bairro || '',
    cidade: addr.cidade || '',
    uf: addr.uf || '',
    pixTipo: pay.pixTipo || '',
    pixChave: pay.pixChave || '',
    banco: pay.banco || '',
    ag: pay.ag || '',
    conta: pay.conta || '',
    exceptions: (user.access_exceptions || []).map((ex) => ({
      id: ex.id,
      chave: ex.permission?.chave,
      granted: ex.granted,
      motivo: ex.motivo,
    })),
  };
}

async function countRoleUsers(roleId) {
  const count = await User.count({
    include: [
      {
        model: AccessRole,
        as: 'access_roles',
        where: { id: roleId },
        required: true,
        attributes: [],
      },
      {
        model: StaffProfile,
        as: 'staff_profile',
        required: true,
        where: { staff_status: { [Op.ne]: 'desativado' } },
        attributes: [],
      },
    ],
    where: { role: { [Op.in]: ['GESTORA', 'ATENDENTE'] } },
    distinct: true,
  });
  return count;
}

async function staffInclude() {
  return [
    {
      model: StaffProfile,
      as: 'staff_profile',
      required: true,
      include: [
        { model: AccessDepartment, as: 'access_department', required: false },
        { model: AccessJobTitle, as: 'access_job_title', required: false },
      ],
    },
    {
      model: AccessRole,
      as: 'access_roles',
      required: false,
    },
    {
      model: AccessUserException,
      as: 'access_exceptions',
      required: false,
      include: [{ model: AccessPermission, as: 'permission', required: false }],
    },
  ];
}

module.exports = {
  httpCtxNormalize,
  slugifyId,
  initialsFromName,
  formatRelativeDate,
  formatCreatedDate,
  permissionsRecord,
  roleToFront,
  setorToFront,
  cargoToFront,
  usuarioToFront,
  countRoleUsers,
  staffInclude,
};
