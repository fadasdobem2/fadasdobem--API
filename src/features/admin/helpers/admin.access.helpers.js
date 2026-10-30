'use strict';

const { AccessPermission } = require('../../../models');

async function resolvePermissionByIdOrChave(idOrChave) {
  const raw = `${idOrChave || ''}`.trim();
  if (!raw) return null;
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
  if (isUuid) return AccessPermission.findByPk(raw);
  return AccessPermission.findOne({ where: { chave: raw } });
}

module.exports = { resolvePermissionByIdOrChave };
