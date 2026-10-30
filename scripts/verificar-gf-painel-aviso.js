'use strict';

/** Verificador OFFLINE (Maturacao/39): `painel-aviso.js` contra o ouro do código real do front (`gerar-ouro-gf-painel-aviso.js`), inclusive a `key` de confirmação. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const a = require('../src/gestao-fadas/_comum/dominio/painel-aviso');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-aviso.json'), 'utf8'));
Date.now = () => { throw new Error('Date.now() chamado dentro da regra'); };
let falhas = 0; let avisos = 0;
ouro.casos.forEach((c, n) => {
  const obtido = a.avisoDeDisponibilidade(c.entrada); const json = obtido === undefined ? null : JSON.parse(JSON.stringify(obtido)); if (json) avisos += 1;
  try { assert.deepStrictEqual(json, c.aviso); } catch (_e) { falhas += 1; if (falhas <= 6) console.error(`caso ${n}\n  esperado ${JSON.stringify(c.aviso).slice(0, 500)}\n  obtido   ${JSON.stringify(json).slice(0, 500)}\n  entrada ${JSON.stringify(c.entrada).slice(0, 600)}`); }
});
if (falhas) { console.error(`FALHOU: ${falhas} divergências com o código real do front.`); process.exit(1); }
console.log(`OK: ${ouro.casos.length} casos (${avisos} avisos com a chave de confirmação) iguais ao front.`);
