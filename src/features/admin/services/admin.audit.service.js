'use strict';

const { Op } = require('sequelize');
const { AuditLog, User } = require('../../../models');
const AppError = require('../../../utils/AppError');

function parseDate(raw, endOfDay = false) {
  const s = `${raw ?? ''}`.trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new AppError('Data inválida em filtros de auditoria.', 400, null, true);
  }
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

async function listAuditLogs(query = {}) {
  const where = {};

  const action = `${query.action ?? ''}`.trim();
  if (action) where.action = action;

  const adminId = `${query.admin_id ?? query.adminId ?? ''}`.trim();
  if (adminId) where.admin_id = adminId;

  const targetEntity = `${query.target_entity ?? query.targetEntity ?? ''}`.trim();
  if (targetEntity) where.target_entity = targetEntity;

  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  if (from || to) {
    where.occurred_at = {};
    if (from) where.occurred_at[Op.gte] = from;
    if (to) where.occurred_at[Op.lte] = to;
  }

  let page = parseInt(`${query.page ?? 1}`, 10);
  let limit = parseInt(`${query.limit ?? 50}`, 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 50;
  limit = Math.min(limit, 200);
  const offset = (page - 1) * limit;

  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    include: [
      {
        model: User,
        as: 'admin_user',
        required: false,
        attributes: ['id', 'email', 'role'],
      },
    ],
    order: [['occurred_at', 'DESC']],
    limit,
    offset,
  });

  return {
    items: rows.map((row) => {
      const plain = row.get({ plain: true });
      return {
        id: plain.id,
        action: plain.action,
        target_entity: plain.target_entity,
        target_id: plain.target_id,
        admin_id: plain.admin_id,
        admin_email: plain.admin_user?.email || null,
        old_value: plain.old_value,
        new_value: plain.new_value,
        metadata: plain.metadata,
        ip_address: plain.ip_address,
        user_agent: plain.user_agent,
        correlation_id: plain.correlation_id,
        occurred_at: plain.occurred_at,
      };
    }),
    pagination: {
      page,
      limit,
      total: count,
      pages: Math.ceil(count / limit) || 1,
    },
  };
}

module.exports = { listAuditLogs };
