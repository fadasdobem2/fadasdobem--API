'use strict';

/**
 * Observações da cliente (Maturacao/36). Uma linha por observação (`gf_clientes_notas`), o `ClientNote` do front em `item`.
 *   - `GET /client-notes[?clientId=]`: `{ readAt, items:[ClientNote], versions:{ id: versão } }` para a equipe (a taróloga não entra);
 *   - `PUT /client-notes`: `{ operationKey, expectedVersion (0 = nova), record }`. Nova: texto, formatação, autor e papel da sessão, instante do
 *     servidor. Alterada: o texto anterior vai para o histórico (domínio `nota-cliente.js`). Idempotência, 409 `VERSION_CHANGED` e auditoria na mesma transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/nota-cliente');
const espelho = require('./notas.espelho');
const { f, exigirCliente, traduzir, atorDe } = require('./ficha.comum');

const CONFERIR_ANTES = 'Esta observação mudou. Atualize a ficha e tente novamente.';
const LIMITE_LEITURA = 2000;

async function ler(req) {
  atorDe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const so = req.query && req.query.clientId !== undefined ? f.idCliente(`${req.query.clientId}`) : null;
  const linhas = await lendoNovo((m) => m.GfClientesNotas.findAll({ ...(so ? { where: { id_cliente: so } } : {}), order: [['criado_em', 'ASC'], ['id', 'ASC']], limit: LIMITE_LEITURA }));
  return { readAt: new Date().toISOString(), items: linhas.map((l) => f.textoDe(l)), versions: Object.fromEntries(linhas.map((l) => [l.id, Number(l.version)])) };
}

async function gravar(req) {
  const a = atorDe(req, true);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
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
