'use strict';

/**
 * Item 3: as regras do store. Roda os cenários de `cenarios-store.js` na loja da A e compara com o que a loja REAL da B fez
 * (ouro): as saídas (registro ou código da recusa), o traço de SQL (inclusive a ordem dos FOR UPDATE e das transações) e as
 * tabelas finais. A conferência da conta (`ACCOUNT_EXISTS`) é só da A e já vem fora do traço.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { CENARIOS } = require('./cenarios-store');
const { rodarCenario } = require('./rodar-cenario');
const { openingView } = require('../../src/gestao-fadas/features/repasse/repasse.dto');
const { preencherNomes } = require('../../src/gestao-fadas/features/repasse/repasse.service');

const { criarRepasseEscrita } = require(path.join(__dirname, '..', '..', 'src', 'gestao-fadas', 'features', 'repasse', 'escrita', 'fabrica'));
const limpo = (v) => JSON.parse(JSON.stringify(v));

function primeiraDiferenca(esperado, obtido) {
  for (let i = 0; i < Math.max(esperado.length, obtido.length); i += 1) {
    try { assert.deepEqual(obtido[i], esperado[i]); } catch { return `#${i}\n        B: ${JSON.stringify(esperado[i])}\n        A: ${JSON.stringify(obtido[i])}`; }
  }
  return null;
}

async function verificarStore(ouro) {
  const r = { total: 0, iguais: 0, divergencias: [] };
  for (const cenario of CENARIOS) {
    const esperado = ouro.find((o) => o.nome === cenario.nome);
    if (!esperado) { r.divergencias.push(`cenário sem ouro: ${cenario.nome}`); continue; }
    const a = limpo(await rodarCenario(cenario, (banco, d) => criarRepasseEscrita({ ...banco.paraA(), ...d })));
    const partes = [['saídas', esperado.saidas, a.saidas], ['traço de SQL', esperado.eventos, a.eventos]];
    for (const [rotulo, e, o] of partes) {
      r.total += 1;
      const dif = primeiraDiferenca(e, o);
      if (dif === null) r.iguais += 1; else r.divergencias.push(`${cenario.nome}: ${rotulo} difere em ${dif}`);
    }
    // A resposta da gravação de abertura: o registro do store na `openingView` com os nomes das contas.
    const nomes = new Map([['conta-1', 'Laya Souza'], ['conta-2', 'Nice']]);
    const vistas = a.saidas.map((s) => (s.ok && s.ok.revision !== undefined ? preencherNomes(openingView(s.ok), nomes) : null));
    r.total += 1;
    const difVista = primeiraDiferenca(esperado.vistas, vistas);
    if (difVista === null && JSON.stringify(esperado.vistas) === JSON.stringify(vistas)) r.iguais += 1;
    else r.divergencias.push(`${cenario.nome}: openingView do registro gravado difere (${difVista || 'ordem das chaves'})`);
    for (const tabela of Object.keys(esperado.tabelas)) {
      r.total += 1;
      try { assert.deepEqual(a.tabelas[tabela], esperado.tabelas[tabela]); r.iguais += 1; } catch { r.divergencias.push(`${cenario.nome}: tabela ${tabela} final difere`); }
    }
  }
  return r;
}

module.exports = { verificarStore };
