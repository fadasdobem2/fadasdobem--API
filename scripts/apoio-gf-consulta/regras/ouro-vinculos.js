'use strict';

/** Confere `consulta-vinculos.js` e a compensação de `consulta-desfechos.js` contra o ouro (`ouro-regras-vinculos-front.json`). */

const fs = require('fs');
const path = require('path');
const vin = require('../../../src/gestao-fadas/_comum/dominio/consulta-vinculos');
const des = require('../../../src/gestao-fadas/_comum/dominio/consulta-desfechos');
const { jsonIgual } = require('./comparar');
const { ISO } = require('./fabrica');

const executar = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e.message }; } };

function verificar(arquivo = path.join(__dirname, '..', 'ouro-regras-vinculos-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; const mensagens = {}; let ok = 0; let aceitas = 0;
  const conferir = (nome, esperado, feito) => {
    const bom = esperado.ok !== undefined ? feito.ok !== undefined && jsonIgual(feito.ok, esperado.ok) : feito.erro === esperado.erro;
    if (bom) { ok += 1; if (esperado.ok !== undefined) aceitas += 1; else mensagens[esperado.erro] = (mensagens[esperado.erro] || 0) + 1; } else falhas.push(`${nome}: ${feito.erro || (feito.ok !== undefined ? 'aceitou' : '')} x ${esperado.erro || 'aceita'}`.slice(0, 300));
  };
  ouro.casos.forEach((c, k) => {
    const cen = ouro.cenarios[c.c]; const clone = (x) => JSON.parse(JSON.stringify(x));
    const lista = () => cen.consultas.map((x) => (x.id === c.orig || (c.t !== 'vinculos' && x.id === c.item.id) ? clone(c.t === 'vinculos' ? cen.consultas.find((y) => y.id === c.orig) : c.item) : x));
    if (c.t === 'vinculos') {
      conferir(`beneficios #${k}`, c.beneficios, executar(() => vin.validarBeneficios(clone(c.item), lista(), cen.perfil)));
      conferir(`complemento #${k}`, c.complemento, executar(() => vin.validarComplemento(clone(c.item), lista(), cen.pagamentos)));
    } else if (c.t === 'maximo') conferir(`maximo #${k}`, c.r, executar(() => vin.maximoDaCompensacao(clone(c.item), cen.pagamentos, c.parcial)));
    else if (c.t === 'concessao') conferir(`concessao #${k}`, c.r, executar(() => des.concessaoDaCompensacao(clone(c.item), cen.pagamentos, c.minutos, c.motivo, 'Laya', ISO(0, 200))));
    else if (c.t === 'compensacao') conferir(`compensacao #${k}`, c.r, executar(() => { const x = des.prepararCompensacao({ clientId: c.item.clientId, sourceId: c.item.id, minutes: c.minutos, reason: c.motivo, complaint: c.queixa }, clone(cen.consultas), cen.pagamentos, 'Laya', ISO(0, 200), 'atendente'); return { next: x.next, benefit: x.benefit }; }));
  });
  return { ok, falhas, aceitas, mensagens };
}

module.exports = { verificar };
