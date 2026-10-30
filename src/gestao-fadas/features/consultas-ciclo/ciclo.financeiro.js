'use strict';

/**
 * Gancho financeiro do ciclo da consulta (Maturacao/29 seção 10): com `GF_FATIA_PAGAMENTOS=true` o término informado passa a conferir o
 * excesso sobre o tempo máximo contra o SALDO REAL da cliente (pagamentos confirmados, benefícios e saldo de partida do legado, congelado),
 * com o domínio portado do front (`assessTarologistFinish` com contexto financeiro). Desligada, devolve `undefined` e a consulta se comporta
 * como antes (o excesso nunca é "coberto" e vai à conferência).
 */

const ctx = require('../financeiro-cliente/fin.contexto');
const saldo = require('../../_comum/dominio/financeiro-saldo');

const pagamentosLigado = (env = process.env) => `${env.GF_FATIA_PAGAMENTOS || ''}`.trim().toLowerCase() === 'true';

/** Contexto financeiro da cliente da consulta, dentro da transação. `undefined` com a fatia desligada. */
async function contexto(ex, item) {
  if (!pagamentosLigado()) return undefined;
  const [ext] = await ex.execute('SELECT perfil_pagamento FROM gf_clientes_ext WHERE id_cliente = ?', [item.clientId]);
  const viva = (await ctx.partidaNoLegado([item.clientId])).get(item.clientId);
  const c = await ctx.carregar(ctx.porExecutor(ex), item.clientId, { perfilPagamento: (ext[0] && ext[0].perfil_pagamento) || '', partidaViva: viva });
  return { payments: c.payments, consultations: c.consultations, profile: c.profile };
}

/** O retrato financeiro que a conferência guarda no evento (nunca bloqueia: a decisão de cobrar ou não é da equipe, como no front). */
async function retrato(ex, item, agora) {
  const fin = await contexto(ex, item);
  if (!fin) return undefined;
  const minutos = Math.ceil((item.durationSeconds || 0) / 60);
  const cobertura = saldo.coberturaDoExcesso(item, minutos, agora, fin);
  return { debitCents: Math.round(cobertura.debit * 100), availableCents: cobertura.availableCents, covered: Math.round(cobertura.debit * 100) <= cobertura.availableCents, otherActive: cobertura.otherActive };
}

module.exports = { contexto, retrato, pagamentosLigado };
