'use strict';

/** Verificador OFFLINE (Maturacao/39): `painel-lancamento.js` contra o ouro do código real do front (`gerar-ouro-gf-painel-lancamento.js`). */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const l = require('../src/gestao-fadas/_comum/dominio/painel-lancamento');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-lancamento.json'), 'utf8'));
Date.now = () => { throw new Error('Date.now() chamado dentro da regra'); };
const json = (v) => JSON.parse(JSON.stringify(v));
let falhas = 0;
const comparar = (r, e, o) => { try { assert.deepStrictEqual(o, e); } catch (_e) { falhas += 1; if (falhas <= 8) console.error(`${r}\n  esperado ${JSON.stringify(e).slice(0, 500)}\n  obtido   ${JSON.stringify(o).slice(0, 500)}`); } };
for (const [v, texto] of ouro.moeda) comparar(`moeda ${v}`, texto, l.reais(v));
ouro.casos.forEach((c, n) => {
  const e = c.entrada; const perfil = c.perfil || undefined; const preco = e.pricing || undefined;
  comparar(`caso ${n} passo`, c.passo, json(l.passoDaReserva(c.item, { ...e, pricing: preco }, perfil)));
  const f = l.financiamentoDoLancamento(c.item, { payments: e.payments, consultations: e.consultations, now: e.now, pricing: preco }, perfil); const { coverage: cv, ...resto } = f;
  const obtido = { ...resto, coverage: { balance: cv.balance, postpaid: cv.postpaid, benefitMinutes: cv.benefitMinutes, hasConfirmedReceipt: cv.hasConfirmedReceipt, confirmedAvailableBalance: cv.confirmedAvailableBalance, awaitingConfirmation: cv.awaitingConfirmation, canConsult: cv.canConsult, canLaunch: cv.canLaunch, label: cv.label } };
  comparar(`caso ${n} financiamento`, c.financiamento.ok, json(obtido));
});
if (falhas) { console.error(`FALHOU: ${falhas} divergências com o código real do front.`); process.exit(1); }
console.log(`OK: ${ouro.casos.length} casos (passo da reserva e cobertura do cartão) e ${ouro.moeda.length} valores de moeda iguais ao front.`);
