'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize, User } = require('../../models');

function phoneDigitsOnly(raw) {
  return `${raw ?? ''}`.replace(/\D/g, '');
}

/**
 * Valida celular BR (10–13 dígitos, nono dígito 9 quando aplicável).
 * @returns {string|null} só dígitos ou null se inválido
 */
function tryNormalizeMobilePhone(raw) {
  const digits = phoneDigitsOnly(raw);
  if (!digits) return null;
  if (digits.length < 10 || digits.length > 13) return null;
  const local = digits.length >= 11 ? digits.slice(-9) : digits.slice(-8);
  if (local.length === 9 && local[0] !== '9') return null;
  return digits;
}

/**
 * Localiza usuário ativo pelo telefone (últimos 9 dígitos BR).
 * @param {string} phoneRaw
 */
async function findActiveUserByPhoneDigits(phoneRaw) {
  const digits = phoneDigitsOnly(phoneRaw);
  if (digits.length < 9) return null;
  const suffix = digits.slice(-9);

  const rows = await sequelize.query(
    `SELECT u.id AS id
       FROM users u
      WHERE u.deleted_at IS NULL
        AND u.is_active = true
        AND u.blocked_at IS NULL
        AND u.phone IS NOT NULL
        AND RIGHT(REGEXP_REPLACE(COALESCE(u.phone, ''), '[^0-9]', '', 'g'), 9) = :suffix
      LIMIT 1`,
    { replacements: { suffix }, type: QueryTypes.SELECT }
  );

  if (!Array.isArray(rows) || !rows.length) return null;
  return User.findByPk(rows[0].id, { paranoid: true });
}

module.exports = {
  phoneDigitsOnly,
  tryNormalizeMobilePhone,
  findActiveUserByPhoneDigits,
};
