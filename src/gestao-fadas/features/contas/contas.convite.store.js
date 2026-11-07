'use strict';

/**
 * Convite e permissão adicional em `gf_contas_ext` (v706). Só o executor do banco novo (`ex`) e as colunas `convite_*`; o token e o link
 * NUNCA são guardados (só a impressão SHA-256). A linha de `gf_contas_ext` já existe (criada por `gravarExt`) quando estas funções rodam.
 */

const { QueryTypes } = require('sequelize');

/** Grava o convite emitido (substitui o anterior) e liga/desliga o acesso pendente. */
async function gravarConvite(ex, userId, convite, pendente) {
  await ex.execute(`UPDATE gf_contas_ext SET convite_hash = ?, convite_tipo = ?, convite_email = ?, convite_papel = ?, convite_emitido = ?, convite_expira = ?,
    convite_usado = NULL, convite_revogado = NULL, acesso_pendente = ? WHERE user_id = ?`,
  [convite.tokenHash, convite.kind, convite.email, convite.role, convite.issuedAt, convite.expiresAt, Boolean(pendente), userId]);
}

/** Marca o convite como revogado (só se existir, sem uso e sem revogação). */
async function revogarConvite(ex, userId, quando) {
  await ex.execute('UPDATE gf_contas_ext SET convite_revogado = ? WHERE user_id = ? AND convite_hash IS NOT NULL AND convite_usado IS NULL AND convite_revogado IS NULL', [quando, userId]);
}

async function marcarUsado(ex, userId, quando) {
  await ex.execute('UPDATE gf_contas_ext SET convite_usado = ?, acesso_pendente = FALSE WHERE user_id = ? AND convite_usado IS NULL', [quando, userId]);
}

async function gravarPermissao(ex, userId, ligada, trilha) {
  await ex.execute('UPDATE gf_contas_ext SET ver_minutagem = ?, permissoes_trilha = CAST(? AS jsonb) WHERE user_id = ?', [ligada, JSON.stringify(trilha), userId]);
}

/** Id do usuário dono da impressão do token, ou null. Leitura simples; a decisão (válido, expirado...) é do domínio. */
async function donoDaImpressao(hash, t) {
  const { sequelize } = require('../../../config/database');
  const [r] = await sequelize.query('SELECT user_id FROM gf_contas_ext WHERE convite_hash = :hash', { type: QueryTypes.SELECT, transaction: t, replacements: { hash } });
  return r ? r.user_id : null;
}

module.exports = { gravarConvite, revogarConvite, marcarUsado, gravarPermissao, donoDaImpressao };
