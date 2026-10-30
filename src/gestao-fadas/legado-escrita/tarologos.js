'use strict';

/**
 * Tarólogo no legado (`tbl_tarologos`, MyISAM): tradução PURA e UPDATE pelo executor com allowlist (`sql.entidades.js`).
 *   nome (catálogo) -> nmuTarologo (varchar 35: "nome pelo qual o tarólogo é apresentado", confirmado no dicionário; acima de 35 é RECUSADO,
 *   nunca cortado) | cadastro_ativo -> ativo (tinyint 1/0, "cadastro ativo", confirmado).
 * NUNCA toca `nmcTarologo` (é o LOGIN com que o espelho de consultas acha o tarólogo), `status`, `exibir`, `pass`, valores nem ramal.
 * Só onde o tarólogo JÁ existe no legado (`id_legado`): criar tarólogo no legado é pergunta aberta (Maturacao/45, classe A).
 */

const sql = require('./sql.entidades');
const { MapeamentoError } = require('./mapeamento');

const CAMPOS = Object.freeze(['nome', 'cadastro_ativo']);

/** `perfil` = `{ nome, cadastro_ativo }` do Postgres; `campos` = pendentes. `null` se não sobrou nada espelhável. */
function linhaDoTarologo(perfil, campos) {
  const colunas = {}; const usados = [];
  if (campos.includes('nome') && perfil.nome !== null && perfil.nome !== undefined) {
    const t = typeof perfil.nome === 'string' ? perfil.nome.trim() : '';
    if (!t) throw new MapeamentoError('nome: vazio.');
    if (Array.from(t).length > 35) throw new MapeamentoError('nome: acima de 35 caracteres (nmuTarologo; não é cortado).');
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001F\u007F-\u009F]/u.test(t) || Array.from(t).some((ch) => ch.codePointAt(0) > 0xFFFF)) throw new MapeamentoError('nome: caractere inválido para a coluna utf8mb3.');
    colunas.nmuTarologo = t; usados.push('nome');
  }
  if (campos.includes('cadastro_ativo') && typeof perfil.cadastro_ativo === 'boolean') { colunas.ativo = perfil.cadastro_ativo ? 1 : 0; usados.push('cadastro_ativo'); }
  return usados.length ? { colunas, campos: usados } : null;
}

async function ler(ex, idTarologo) {
  const [linhas] = await ex.execute(sql.SELECT_TAROLOGO_ID, [Number(idTarologo)]);
  return linhas[0] || null;
}

async function atualizar(ex, idTarologo, colunas) {
  const nomes = sql.CAMPOS_TAROLOGO.filter((c) => c in colunas);
  const texto = sql.updateTarologo(nomes);
  if (!texto) throw new MapeamentoError('Nenhuma coluna espelhável.');
  const id = Number(idTarologo);
  if (!Number.isInteger(id) || id < 1 || id > 2147483647) throw new MapeamentoError('Tarólogo fora do intervalo do legado.');
  const [r] = await ex.execute(texto, [...nomes.map((c) => colunas[c]), id]);
  return Number(r && r.affectedRows) || 0;
}

module.exports = { CAMPOS, linhaDoTarologo, ler, atualizar };
