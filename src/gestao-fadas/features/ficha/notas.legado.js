'use strict';

/**
 * Observações do SISTEMA ANTIGO na ficha (onda 1, A1), SOMENTE LEITURA. Duas fontes, as duas só com SELECT:
 *   - `obs_liberacao_consulta` (30 mil notas de 21 mil clientes): `id_usuario` = cliente, `desc`, `id_atendente`, `dt_hr`. NÃO tem índice em `id_usuario`
 *     (só a chave primária; estrutura do legado não se altera): a leitura varre uma tabela estreita de 30 mil linhas, ~ms, por ficha aberta, e a ficha pagina por `id`;
 *   - `usuarios.obs_liberacao`: um texto livre por cliente (4,4 mil preenchidos), lido por chave primária.
 * Formato: o `ClientNote` que o front lê, mais `origin: 'legado'` e `readOnly: true` (a ficha não edita) e `dateUnknown: true` quando o ASP não gravou
 * a data (5.635 notas com `dt_hr` nulo: `createdAt` fica na época zero e a tela mostra "Sem data"; nunca se inventa data).
 * Autor: `usuarios.nome_id` de `id_atendente` quando é de equipe (nível 1, 2 ou 99); senão "Sistema antigo". Nada de nome civil, e-mail ou telefone.
 * As notas novas espelhadas no legado (`gf_clientes_notas.legado_id`) saem desta lista para não aparecerem duas vezes.
 */

const { Op } = require('sequelize');
const { lendo } = require('../../_comum/legado');
const { legacyNoteText } = require('../clientes/helpers/valores');

const ID_PREFIXO = 'legado:';
const NIVEIS_DE_EQUIPE = new Set([1, 2, 99]);
const ROTULO_ANTIGO = 'Sistema antigo';
const ROTULO_CADASTRO = 'Cadastro (sistema antigo)';
const EPOCA_ZERO = '1970-01-01T00:00:00.000Z';
const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;

const ehLegada = (id) => typeof id === 'string' && id.startsWith(ID_PREFIXO);

/** TIMESTAMP em sessão UTC (Date ou texto) -> ISO; zerado, nulo ou antes de 2000 -> null. */
function instante(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = valor instanceof Date ? valor.toISOString() : `${valor}`;
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || Number(m[1]) < 2000) return null;
  const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function forma(clientId, id, texto, autor, quando) {
  const t = legacyNoteText(`${texto ?? ''}`);
  if (!t || !t.trim()) return null;
  const iso = instante(quando);
  return { id: `${ID_PREFIXO}${id}`, clientId, text: t.trim(), author: autor, createdAt: iso || EPOCA_ZERO, ...(iso ? {} : { dateUnknown: true }), origin: 'legado', readOnly: true };
}

const porData = (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id, 'en', { numeric: true });

/**
 * As notas do legado de UMA cliente, da mais nova para a mais antiga em páginas de `limit`: `{ items (por data, a mais antiga primeiro), hasMore, nextBefore }`.
 * `before` = o maior id de `obs_liberacao_consulta` já visto (a página seguinte traz ids menores). `espelhadas` = ids do legado que já são notas novas.
 * `lerLegado` troca a leitura nos verificadores (não há MySQL lá).
 */
async function doLegado(clientId, { limit = LIMITE_PADRAO, before = null, espelhadas = new Set() } = {}, lerLegado = lerNoLegado) {
  const tam = Math.min(Math.max(Number(limit) || LIMITE_PADRAO, 1), LIMITE_MAXIMO);
  const { linhas, autores, cadastro } = await lerLegado(Number(clientId), { tam: tam + 1 + espelhadas.size, before });
  const visiveis = linhas.filter((l) => !espelhadas.has(`${l.id}`));
  const pagina = visiveis.slice(0, tam);
  const items = [];
  for (const l of pagina) {
    const a = autores.get(`${l.id_atendente}`);
    const n = forma(`${clientId}`, `obs:${l.id}`, l.desc, a && NIVEIS_DE_EQUIPE.has(Number(a.nivel)) && a.nome_id && `${a.nome_id}`.trim() ? `${a.nome_id}`.trim() : ROTULO_ANTIGO, l.dt_hr);
    if (n) items.push(n);
  }
  // O texto do cadastro (usuarios.obs_liberacao) é um só: vem com a primeira página (sem `before`).
  if (!before && cadastro) {
    const n = forma(`${clientId}`, `cadastro:${clientId}`, cadastro.texto, ROTULO_CADASTRO, null);
    if (n) items.push(n);
  }
  const hasMore = visiveis.length > tam;
  const ultima = pagina[pagina.length - 1];
  return { items: items.sort(porData), hasMore, nextBefore: hasMore && ultima ? `${ultima.id}` : null };
}

/** O SQL de verdade: SELECT por `id_usuario` (varre a tabela, ver o cabeçalho), o autor por chave primária e o texto do cadastro por chave primária. */
async function lerNoLegado(clienteId, { tam, before }) {
  return lendo(async (m) => {
    const where = { id_usuario: clienteId, ...(before ? { id: { [Op.lt]: Number(before) } } : {}) };
    const [linhas, usuario] = await Promise.all([
      m.LegadoObsLiberacaoConsulta.findAll({ attributes: ['id', 'desc', 'id_atendente', 'dt_hr'], where, order: [['id', 'DESC']], limit: tam, raw: true }),
      // Ambiente sem a coluna (o DEV é mais antigo que a produção): sem o texto do cadastro, nunca derruba as notas.
      before ? Promise.resolve(null) : m.LegadoUsuario.findOne({ attributes: ['id', 'obs_liberacao'], where: { id: clienteId, nivel: 0 }, raw: true }).catch(() => null),
    ]);
    const ids = [...new Set(linhas.map((l) => Number(l.id_atendente)).filter((n) => Number.isInteger(n) && n > 0))];
    const equipe = ids.length ? await m.LegadoUsuario.findAll({ attributes: ['id', 'nome_id', 'nivel'], where: { id: ids }, raw: true }) : [];
    const texto = usuario && typeof usuario.obs_liberacao === 'string' ? usuario.obs_liberacao : '';
    return { linhas, autores: new Map(equipe.map((u) => [`${u.id}`, u])), cadastro: texto.trim() ? { texto } : null };
  });
}

module.exports = { ID_PREFIXO, LIMITE_MAXIMO, LIMITE_PADRAO, ehLegada, instante, doLegado, lerNoLegado, ROTULO_ANTIGO };
