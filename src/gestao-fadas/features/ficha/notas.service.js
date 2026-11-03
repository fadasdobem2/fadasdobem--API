'use strict';

/**
 * Observações da cliente (Maturacao/36). Uma linha por observação (`gf_clientes_notas`), o `ClientNote` do front em `item`.
 *   - `GET /client-notes[?clientId=&limit=&before=]`: `{ readAt, items:[ClientNote], versions:{ id: versão }, legacy? }` para a equipe (a taróloga não entra). Com `clientId`
 *     vêm também as notas do sistema antigo, SOMENTE LEITURA (`notas.legado.js`); o PUT recusa (422) qualquer id `legado:*`;
 *   - `PUT /client-notes`: `{ operationKey, expectedVersion (0 = nova), record }`. Nova: texto, formatação, autor e papel da sessão, instante do
 *     servidor. Alterada: o texto anterior vai para o histórico (domínio `nota-cliente.js`). Idempotência, 409 `VERSION_CHANGED` e auditoria na mesma transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/nota-cliente');
const espelho = require('./notas.espelho');
const { f, exigirCliente, traduzir, atorDe } = require('./ficha.comum');
const legado = require('./notas.legado');

const CONFERIR_ANTES = 'Esta observação mudou. Atualize a ficha e tente novamente.';
const LIMITE_LEITURA = 2000;
const SOMENTE_LEITURA = 'Esta observação vem do sistema antigo e não pode ser editada por aqui.';

const inteiro = (v, nome, min, max) => {
  const t = `${v}`;
  if (!/^\d{1,10}$/.test(t) || Number(t) < min || Number(t) > max) throw f.invalido(nome);
  return Number(t);
};

/**
 * `GET /client-notes`.
 *   - `?clientId=` (a ficha): as notas NOVAS da cliente (todas) mais as do SISTEMA ANTIGO em somente leitura (`origin: 'legado'`), por data, em páginas
 *     de `limit` (1 a 200, padrão 50) do legado; `before` = `legacy.nextBefore` da página anterior. `legacy: { available, hasMore, nextBefore }`;
 *     `available: false` quando o legado está fora (a ficha avisa em vez de afirmar "nenhuma observação").
 *   - sem `clientId` (a casca): só as notas novas, as `LIMITE_LEITURA` MAIS RECENTES (antes, as mais antigas), `truncated` diz se havia mais. Nunca lê o legado.
 */
async function ler(req) {
  atorDe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const q = req.query || {};
  const so = q.clientId !== undefined ? f.idCliente(`${q.clientId}`) : null;
  const agora = new Date().toISOString();
  if (!so) {
    const recentes = await lendoNovo((m) => m.GfClientesNotas.findAll({ order: [['criado_em', 'DESC'], ['id', 'DESC']], limit: LIMITE_LEITURA + 1 }));
    const linhas = recentes.slice(0, LIMITE_LEITURA).reverse();
    return { readAt: agora, items: linhas.map((l) => f.textoDe(l)), versions: Object.fromEntries(linhas.map((l) => [l.id, Number(l.version)])), truncated: recentes.length > LIMITE_LEITURA };
  }
  const limit = q.limit === undefined ? legado.LIMITE_PADRAO : inteiro(q.limit, 'limit', 1, legado.LIMITE_MAXIMO);
  const before = q.before === undefined ? null : inteiro(q.before, 'before', 1, 2147483647);
  const linhas = await lendoNovo((m) => m.GfClientesNotas.findAll({ where: { id_cliente: so }, order: [['criado_em', 'ASC'], ['id', 'ASC']], limit: LIMITE_LEITURA }));
  const espelhadas = new Set(linhas.filter((l) => l.legado_id !== null && l.legado_id !== undefined).map((l) => `${l.legado_id}`));
  let antigo = { items: [], hasMore: false, nextBefore: null };
  let disponivel = true;
  try { antigo = await legado.doLegado(so, { limit, before, espelhadas }); } catch (e) { disponivel = false; console.warn('[gf] observações do sistema antigo indisponíveis:', (e && ((e.dados && e.dados.codigo) || e.name)) || 'erro'); }
  const novas = linhas.map((l) => f.textoDe(l));
  const items = before ? antigo.items : [...novas, ...antigo.items].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return {
    readAt: agora, items, versions: Object.fromEntries(linhas.map((l) => [l.id, Number(l.version)])),
    legacy: { available: disponivel, hasMore: antigo.hasMore, nextBefore: antigo.nextBefore },
  };
}

async function gravar(req) {
  const a = atorDe(req, true);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  if (b.record && legado.ehLegada(b.record.id)) throw f.regra(SOMENTE_LEITURA);
  let pedido;
  try { pedido = dom.forma(b.record); } catch (e) { throw traduzir(e); }
  await exigirCliente(pedido.clientId);
  const quem = { nome: a.nome, papel: a.perfil };
  return f.gravar(req, {
    escopo: 'ficha.nota.gravar', operationKey, corpo: { expectedVersion, record: pedido }, entidade: 'cliente-nota', entidadeId: pedido.id, acao: 'ficha.nota.gravar',
    producao: async (ex) => {
      try {
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_clientes_notas:${pedido.id}`]);
        const [linhas] = await ex.execute('SELECT id, id_cliente, item, version FROM gf_clientes_notas WHERE id = ? FOR UPDATE', [pedido.id]);
        const atual = linhas[0] ? f.textoDe(linhas[0]) : null;
        const versaoAtual = atual ? Number(linhas[0].version) : 0;
        if (versaoAtual !== expectedVersion) throw f.conflitoVersao(CONFERIR_ANTES);
        const agora = new Date().toISOString();
        const nova = atual ? dom.editar(atual, pedido, quem, agora) : dom.criar(pedido, quem, agora);
        let versao = versaoAtual;
        if (!atual) {
          versao = 1;
          const legado = await espelho.nova(ex, req, nova, operationKey); // legado primeiro (GF_LEGADO_NOTAS): só nota NOVA
          await ex.execute('INSERT INTO gf_clientes_notas (id, id_cliente, item, version, criado_por, operation_key) VALUES (?, ?, ?, 1, ?, ?)', [nova.id, nova.clientId, JSON.stringify(nova), a.nome, operationKey]);
          await espelho.marcar(ex, nova.id, legado);
        } else if (nova !== atual) {
          versao = versaoAtual + 1;
          await ex.execute('UPDATE gf_clientes_notas SET item = ?, version = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(nova), versao, nova.id]);
        }
        return {
          antes: atual ? { version: versaoAtual, chars: atual.text.length } : null,
          depois: { version: versao, chars: nova.text.length, cliente: nova.clientId, alterada: nova !== atual && Boolean(atual) },
          resposta: { readAt: agora, items: [nova], versions: { [nova.id]: versao } },
        };
      } catch (e) { throw traduzir(e); }
    },
  });
}

module.exports = { ler, gravar };
