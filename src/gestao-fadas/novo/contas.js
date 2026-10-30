'use strict';

/**
 * A conta que assina no banco novo é o USUÁRIO da A (`users`). Aqui: ela existe? e qual o nome de exibição
 * (`staff_profiles.display_name`)? Carregamento sob demanda dos models da A. Nome ausente vira `null` ("Conta não identificada").
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ehUuid = (v) => typeof v === 'string' && UUID.test(v);

async function contaExisteNaA(id) {
  if (!ehUuid(id)) return false;
  const { User } = require('../../models');
  return (await User.count({ where: { id } })) > 0;
}

/** Map id -> nome para os ids citados que são usuários (ids que não são UUID simplesmente ficam sem nome). */
async function nomesDeContasDaA(ids) {
  const validos = [...new Set(ids)].filter(ehUuid);
  if (!validos.length) return new Map();
  const { StaffProfile } = require('../../models');
  const linhas = await StaffProfile.findAll({ attributes: ['user_id', 'display_name'], where: { user_id: validos }, raw: true });
  return new Map(linhas.filter((l) => l.display_name).map((l) => [l.user_id, l.display_name]));
}

module.exports = { ehUuid, contaExisteNaA, nomesDeContasDaA };
