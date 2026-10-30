'use strict';

/**
 * Diferencial das regras do store contra o PostgreSQL REAL: os cenários de apoio-gf-diferencial/cenarios-store.js (as MESMAS entradas que
 * rodaram na loja da B e geraram o ouro) rodam na loja da A com o executor do banco novo; as SAÍDAS (registro ou código da recusa) precisam
 * ser iguais às do ouro. Contas `conta-1`/`conta-2` viram usuários reais (a segunda NÃO existe, como no ouro) e voltam ao nome no fim.
 * Fora: cenários que forçam falha do banco FALSO (auditoria quebrada, corrida simulada), que só existem no banco em memória.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { raiz } = require('./comum');

const r = (p) => path.join(raiz, p);
const SEM_BANCO_FALSO = /tarologo ausente do legado, conta ausente, corrida|reversao/;

function trocar(valor, de, para) {
  return JSON.parse(JSON.stringify(valor, (_k, v) => (v === de ? para : v)));
}

async function rodar({ conferir, criarUsuario, sequelize, TAROLOGOS }) {
  const { CENARIOS } = require(r('scripts/apoio-gf-diferencial/cenarios-store'));
  const escritor = require(r('src/gestao-fadas/novo/escritor'));
  const { contaExisteNaA } = require(r('src/gestao-fadas/novo/contas'));
  const { criarRepasseEscrita } = require(r('src/gestao-fadas/features/repasse/escrita/fabrica'));
  const ouro = JSON.parse(fs.readFileSync(r('src/gestao-fadas/fontes/ouro-validacao/store.json'), 'utf8'));
  const conta1 = await criarUsuario('Laya Souza');
  const conta2 = '00000000-0000-4000-8000-0000000000c2'; // inexistente
  for (const cenario of CENARIOS) {
    if (SEM_BANCO_FALSO.test(cenario.nome)) continue;
    const esperado = ouro.find((o) => o.nome === cenario.nome);
    await sequelize.query('TRUNCATE gf_repasse_pagamento_descontos, gf_repasse_divida_parcelas, gf_repasse_abertura_pendencias, gf_repasse_dividas, gf_repasse_ajustes, gf_repasse_aberturas, gf_repasse_percentuais, gf_repasse_calendarios, gf_auditoria CASCADE');
    const tarologos = new Set((cenario.opcoes && cenario.opcoes.tarologos) || ['7']);
    let relogio = 1_700_000_000_000;
    let seq = 0;
    const loja = criarRepasseEscrita({
      avulso: escritor.executarAvulso, emTransacao: escritor.emTransacao, contaExiste: contaExisteNaA,
      agora: () => (relogio += 1000), novoId: () => `id-${++seq}`, legado: { tarologoExiste: async (id) => tarologos.has(String(id)) },
    });
    const saidas = [];
    for (const passo of cenario.passos) {
      let entrada = typeof passo.entrada === 'function' ? passo.entrada(saidas.map((s) => (s.ok ? { ok: trocar(s.ok, conta1, 'conta-1') } : s))) : passo.entrada;
      entrada = trocar(trocar(structuredClone(entrada), 'conta-1', conta1), 'conta-2', conta2);
      try {
        saidas.push({ ok: await loja[passo.op](entrada) });
      } catch (e) {
        saidas.push({ erro: (e && (e.codigo || e.code)) || String(e && e.message) });
      }
    }
    const obtido = saidas.map((s) => (s.ok ? { ok: trocar(trocar(s.ok, conta1, 'conta-1'), conta2, 'conta-2') } : s));
    // jsonb não guarda a ordem das chaves (o MySQL/LONGTEXT guardava): compara por conteúdo, não por ordem.
    const mesmo = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };
    const igual = mesmo(obtido, esperado.saidas);
    const primeira = obtido.findIndex((o, i) => !mesmo(o, esperado.saidas[i]));
    conferir(`diferencial no Postgres: ${cenario.nome}`, igual,
      primeira < 0 ? '' : `\n   passo ${primeira}\n   B: ${JSON.stringify(esperado.saidas[primeira]).slice(0, 400)}\n   A: ${JSON.stringify(obtido[primeira]).slice(0, 400)}`);
  }
}

module.exports = { rodar };
