'use strict';

const {
  sequelize,
  AccessPermission,
  AccessRole,
  AccessDepartment,
  AccessJobTitle,
  StaffProfile,
  User,
} = require('../models');
const { PERMISSION_AREAS, INITIAL_ROLES, INITIAL_CARGOS, INITIAL_SETORES } = require('./rbac.catalog');
const { nivelDe, ROOT_ROLE_ID } = require('./rbac.constants');
const { invalidateAllAccessCache } = require('./authorization.service');

async function upsertPermission(chave, rotulo, descricao, area, transaction) {
  const nivel = nivelDe(chave);
  let row = await AccessPermission.findOne({
    where: { chave },
    paranoid: false,
    transaction,
  });

  if (row) {
    if (row.deleted_at) await row.restore({ transaction });
    await row.update(
      {
        rotulo,
        descricao: descricao || null,
        area,
        nivel,
        ativo: true,
        custom: false,
      },
      { transaction }
    );
    return row;
  }

  return AccessPermission.create(
    {
      chave,
      rotulo,
      descricao: descricao || null,
      area,
      nivel,
      ativo: true,
      custom: false,
    },
    { transaction }
  );
}

async function seedPermissions(transaction) {
  const byChave = new Map();
  for (const area of PERMISSION_AREAS) {
    for (const perm of area.perms) {
      const row = await upsertPermission(
        perm.id,
        perm.nome,
        perm.desc,
        area.id,
        transaction
      );
      byChave.set(perm.id, row);
    }
  }
  return byChave;
}

async function seedRoles(permByChave, transaction) {
  for (const roleDef of INITIAL_ROLES) {
    const isAdmin = roleDef.id === ROOT_ROLE_ID;
    const [role] = await AccessRole.findOrCreate({
      where: { id: roleDef.id },
      defaults: {
        id: roleDef.id,
        nome: roleDef.nome,
        descricao: null,
        icone: roleDef.ico,
        cor_gradient: roleDef.g,
        all_access: isAdmin,
        sistema: isAdmin || !!roleDef.sistema,
        ativo: true,
      },
      transaction,
      paranoid: false,
    });

    if (role.deleted_at) await role.restore({ transaction });
    await role.update(
      {
        nome: roleDef.nome,
        icone: roleDef.ico,
        cor_gradient: roleDef.g,
        all_access: isAdmin,
        sistema: isAdmin || !!roleDef.sistema,
        ativo: true,
      },
      { transaction }
    );

    const permIds = [];
    if (!isAdmin && roleDef.perms) {
      for (const [chave, enabled] of Object.entries(roleDef.perms)) {
        if (!enabled) continue;
        const p = permByChave.get(chave);
        if (p) permIds.push(p.id);
      }
    } else if (isAdmin) {
      permIds.push(...[...permByChave.values()].map((p) => p.id));
    }

    if (permIds.length) {
      await role.setPermissions(permIds, { transaction });
    }
  }
}

async function seedDepartments(permByChave, transaction) {
  for (const setor of INITIAL_SETORES) {
    const [dept] = await AccessDepartment.findOrCreate({
      where: { id: setor.id },
      defaults: {
        id: setor.id,
        nome: setor.nome,
        descricao: setor.desc || null,
        icone: setor.ico,
        cor: setor.cor,
        ativo: true,
      },
      transaction,
      paranoid: false,
    });

    if (dept.deleted_at) await dept.restore({ transaction });
    await dept.update(
      {
        nome: setor.nome,
        descricao: setor.desc || null,
        icone: setor.ico,
        cor: setor.cor,
        ativo: true,
      },
      { transaction }
    );

    const permIds = [];
    if (setor.perms) {
      for (const [chave, enabled] of Object.entries(setor.perms)) {
        if (!enabled) continue;
        const p = permByChave.get(chave);
        if (p) permIds.push(p.id);
      }
    }
    await dept.setPermissions(permIds, { transaction });
  }
}

async function seedJobTitles(transaction) {
  for (const cargo of INITIAL_CARGOS) {
    const [row] = await AccessJobTitle.findOrCreate({
      where: { id: cargo.id },
      defaults: {
        id: cargo.id,
        nome: cargo.nome,
        descricao: cargo.desc || null,
        default_role_id: cargo.papel,
        icone: cargo.ico,
        cor: cargo.cor,
        ativo: true,
      },
      transaction,
      paranoid: false,
    });

    if (row.deleted_at) await row.restore({ transaction });
    await row.update(
      {
        nome: cargo.nome,
        descricao: cargo.desc || null,
        default_role_id: cargo.papel,
        icone: cargo.ico,
        cor: cargo.cor,
        ativo: true,
      },
      { transaction }
    );
  }
}

async function assignAdminToGestora(gestoraUserId, transaction) {
  const uid = `${gestoraUserId || ''}`.trim();
  if (!uid) return null;

  const user = await User.findByPk(uid, { transaction, paranoid: true });
  if (!user) return null;

  const adminRole = await AccessRole.findByPk(ROOT_ROLE_ID, { transaction });
  if (adminRole) {
    await user.addAccess_roles([adminRole], { transaction });
  }

  const gestaoDept = await AccessDepartment.findByPk('s2', { transaction });
  const coordCargo = await AccessJobTitle.findByPk('cg6', { transaction });

  let profile = await StaffProfile.findOne({
    where: { user_id: uid },
    transaction,
    paranoid: false,
  });

  const defaults = {
    user_id: uid,
    display_name: user.email?.split('@')[0] || 'Gestora',
    department_id: gestaoDept?.id || 's2',
    job_title_id: coordCargo?.id || null,
    staff_status: 'ativo',
    avatar_gradient: 'linear-gradient(135deg,#ff8fb1,#e52444)',
    avatar_initials: (user.email?.[0] || 'G').toUpperCase(),
  };

  if (!profile) {
    profile = await StaffProfile.create(defaults, { transaction });
  } else {
    if (profile.deleted_at) await profile.restore({ transaction });
    await profile.update(
      {
        department_id: profile.department_id || defaults.department_id,
        staff_status: profile.staff_status || 'ativo',
        avatar_gradient: profile.avatar_gradient || defaults.avatar_gradient,
        avatar_initials: profile.avatar_initials || defaults.avatar_initials,
      },
      { transaction }
    );
  }

  return profile;
}

/**
 * Idempotente — catálogo RBAC + admin role na gestora.
 * @param {{ gestoraUserId?: string }} params
 */
async function seedAccessCatalog({ gestoraUserId } = {}) {
  await sequelize.transaction(async (transaction) => {
    const permByChave = await seedPermissions(transaction);
    await seedRoles(permByChave, transaction);
    await seedDepartments(permByChave, transaction);
    await seedJobTitles(transaction);
    if (gestoraUserId) {
      await assignAdminToGestora(gestoraUserId, transaction);
    }
  });
  invalidateAllAccessCache();
  return { ok: true };
}

module.exports = { seedAccessCatalog, assignAdminToGestora };
