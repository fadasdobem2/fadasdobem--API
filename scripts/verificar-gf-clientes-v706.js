'use strict';

/**
 * Verificação das regras de Clientes da v706 (sem banco): compara os portes de `_comum/dominio/cliente-*.js` com o OURO do código
 * real do front (scripts/apoio-gf-clientes/ouro-clientes-v706.json, gerado por gerar-ouro-gf-clientes-v706.js) e refuta mutantes.
 *   node scripts/verificar-gf-clientes-v706.js
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const busca = require('../src/gestao-fadas/_comum/dominio/cliente-busca-telefone');
const datas = require('../src/gestao-fadas/_comum/dominio/cliente-lista-datas');
const pagina = require('../src/gestao-fadas/_comum/dominio/cliente-historico-pagina');
const nomes = require('../src/gestao-fadas/_comum/dominio/cliente-cadastro-nomes');
const fone = require('../src/gestao-fadas/_comum/dominio/cliente-telefone');
const { clientRolePolicy } = require('../src/gestao-fadas/features/clientes/helpers/perfis');
const { shiftDateKey } = require('../src/gestao-fadas/features/clientes/helpers/valores');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-clientes', 'ouro-clientes-v706.json'), 'utf8'));
let ok = 0;
const falhas = [];
const passo = (nome, fn) => { try { fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); } };
const igual = (a, b, quem) => assert.deepStrictEqual(a, b, quem);

passo('busca por telefone: 300 pares iguais ao front (8 dígitos é o número local completo; DDD estreita; 9 inicial nos dois sentidos)', () => {
  for (const c of ouro.telefone) igual(busca.clientPhoneMatches(c.q, c.s), c.casa, `${c.q} x ${c.s}`);
});
passo('lista de datas: a política por função (atendente Hoje, Ontem e 7 dias) e o recorte de cada modo iguais ao front', () => {
  for (const p of ouro.politica) { const mine = clientRolePolicy(p.papel); igual([mine.dates, mine.pageSize, mine.canSeeBalance], [p.dates, p.pageSize, p.canSeeBalance], p.papel); }
  for (const c of ouro.faixa) igual(datas.clientListRange(c.papel, c.modo, c.today, c.start, c.end, shiftDateKey), c.r, `${c.papel} ${c.modo}`);
});
passo('histórico da ficha: a página é sempre de 10, como o front, para qualquer alcance', () => {
  igual(pagina.CLIENT_HISTORY_PAGE_SIZE, ouro.paginaHistorico);
  for (const s of [{ kind: 'recent', limit: 10 }, { kind: 'recent', limit: 20 }, { kind: 'complete' }]) igual(pagina.realClientHistoryPageSize(s), 10);
});
passo('nomes do cadastro: sugestão, nome composto e capitalização iguais ao front', () => {
  for (const c of ouro.nomes) {
    igual(nomes.suggestedRegistrationNames(c.n), c.sugerido, c.n); igual(nomes.suggestedClientNames(c.n), c.compra, c.n); igual(nomes.registrationFullName(c.n), c.completo, c.n);
  }
});
passo('telefone do cadastro: WhatsApp exibido e chave de duplicidade iguais ao front', () => {
  for (const c of ouro.whats) igual(fone.clientWhatsAppText(c.v), c.saida, c.v);
  for (const c of ouro.duplicado) igual(fone.normalizeDuplicatePhone(c.v), c.norm, c.v);
});

// Mutantes: uma regra errada tem de ser recusada pelo ouro.
const recusa = (nome, mutante, rodar) => passo(`mutante recusado: ${nome}`, () => { assert.throws(() => rodar(mutante), undefined, 'o ouro aceitou o mutante'); });
recusa('busca antiga por sufixo', (q, s) => { const d = (x) => x.replace(/\D/g, ''); return d(s).endsWith(d(q)); },
  (m) => { for (const c of ouro.telefone) igual(m(c.q, c.s) && c.q.trim() !== '', c.casa, `${c.q} x ${c.s}`); });
recusa('atendente só com Hoje', null, () => { for (const p of ouro.politica) igual(p.papel === 'atendente' ? ['hoje'] : p.dates, p.dates, p.papel); });
recusa('página de 15 no histórico completo', null, () => igual(15, ouro.paginaHistorico));
recusa('9 inicial só em um sentido', (q, s) => busca.clientPhoneMatches(q, s) && !(q.replace(/\D/g, '').length === 9 && s.replace(/\D/g, '').length === 8),
  (m) => { for (const c of ouro.telefone) igual(m(c.q, c.s), c.casa, `${c.q} x ${c.s}`); });

console.log(`\n${ok} ok, ${falhas.length} falhas`);
process.exit(falhas.length ? 1 : 0);
