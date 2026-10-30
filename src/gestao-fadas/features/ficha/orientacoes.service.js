'use strict';

/**
 * Orientação financeira da supervisora (Maturacao/36). Uma linha por cliente (`gf_clientes_orientacoes`), o registro do front em `item`.
 *   - `GET /client-guidance`: `{ readAt, items:[{ clientId, guidance }], versions:{ clientId: revisão } }` para a equipe;
 *   - `PUT /client-guidance`: `{ operationKey, expectedVersion (0 = nova), clientId, record }`. O servidor lê do registro só o evento novo e recalcula
 *     (domínio `orientacao-financeira.js`) com o ator da sessão e o relógio dele; idempotência por `operationKey`, 409 `VERSION_CHANGED`,
 *     auditoria e `gf_operacoes` na MESMA transação.
 */

const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const dom = require('../../_comum/dominio/orientacao-financeira');
const { f, exigirCliente, traduzir, atorDe } = require('./ficha.comum');

const CONFERIR_ANTES = 'A orientação desta cliente mudou. Confira o registro antes de salvar.';
const comoItem = (l) => ({ clientId: l.id_cliente, guidance: f.textoDe(l) });

async function ler(req) {
  atorDe(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const linhas = await lendoNovo((m) => m.GfClientesOrientacoes.findAll({ order: [['id_cliente', 'ASC']] }));
  return { readAt: new Date().toISOString(), items: linhas.map(comoItem), versions: Object.fromEntries(linhas.map((l) => [l.id_cliente, Number(l.revisao)])) };
}

async function gravar(req) {
  const a = atorDe(req, true);
  const b = req.body;
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  const operationKey = f.chaveOperacao(b.operationKey);
  const expectedVersion = f.revisao(b.expectedVersion);
  const clientId = f.idCliente(b.clientId);
  if (!f.ehObjeto(b.record)) throw f.invalido('record');
  await exigirCliente(clientId);
  return f.gravar(req, {
    escopo: 'ficha.orientacao.gravar', operationKey, corpo: { clientId, expectedVersion, record: b.record }, entidade: 'cliente-orientacao', entidadeId: clientId, acao: 'ficha.orientacao.gravar',
    producao: async (ex) => {
      try {
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_clientes_orientacoes:${clientId}`]);
        const [linhas] = await ex.execute('SELECT id_cliente, item, revisao FROM gf_clientes_orientacoes WHERE id_cliente = ? FOR UPDATE', [clientId]);
        const atual = linhas[0] ? f.textoDe(linhas[0]) : null;
        if ((atual ? Number(linhas[0].revisao) : 0) !== expectedVersion) throw f.conflitoVersao(CONFERIR_ANTES);
        const agora = new Date().toISOString();
        const novo = dom.aplicar(atual, b.record, { nome: a.nome, papel: a.perfil }, agora);
        const item = JSON.stringify(novo);
        if (!atual) {
          await ex.execute('INSERT INTO gf_clientes_orientacoes (id_cliente, revisao, ativa, pendente, item, atualizado_por, operation_key) VALUES (?, ?, ?, ?, ?, ?, ?)', [clientId, novo.revision, novo.active, novo.pendingReview, item, a.nome, operationKey]);
        } else if (novo !== atual) {
          await ex.execute('UPDATE gf_clientes_orientacoes SET revisao = ?, ativa = ?, pendente = ?, item = ?, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ?, operation_key = ? WHERE id_cliente = ?', [novo.revision, novo.active, novo.pendingReview, item, a.nome, operationKey, clientId]);
        }
        const evento = novo.history[novo.history.length - 1];
        return {
          antes: atual ? { revision: atual.revision, active: atual.active, pending: atual.pendingReview } : null,
          depois: { revision: novo.revision, active: novo.active, pending: novo.pendingReview, requiresApproval: novo.requiresApproval, action: evento.action, role: evento.role },
          resposta: { readAt: agora, items: [{ clientId, guidance: novo }], versions: { [clientId]: novo.revision } },
        };
      } catch (e) { throw traduzir(e); }
    },
  });
}

module.exports = { ler, gravar };
