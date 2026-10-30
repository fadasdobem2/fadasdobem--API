'use strict';

/**
 * Contexto REAL para refazer as regras de dinheiro no servidor (Maturacao/42): pagamentos, consultas, benefícios e saldo de partida da cliente
 * (lidos DENTRO da transação, com a cliente travada), o histórico de preços (`gf_precos_versoes`) e, na transferência de saldo, as duas clientes
 * (perfil de crédito e existência do cadastro). Nada vem do navegador.
 */

const ctx = require('./fin.contexto');
const refazer = require('../../_comum/dominio/pagamentos-refazer');
const base = require('../../_comum/dominio/financeiro-base');

const comoItem = (l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item);

/** Pagamentos, consultas e perfil de crédito de UMA cliente (a do pagamento ou a origem da transferência). */
async function contextoDaCliente(ex, clientId) {
  const [perfil] = await ex.execute('SELECT perfil_pagamento FROM gf_clientes_ext WHERE id_cliente = ?', [clientId]);
  return ctx.carregar(ctx.porExecutor(ex), clientId, { perfilPagamento: (perfil[0] && perfil[0].perfil_pagamento) || '' });
}

/** Histórico de versões da tabela de valores (a VAL-001 do front é a base implícita). */
async function historicoDePrecos(ex) {
  const [linhas] = await ex.execute('SELECT id, item FROM gf_precos_versoes ORDER BY criado_em, id');
  return linhas.map(comoItem);
}

/** `familia`: o que `refazer.reconhece` devolveu. `existe(id)`: o cadastro da cliente existe. */
async function contextoParaRefazer(ex, familia, antes, depois, agora, existe) {
  if (familia === 'campos') {
    const base = await contextoDaCliente(ex, antes.clientId);
    return { ...base, history: await historicoDePrecos(ex), nomes: depois.clientId !== antes.clientId && (await existe(depois.clientId)) ? { [depois.clientId]: true } : {} };
  }
  if (familia !== 'transferencia') return contextoDaCliente(ex, antes.clientId);
  const dados = refazer.dadosDaTransferencia(refazer.pernasNovas(antes, depois)[0]);
  await ex.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_pagamentos:cliente:${dados.source}`]);
  const origem = await contextoDaCliente(ex, dados.source);
  const destino = dados.target === dados.source ? origem : await contextoDaCliente(ex, dados.target);
  const nomes = {};
  for (const id of [dados.source, dados.target]) if (await existe(id)) nomes[id] = true;
  const preco = base.precoVigente(await historicoDePrecos(ex), agora);
  return { payments: origem.payments, consultations: origem.consultations, profile: origem.profile, perfis: { [dados.source]: origem.profile, [dados.target]: destino.profile }, nomes, valorRegular: preco.regularMinuteValue || 2.96 };
}

/** Contexto do LANÇAMENTO novo: o da cliente mais o histórico de preços. */
async function contextoDoLancamento(ex, clientId) {
  return { ...(await contextoDaCliente(ex, clientId)), history: await historicoDePrecos(ex) };
}

module.exports = { contextoDaCliente, historicoDePrecos, contextoParaRefazer, contextoDoLancamento };
