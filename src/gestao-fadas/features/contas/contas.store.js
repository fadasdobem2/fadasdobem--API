'use strict';

/**
 * Leitura e escrita das contas. Leitura: SQL de SELECT sobre as tabelas da A (somente leitura) e o `gf_contas_ext`.
 * Escrita: models da A (`User`, `StaffProfile`, `Specialist`, `RefreshToken`) dentro da transação de `contas.banco.js`; o `gf_contas_ext`
 * (legacyId, foto, revisão) pelo executor do banco novo. Senha: só o hash (bcrypt da A); NADA aqui devolve ou registra hash/senha.
 */

const { QueryTypes } = require('sequelize');
const { resolverPerfil } = require('../../_comum/politica-acesso');
const { paraConta } = require('../../_comum/dominio/contas');

const SELECT = `SELECT u.id, u.email, u.role AS produto, u.is_active, u.blocked_at, u.last_login_at,
  COALESCE(sp.display_name, spec.display_name, u.email) AS nome, spec.slug, spec.commission_percent_default AS comissao,
  p.tarot_id, p.cadastro_ativo, e.legacy_id, e.avatar, COALESCE(e.revisao, 0) AS revisao,
  COALESCE(e.acesso_pendente, false) AS acesso_pendente, e.convite_hash, e.convite_tipo, e.convite_email, e.convite_papel, e.convite_emitido, e.convite_expira,
  e.convite_usado, e.convite_revogado, COALESCE(e.ver_minutagem, false) AS ver_minutagem, COALESCE(e.permissoes_trilha, '[]'::jsonb) AS permissoes_trilha,
  COALESCE((SELECT array_agg(r.role_id) FROM access_user_roles r WHERE r.user_id = u.id), ARRAY[]::varchar[]) AS papeis
FROM users u
LEFT JOIN staff_profiles sp ON sp.user_id = u.id AND sp.deleted_at IS NULL
LEFT JOIN specialists spec ON spec.user_id = u.id AND spec.deleted_at IS NULL
LEFT JOIN gf_tarologos_perfil p ON p.conta_slug IS NOT NULL AND p.conta_slug = spec.slug
LEFT JOIN gf_contas_ext e ON e.user_id = u.id
WHERE u.deleted_at IS NULL AND u.role IN ('GESTORA', 'ATENDENTE', 'TAROLOGA')`;

const perfilDaLinha = (l) => {
  const papeis = Array.isArray(l.papeis) ? l.papeis : [];
  return resolverPerfil({ accessContext: { roleIds: papeis }, user: { role: papeis.length ? '' : l.produto } });
};

/** Linhas com perfil da B (quem não tem perfil, como marketing e social, não aparece na Equipe). */
async function lerLinhas(t) {
  const { sequelize } = require('../../../config/database');
  const linhas = await sequelize.query(`${SELECT} ORDER BY nome, u.id`, { type: QueryTypes.SELECT, transaction: t });
  return linhas.map((l) => ({ ...l, perfil: perfilDaLinha(l), ativo: Boolean(l.is_active) && !l.blocked_at, ultimo_login: l.last_login_at, revisao: Number(l.revisao) })).filter((l) => l.perfil);
}

async function lerUma(id, t) {
  const { sequelize } = require('../../../config/database');
  const [l] = await sequelize.query(`${SELECT} AND u.id = :id`, { type: QueryTypes.SELECT, transaction: t, replacements: { id } });
  if (!l) return null;
  const perfil = perfilDaLinha(l);
  return perfil ? { ...l, perfil, ativo: Boolean(l.is_active) && !l.blocked_at, ultimo_login: l.last_login_at, revisao: Number(l.revisao) } : null;
}

const dto = (l, agora) => paraConta(l, agora);

/** Já existe um usuário (de qualquer papel, inclusive cliente) com este e-mail, sem diferenciar maiúsculas? */
async function emailEmUso(email, t, ignorarId = null) {
  const { sequelize } = require('../../../config/database');
  const [r] = await sequelize.query('SELECT id FROM users WHERE lower(email) = :email AND deleted_at IS NULL AND (CAST(:ignorar AS uuid) IS NULL OR id <> CAST(:ignorar AS uuid)) LIMIT 1',
    { type: QueryTypes.SELECT, transaction: t, replacements: { email: email.toLocaleLowerCase('pt-BR'), ignorar: ignorarId } });
  return Boolean(r);
}

/** Trava a linha do usuário (e impede duas gravações simultâneas na mesma conta). */
async function travar(id, t) {
  const { User } = require('../../../models');
  return User.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
}

async function definirPapeis(usuario, ids, t) {
  const { AccessRole } = require('../../../models');
  const papeis = ids.length ? await AccessRole.findAll({ where: { id: ids }, transaction: t }) : [];
  if (papeis.length !== ids.length) throw Object.assign(new Error('papel RBAC ausente: rode npm run seed:access'), { codigo: 'PAPEL_AUSENTE' });
  await usuario.setAccess_roles(papeis, { transaction: t });
}

async function nomeStaff(userId, nome, t) {
  const { StaffProfile } = require('../../../models');
  const p = await StaffProfile.findOne({ where: { user_id: userId }, transaction: t });
  if (p) await p.update({ display_name: nome }, { transaction: t });
  else await StaffProfile.create({ user_id: userId, display_name: nome, staff_status: 'ativo' }, { transaction: t });
}

async function nomeTarologa(userId, nome, t) {
  const { Specialist } = require('../../../models');
  const s = await Specialist.findOne({ where: { user_id: userId }, transaction: t });
  if (s) await s.update({ display_name: nome }, { transaction: t });
}

async function revogarSessoes(userId, t) {
  const { RefreshToken } = require('../../../models');
  await RefreshToken.update({ revoked_at: new Date() }, { where: { user_id: userId, revoked_at: null }, transaction: t });
}

/** `gf_contas_ext`: cria (revisão 1) ou sobe a revisão e grava os campos informados. */
async function gravarExt(ex, userId, { legacyId, avatar }, ator) {
  const [atual] = (await ex.execute('SELECT legacy_id, avatar, revisao FROM gf_contas_ext WHERE user_id = ? FOR UPDATE', [userId]))[0];
  if (!atual) {
    await ex.execute('INSERT INTO gf_contas_ext (user_id, legacy_id, avatar, revisao, atualizado_por) VALUES (?, ?, ?, 1, ?)', [userId, legacyId || null, avatar || null, ator]);
    return 1;
  }
  const proxLegacy = legacyId === undefined ? atual.legacy_id : (legacyId || null);
  const proxAvatar = avatar === undefined ? atual.avatar : (avatar || null);
  await ex.execute('UPDATE gf_contas_ext SET legacy_id = ?, avatar = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ? WHERE user_id = ?', [proxLegacy, proxAvatar, ator, userId]);
  return Number(atual.revisao) + 1;
}

/** Revisão atual (0 sem linha), com trava. */
async function revisaoAtual(ex, userId) {
  const [linhas] = await ex.execute('SELECT revisao FROM gf_contas_ext WHERE user_id = ? FOR UPDATE', [userId]);
  return linhas[0] ? Number(linhas[0].revisao) : 0;
}

module.exports = { lerLinhas, lerUma, dto, emailEmUso, travar, definirPapeis, nomeStaff, nomeTarologa, revogarSessoes, gravarExt, revisaoAtual, perfilDaLinha };
