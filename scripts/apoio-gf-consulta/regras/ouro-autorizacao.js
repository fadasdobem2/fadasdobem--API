'use strict';

/** Confere `consulta-autorizacao.js` contra o ouro (`ouro-regras-autorizacao-front.json`). */

const fs = require('fs');
const path = require('path');
const aut = require('../../../src/gestao-fadas/_comum/dominio/consulta-autorizacao');

function verificar(arquivo = path.join(__dirname, '..', 'ouro-regras-autorizacao-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0; let recusas = 0;
  ouro.casos.forEach((c, k) => {
    const cen = ouro.cenarios[c.c];
    const feito = aut.erroDeLancamento(cen.clientId, cen.orientacao, cen.consultas);
    const esperado = c.r.ok === null ? undefined : c.r.ok;
    if (feito === esperado) { ok += 1; if (esperado) recusas += 1; } else falhas.push(`autorização #${k}: ${feito} x ${esperado}`);
  });
  return { ok, falhas, recusas };
}

module.exports = { verificar };
