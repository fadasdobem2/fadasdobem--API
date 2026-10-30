'use strict';

/**
 * Cliente no legado (`usuarios`, InnoDB): tradução PURA do que a equipe edita na ficha para as colunas, e o UPDATE pelo executor com
 * allowlist (`sql.entidades.js`). Mapeamento (o MESMO de `legacyIdentityChanges`, front `features/integration/legacy-client-write.ts`):
 *   name -> nome_id (varchar 50, obrigatório) | treatAs -> nome2 (varchar 50, NOT NULL: vazio grava '') | whatsapp -> whats (varchar 45, NULL na coluna, mas o
 *   front grava o texto vazio como '' e o ouro manda seguir o front) | birthDate dd/mm/aaaa -> datanascimento `AAAA-MM-DD 00:00:00` (datetime; a hora fica em `horanascimento`,
 *   que nunca é tocada). Nada de 4 bytes (as colunas são utf8mb3): o texto é RECUSADO, nunca cortado nem limpo em silêncio.
 * Pré/Pós (`paymentProfile`) NÃO tem casa no legado e nunca passa por aqui. `INSERT` de cliente não existe (o id nasce no legado).
 */

const sql = require('./sql.entidades');
const { MapeamentoError } = require('./mapeamento');

const LIMITES = { name: 50, treatAs: 50, whatsapp: 45 };
const COLUNA = { name: 'nome_id', treatAs: 'nome2', whatsapp: 'whats', birthDate: 'datanascimento' };
/** Campos da ficha que têm casa no legado, na ordem das colunas. */
const CAMPOS = Object.freeze(['name', 'treatAs', 'whatsapp', 'birthDate']);

function texto(v, campo, obrigatorio) {
  if (typeof v !== 'string') throw new MapeamentoError(`${campo}: texto inválido.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\r\n\t\u2028\u2029]/u.test(v)) throw new MapeamentoError(`${campo}: caractere de controle.`);
  const t = v.trim();
  if (obrigatorio && !t) throw new MapeamentoError(`${campo}: vazio.`);
  if (Array.from(t).length > LIMITES[campo]) throw new MapeamentoError(`${campo}: acima de ${LIMITES[campo]} caracteres (não é cortado).`);
  if (Array.from(t).some((ch) => ch.codePointAt(0) > 0xFFFF || (ch.codePointAt(0) >= 0xD800 && ch.codePointAt(0) <= 0xDFFF))) throw new MapeamentoError(`${campo}: caractere de 4 bytes (a coluna é utf8mb3).`);
  return t;
}

/** `dd/mm/aaaa` -> `AAAA-MM-DD 00:00:00`. Recusa data inexistente e ano antes de 1000 (mesma regra de `legacyLocalDateTime`). */
function nascimento(v) {
  const g = typeof v === 'string' ? v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
  const d = g ? new Date(Date.UTC(+g[3], +g[2] - 1, +g[1])) : null;
  if (!g || d.getUTCFullYear() !== +g[3] || d.getUTCMonth() !== +g[2] - 1 || d.getUTCDate() !== +g[1] || +g[3] < 1000) throw new MapeamentoError('birthDate: data inválida.');
  return `${g[3]}-${g[2]}-${g[1]} 00:00:00`;
}

/**
 * `dados` = o que a extensão guarda (`gf_clientes_ext.dados`); `campos` = os que estão pendentes. Devolve `{ colunas, campos }` só com os pendentes
 * que a extensão realmente tem (campo pendente sem valor é ignorado: nunca se apaga uma coluna por omissão). `null` se não sobrou nada.
 */
function linhaDoCliente(dados, campos) {
  const colunas = {}; const usados = [];
  for (const c of CAMPOS.filter((x) => campos.includes(x))) {
    const v = dados ? dados[c] : undefined;
    if (v === undefined || v === null) continue;
    if (c === 'name') colunas.nome_id = texto(v, c, true);
    else if (c === 'treatAs') colunas.nome2 = texto(v, c, false);
    else if (c === 'whatsapp') colunas.whats = texto(v, c, false);
    else colunas.datanascimento = nascimento(v);
    usados.push(c);
  }
  return usados.length ? { colunas, campos: usados } : null;
}

async function ler(ex, id) {
  const [linhas] = await ex.execute(sql.SELECT_CLIENTE, [Number(id)]);
  return linhas[0] || null;
}

/** UPDATE só das colunas dadas; devolve as linhas atingidas (0 = a cliente não existe com `nivel = 0`). */
async function atualizar(ex, id, colunas) {
  const nomes = sql.CAMPOS_CLIENTE.filter((c) => c in colunas);
  const texto_ = sql.updateCliente(nomes);
  if (!texto_) throw new MapeamentoError('Nenhuma coluna espelhável.');
  const idNum = Number(id);
  if (!Number.isInteger(idNum) || idNum < 1 || idNum > 2147483647) throw new MapeamentoError('Cliente fora do intervalo do legado.');
  if (colunas.nome_id !== undefined) {
    // Doc 47: o ASP exige `nome_id` único (sem diferenciar maiúscula; a coluna do legado tem collation case-insensitive) e `nome_id` igual ao id significa "sem identificação".
    if (String(colunas.nome_id) === String(idNum)) throw new MapeamentoError('name: o nome de identificação não pode ser igual ao ID.');
    const [dup] = await ex.execute(sql.SELECT_NOME_ID_DUP, [colunas.nome_id, idNum]);
    if (dup.length) throw new MapeamentoError('name: já existe outra cliente com este nome de identificação no sistema antigo.');
  }
  const [r] = await ex.execute(texto_, [...nomes.map((c) => colunas[c]), idNum]);
  return Number(r && r.affectedRows) || 0;
}

module.exports = { CAMPOS, COLUNA, linhaDoCliente, nascimento, ler, atualizar };
