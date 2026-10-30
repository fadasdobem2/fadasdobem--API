'use strict';

/**
 * Verifica as regras financeiras de pagamento do servidor (Maturacao/42) contra o ouro do CÓDIGO REAL do front
 * (scripts/apoio-gf-financeiro-regras/ouro-*-front.json) e contra mutantes. Offline (entra em `verificar:legado`); com `DATABASE_URL`
 * descartável `fdb_fnr_*` roda também os passos HTTP (apoio-gf-financeiro-regras/filho.js).
 *   node scripts/verificar-gf-financeiro-regras.js
 */

const fs = require('node:fs');
const path = require('node:path');

const AREAS = ['movimento', 'ocorrencias', 'transferencia', 'planilha', 'compra', 'datas'];
let falhou = false;
for (const area of AREAS) {
  const arquivo = path.join(__dirname, 'apoio-gf-financeiro-regras', `verificar-${area}.js`);
  if (!fs.existsSync(arquivo) || !fs.existsSync(path.join(__dirname, 'apoio-gf-financeiro-regras', `ouro-${area}-front.json`))) continue;
  const r = require(arquivo).verificar();
  console.log(`ouro ${r.nome}: ${r.ok}/${r.total} conferências iguais ao código do front (${r.aceitos} aceitas, ${r.recusas} recusas com a MESMA frase)`);
  if (r.extra) console.log(r.extra);
  if (r.falhas.length) { falhou = true; console.error(`${r.falhas.length} divergências em ${r.nome}; primeiras:\n${r.falhas.slice(0, 12).join('\n')}`); }
}
process.exit(falhou ? 1 : 0);
