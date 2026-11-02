'use strict';

/**
 * Migração por planilha (Maturacao/55). Guarda, por cliente, os históricos de migração que o front monta ao aplicar a planilha
 * (`ClientMigrationHistory`), SÓ ACRESCENTANDO (`gf_migracao_historicos`, uma linha por revisão; a última é a vigente).
 *   - leitura: `GET /migration/histories` (por cliente com `clientId`, ou lista; janela `limit`/`after`) e `GET /migration/histories/:id` (uma revisão);
 *     quem vê pagamento (`canViewRecentPayments`) lê, porque a ficha mostra o saldo de migração;
 *   - gravação: `POST /migration/apply`, `{ operationKey, expectedLatest?, histories }`. SÓ a administradora (a tela de migração do front exige o mesmo).
 *     O servidor refaz a validação do front (`validClientMigrationHistory`), é idempotente por `sourceKey` (mesmo conteúdo = nada a gravar;
 *     conteúdo diferente = 422 "já foi aplicada com outros dados"; revisão já superada = 422), confere a revisão (`expectedLatest`, 409 `VERSION_CHANGED`),
 *     a idempotência (`operationKey`, 409 `OPERATION_KEY_CONFLICT`) e grava revisões + auditoria + `gf_operacoes` na MESMA transação (tudo ou nada);
 *   - o saldo de abertura NÃO é calculado aqui: o contexto financeiro (`fin.contexto.js`) lê a revisão vigente.
 */

const { randomUUID, createHash } = require('crypto');
const janela = require('../../_comum/janela');
const { lendoNovo } = require('../../novo/leitura');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { lendo } = require('../../_comum/legado');
const f = require('../financeiro-cliente/fin.comum');
const dom = require('../../_comum/dominio/migracao-planilha');

const MAX_LOTE = 2000;
const ID_CLIENTE = /^[1-9]\d{0,9}$/;

/** Existência das clientes no legado (nível 0), em UMA consulta. Trocável nos testes (o MySQL legado nem é configurado lá). */
let verificarClientes = async (ids) => {
  const linhas = await lendo((m) => m.LegadoUsuario.findAll({ attributes: ['id'], where: { nivel: 0, id: ids.map(Number) }, raw: true }));
  return new Set(linhas.map((l) => String(l.id)));
};
const definirVerificadorDeClientes = (fn) => { verificarClientes = fn || verificarClientes; };

const comoItem = (l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item);
const entrada = (l) => ({ id: l.id, clientId: l.id_cliente, seq: Number(l.seq), sourceKey: l.source_key, batchId: l.batch_id, createdAt: new Date(l.criado_em).toISOString() });
const traduzir = (e) => {
  if (!(e instanceof dom.MigracaoInvalidaError)) return e;
  return f.regra(e.message);
};

/** Quem lê (a equipe que vê pagamentos) e quem aplica (só a administradora). */
const leitora = (req) => f.ator(req, { permissao: 'canViewRecentPayments' });
function aplicadora(req, escrita) {
  const a = f.ator(req, { permissao: 'canManageFinancialValues', escrita });
  if (a.perfil !== 'administradora') throw f.negado(escrita);
  return a;
}

/** `GET /migration/histories?clientId=|ids=&limit=&after=`: os históricos em ordem (cliente, revisão). */
async function ler(req) {
  leitora(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const q = req.query || {};
  let ids;
  if (q.clientId !== undefined) ids = [f.idCliente(`${q.clientId}`, 'clientId')];
  else if (q.ids !== undefined) {
    ids = [...new Set(`${q.ids}`.split(',').map((s) => s.trim()).filter(Boolean))];
    if (!ids.length || ids.length > 200) throw f.invalido('ids');
    ids.forEach((id) => f.idCliente(id, 'ids'));
  }
  const linhas = await lendoNovo((m) => m.GfMigracaoHistoricos.findAll({ where: ids ? { id_cliente: ids } : {}, order: [['id_cliente', 'ASC'], ['seq', 'ASC']] }));
  const { itens, nextCursor } = janela.fatiar(linhas, janela.ler(q), (l) => l.id);
  return { readAt: new Date().toISOString(), items: itens.map(comoItem), entries: itens.map(entrada), ...(nextCursor !== undefined ? { nextCursor } : {}) };
}

/** `GET /migration/histories/:id`: uma revisão pelo id. */
async function obter(req) {
  leitora(req);
  if (!novosDadosNoPostgres()) throw f.indisponivel();
  const id = f.idRegistro(req.params.id);
  const l = await lendoNovo((m) => m.GfMigracaoHistoricos.findOne({ where: { id } }));
  if (!l) throw f.naoEncontrado();
  return { readAt: new Date().toISOString(), item: comoItem(l), entry: entrada(l) };
}

function conferirForma(b) {
  if (!f.ehObjeto(b)) throw f.invalido('corpo');
  if (!Array.isArray(b.histories) || !b.histories.length || b.histories.length > MAX_LOTE) throw f.invalido('histories');
  if (b.expectedLatest !== undefined && !f.ehObjeto(b.expectedLatest)) throw f.invalido('expectedLatest');
  for (const h of b.histories) {
    // Exemplo da demonstração nunca entra no banco real; ids e chaves fora do formato têm a mesma recusa do front.
    if (!h || typeof h !== 'object' || h.example === true) throw new dom.MigracaoInvalidaError(dom.MENSAGEM_INVALIDA, 'invalido');
    if (typeof h.clientId !== 'string' || !ID_CLIENTE.test(h.clientId) || (typeof h.sourceKey === 'string' && h.sourceKey.length > 100000) || (typeof h.batchId === 'string' && h.batchId.length > 160)) throw new dom.MigracaoInvalidaError(dom.MENSAGEM_INVALIDA, 'invalido');
  }
}

const SQL_EXISTENTES = (n) => `SELECT id, id_cliente, seq, item FROM gf_migracao_historicos WHERE id_cliente IN (${Array(n).fill('?').join(', ')}) ORDER BY id_cliente, seq`;
const COLUNAS = 'id, id_cliente, seq, source_key, source_hash, batch_id, corte_em, credito_centavos, debito_centavos, cobrar_debito, pos_pago, aprovado_em, item, criado_por, operation_key';

/** `POST /migration/apply`. */
async function aplicar(req) {
  const a = aplicadora(req, true);
  const b = req.body;
  const operationKey = f.chaveOperacao(b && b.operationKey);
  try { conferirForma(b); } catch (e) { throw traduzir(e); }
  const clientes = [...new Set(b.histories.map((h) => h.clientId))];
  const existentes = await verificarClientes(clientes);
  if (clientes.some((id) => !existentes.has(id))) throw new (require('../../../utils/AppError'))('Cadastro de cliente não encontrado.', 404, { codigo: 'CLIENT_NOT_FOUND' }, true);
  return f.gravar(req, {
    escopo: 'migracao.aplicar', operationKey, corpo: { expectedLatest: b.expectedLatest ?? null, histories: b.histories }, entidade: 'migracao', entidadeId: `lote:${b.histories[0].batchId}`.slice(0, 64), acao: 'migracao.aplicar',
    producao: async (ex) => {
      try {
        // Uma trava para todo o lote (as revisões de uma cliente nunca se cruzam; sem risco de impasse entre lotes).
        await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_migracao_historicos']);
        const [linhas] = await ex.execute(SQL_EXISTENTES(clientes.length), clientes);
        const porCliente = {}; const contagem = {};
        for (const l of linhas) { (porCliente[l.id_cliente] = porCliente[l.id_cliente] || []).push(comoItem(l)); contagem[l.id_cliente] = Number(l.seq); }
        if (b.expectedLatest) {
          for (const h of b.histories) {
            const vigente = porCliente[h.clientId] ? porCliente[h.clientId][porCliente[h.clientId].length - 1].sourceKey : null;
            if (!(h.clientId in b.expectedLatest) || vigente !== b.expectedLatest[h.clientId]) throw f.conflitoVersao(`A abertura da cliente ${h.clientId} mudou em outra aba. Nenhuma abertura deste lote foi aplicada. Confira a ficha e abra novamente a confirmação.`);
          }
        }
        const { novos, repetidos } = dom.aplicarLote(porCliente, b.histories);
        const gravados = [];
        for (const h of novos) {
          contagem[h.clientId] = (contagem[h.clientId] || 0) + 1;
          const id = randomUUID();
          await ex.execute(`INSERT INTO gf_migracao_historicos (${COLUNAS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, h.clientId, contagem[h.clientId], h.sourceKey, createHash('sha256').update(h.sourceKey, 'utf8').digest('hex'), h.batchId, h.cutoffAt, h.importedCreditCents, h.importedDebitCents, h.collectDebt, h.postpaid, new Date(h.approvedAt).toISOString(), JSON.stringify(h), a.nome, operationKey]);
          gravados.push({ id, clientId: h.clientId, seq: contagem[h.clientId], sourceKey: h.sourceKey });
        }
        const agora = new Date().toISOString();
        // Auditoria sem nomes: só contagens e ids de cliente (máx. 50) e o lote.
        return {
          antes: null,
          depois: { applied: novos.length, repeated: repetidos.length, clients: clientes.length, batchIds: [...new Set(b.histories.map((h) => h.batchId))].slice(0, 10), clientIds: clientes.slice(0, 50) },
          resposta: { readAt: agora, applied: novos.length, repeated: repetidos.length, items: novos, entries: gravados },
        };
      } catch (e) { throw traduzir(e); }
    },
  });
}

module.exports = { ler, obter, aplicar, definirVerificadorDeClientes, MAX_LOTE };
