'use strict';

/**
 * Contas que o front precisa conhecer para os Recados (destinatários, autor, avatar): as da equipe (com perfil na B) e as tarólogas com
 * `tarotId`. Vêm de `users` da A (+ `staff_profiles.display_name`); o front real não tem outra lista de contas. NADA é criado nem alterado.
 * A leitura é trocável (`definirListaDeContas`) para o teste offline, sem banco.
 */

const MAX = 300;

async function listarDaA() {
  const { User } = require('../../../models');
  const { Op } = require('sequelize');
  const { loadUserAccessContext } = require('../../../rbac/authorization.service');
  const { resolverPerfil, MAPEAMENTO_PERFIL } = require('../../_comum/politica-acesso');
  const { servicosPadrao } = require('../../gate/sessao-nativa');
  const s = servicosPadrao();
  const usuarios = await User.findAll({ where: { is_active: true, blocked_at: null, [Op.or]: [{ role: 'TAROLOGA' }, { '$staff_profile.user_id$': { [Op.ne]: null } }] }, include: [{ association: 'staff_profile', required: false, attributes: ['display_name'] }], limit: MAX, order: [['created_at', 'ASC']], subQuery: false });
  const contas = [];
  for (const u of usuarios) {
    const ctx = await loadUserAccessContext(u.id);
    const ids = (ctx && ctx.roleIds) || [];
    const perfil = resolverPerfil({ accessContext: { roleIds: ids }, user: { role: ids.length ? '' : u.role } }, MAPEAMENTO_PERFIL);
    if (!perfil) continue;
    const nome = (u.staff_profile && u.staff_profile.display_name) || u.email || String(u.id);
    const tarotId = perfil === 'tarologa' ? await s.buscarTarotId(u.id) : undefined;
    if (perfil === 'tarologa' && !tarotId) continue;
    contas.push({ id: String(u.id), name: `${nome}`.slice(0, 200), role: perfil, ...(tarotId ? { tarotId } : {}), active: true });
  }
  return contas;
}

let listar = listarDaA;
const definirListaDeContas = (fn) => { listar = fn || listarDaA; };
const contasDaEquipe = () => listar();

module.exports = { contasDaEquipe, definirListaDeContas };
