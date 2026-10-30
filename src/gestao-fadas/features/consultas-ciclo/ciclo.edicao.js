'use strict';

/**
 * Edição de dados da consulta (`POST /:id/revise`, comando `edicao`; Maturacao/38): confere no servidor o que o front confere em `saveForm`
 * (consulta com queixa só pela administradora, horário, vínculos de bônus, saldo, continuação e, na troca de cliente, a autorização da
 * supervisora e a ocupação). Regras em `_comum/dominio/consulta-edicao.js`. O recálculo de cobrança da edição NÃO é refeito aqui.
 */

const dom = require('../../_comum/dominio/consulta-edicao');
const sessao = require('../../_comum/dominio/consulta-comum');
const autorizacao = require('./ciclo.autorizacao');
const financeiro = require('./ciclo.financeiro');
const store = require('./ciclo.store');
const comum = require('./ciclo.comum');

const MSG_OCUPADA = 'Já existe outra consulta para esta cliente ou taróloga. Confira antes de alterar.';

async function conferir(ex, { a, antes, pedido, agora }) {
  const fin = dom.precisaDoSaldo(antes, pedido) ? await financeiro.contexto(ex, pedido) : undefined;
  dom.conferirEdicao(antes, pedido, { papel: a.perfil, agora, fin: fin && { ...fin, consultations: fin.consultations.map((i) => (i.id === antes.id ? antes : i)) } });
  const identidade = antes.clientId !== pedido.clientId || antes.tarotId !== pedido.tarotId;
  if (antes.clientId !== pedido.clientId && pedido.status === 'Em curso') await autorizacao.conferir(ex, pedido.clientId);
  if (identidade && pedido.status === 'Em curso') {
    await store.travarOcupacao(ex, pedido.tarotId, pedido.clientId);
    const abertas = (await store.abertasDe(ex, pedido.tarotId, pedido.clientId)).map((r) => r.item);
    if (sessao.conflitosDeOcupacao(abertas, pedido.tarotId, pedido.clientId, antes.id).length) throw comum.conflitoOcupacao(MSG_OCUPADA);
  }
}

const cobranca = require('../../_comum/dominio/consulta-edicao-cobranca');
const { RegraConsultaError } = sessao;
const comoItem = (l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item);

/**
 * O SERVIDOR refaz `billing`, `minuteValue` e (na troca de cliente) o máximo no início gravado da edição, com a tabela de preços real
 * (`gf_precos_versoes`), os pagamentos e as consultas reais da cliente. Devolve os campos refeitos (instante e autor do servidor) ou `null`
 * quando não é uma gravação do formulário de edição (ou sem a fatia Pagamentos). Divergência do navegador = 422.
 */
async function refazerPreco(ex, { a, antes, pedido, agora }) {
  if (!cobranca.ehEdicaoDeTela(antes, pedido)) return null;
  const fin = await financeiro.contexto(ex, pedido);
  if (!fin) return null;
  const [linhas] = await ex.execute('SELECT id, item FROM gf_precos_versoes ORDER BY criado_em, id');
  const ctx = { payments: fin.payments, consultations: [...fin.consultations.filter((i) => i.id !== antes.id), ...(antes.clientId === pedido.clientId ? [antes] : [])], profiles: { [pedido.clientId]: fin.profile }, history: linhas.map(comoItem) };
  try { return cobranca.conferirECorrigir(antes, pedido, ctx, { em: agora, ator: a.nome }); } catch (e) { throw e instanceof RegraConsultaError ? e : new RegraConsultaError(cobranca.MENSAGEM); }
}

module.exports = { conferir, refazerPreco, MSG_OCUPADA };
