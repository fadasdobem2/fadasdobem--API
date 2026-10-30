'use strict';

/**
 * Acesso ao banco novo do catálogo de tarólogos. Escrita: SQL no executor (`novo/escritor.js`, INSERT/UPDATE/SELECT em gf_*).
 * Leitura da tela: models (`novo/leitura.js`), que funciona com a escrita desligada. O `perfil` jsonb volta do executor como TEXTO.
 */

const COLUNAS = 'tarot_id, id_legado, conta_slug, nome, avatar, cadastro_ativo, perfil, registro_id, registro_revisao, revisao';

const lerPerfil = (v) => (typeof v === 'string' ? JSON.parse(v) : v || {});
function linha(l) { return l ? { ...l, perfil: lerPerfil(l.perfil), revisao: Number(l.revisao) } : null; }

/** Leitura da tela: perfis e extensões antigas. */
async function lerTudo(modelos) {
  const perfis = await modelos.GfTarologosPerfil.findAll({ order: [['tarot_id', 'ASC']] });
  const exts = await modelos.GfTarologosExt.findAll({});
  return { perfis, exts };
}

/** Uma linha de perfil DENTRO da transação, travada, pelo id do catálogo (trava consultiva também cobre a ausência). */
async function perfilTravado(ex, tarotId) {
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_tarologos_perfil:${tarotId}`]);
  const [linhas] = await ex.execute(`SELECT ${COLUNAS} FROM gf_tarologos_perfil WHERE tarot_id = ? FOR UPDATE`, [tarotId]);
  return linha(linhas[0]);
}

async function inserir(ex, tarotId, idLegado, campos, ator, operationKey) {
  await ex.execute(
    'INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, nome, avatar, cadastro_ativo, perfil, revisao, atualizado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)',
    [tarotId, idLegado, campos.nome, campos.avatar, campos.cadastro_ativo, JSON.stringify(campos.perfil), ator, operationKey],
  );
}

async function atualizar(ex, tarotId, campos, ator, operationKey) {
  await ex.execute(
    'UPDATE gf_tarologos_perfil SET nome = ?, avatar = ?, cadastro_ativo = ?, perfil = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ?, operation_key = ? WHERE tarot_id = ?',
    [campos.nome, campos.avatar, campos.cadastro_ativo, JSON.stringify(campos.perfil), ator, operationKey, tarotId],
  );
}

async function ligarConta(ex, tarotId, slug, ator, operationKey) {
  await ex.execute('UPDATE gf_tarologos_perfil SET conta_slug = ?, revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ?, operation_key = ? WHERE tarot_id = ?', [slug, ator, operationKey, tarotId]);
}

async function inserirComConta(ex, tarotId, idLegado, slug, ator, operationKey) {
  await ex.execute('INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, conta_slug, perfil, revisao, atualizado_por, operation_key) VALUES (?, ?, ?, ?, 1, ?, ?)', [tarotId, idLegado, slug, '{}', ator, operationKey]);
}

/** Quem já usa este `conta_slug` (outro tarólogo)? */
async function donoDoSlug(ex, slug) {
  const [linhas] = await ex.execute('SELECT tarot_id FROM gf_tarologos_perfil WHERE conta_slug = ?', [slug]);
  return linhas[0] ? linhas[0].tarot_id : null;
}

module.exports = { lerTudo, perfilTravado, inserir, atualizar, ligarConta, inserirComConta, donoDoSlug, linha, lerPerfil };
