'use strict';

/**
 * Verificação do domínio das Restrições da v706 contra o ouro do CÓDIGO REAL do front (`gerar-ouro-gf-restricoes.js`), com mutantes.
 *   node scripts/verificar-gf-restricoes.js      (offline; o HTTP e o banco seguem em verificar-gf-financeiro-cliente.js)
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dom = require('../src/gestao-fadas/_comum/dominio/restricoes');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-restricoes', 'ouro-restricoes-front.json'), 'utf8'));
const limpo = (x) => JSON.parse(JSON.stringify(x === undefined ? null : x));
const porte = (c) => {
  if (c.tipo === 'proprios') return dom.clientesDaTarologa(c.consultas, c.linhas, c.tarotId);
  try { return dom.alterar(c.linhas, c.entrada); } catch (e) { if (e instanceof dom.RestricaoInvalidaError) return { erro: e.message }; throw e; }
};
let ok = 0; const falhas = [];
for (const [k, { caso, esperado }] of ouro.cenarios.entries()) {
  try { assert.deepStrictEqual(limpo(porte(caso)), esperado); ok += 1; } catch (e) { falhas.push(`#${k} ${caso.tipo}: ${String(e.message).split('\n')[0].slice(0, 160)}`); }
}
console.log(`  ${ok}/${ouro.cenarios.length} cenários iguais ao front`);
const recusadas = ouro.cenarios.filter((c) => c.esperado && c.esperado.erro).length;
const aceitas = ouro.cenarios.length - recusadas;
if (!(recusadas > 300 && aceitas > 100)) falhas.push(`cobertura baixa: ${aceitas} aceitos, ${recusadas} recusados`);

// Mutantes: o que o front recusa tem de continuar recusado, e o que o front aceita não pode ser recusado.
const tarologa = ouro.cenarios.find((c) => c.caso.tipo === 'alterar' && !c.esperado.erro && c.caso.entrada.role === 'tarologa' && !c.caso.entrada.remove && c.caso.entrada.details);
assert.ok(tarologa, 'há inclusão pela taróloga aceita pelo front');
const mut = (nome, ajuste, texto) => {
  const e = JSON.parse(JSON.stringify(tarologa.caso.entrada)); ajuste(e);
  try { dom.alterar(tarologa.caso.linhas, e); falhas.push(`mutante ${nome}: aceito`); } catch (x) { if (!(x instanceof dom.RestricaoInvalidaError && (!texto || x.message === texto))) falhas.push(`mutante ${nome}: ${x.message}`); }
};
mut('cliente fora da lista dela', (e) => { e.allowedClientIds = ['1']; }, 'Esta cliente não está disponível para seu acesso.');
mut('sem lista', (e) => { delete e.allowedClientIds; }, 'Esta cliente não está disponível para seu acesso.');
mut('motivo de cliente na restrição dela', (e) => { e.details.reasonCode = 'canc'; }, 'Escolha o motivo da restrição.');
mut('data futura', (e) => { e.details.occurredOn = '2099-01-01'; }, 'Confira a data do relato.');
mut('mensagem vazia', (e) => { e.details.message = ' '; }, 'Registre a mensagem, com até 5.000 caracteres.');
mut('em nome de outro tarólogo', (e) => { e.tarotId = '9002'; }, 'Esta alteração não está disponível para seu acesso.');

if (falhas.length) { console.log(falhas.slice(0, 15).join('\n')); console.log(`FALHOU: ${falhas.length}`); process.exit(1); }
console.log('Restrições v706: ok');
