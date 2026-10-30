'use strict';

/**
 * Verifica as regras de Pagamentos no servidor (Maturacao/41) contra o ouro do CÓDIGO REAL do front
 * (scripts/apoio-gf-pagamentos-regras/ouro-pagamentos-regras-front.json) e contra mutantes que o servidor tem de recusar.
 * Offline: `node scripts/verificar-gf-pagamentos-regras.js` (sem banco). Regerar o ouro: scripts/gerar-ouro-gf-pagamentos-regras.js --front=<pasta>.
 */

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const dom = require('../src/gestao-fadas/_comum/dominio/pagamentos-regras');
const { permissoesDoPerfil } = require('../src/gestao-fadas/_comum/politica-acesso');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-pagamentos-regras', 'ouro-pagamentos-regras-front.json'), 'utf8'));
/** Frases do front que o servidor reproduz (as demais recusas do front são de valor/forma de digitação, que o registro não carrega). */
const COBERTAS = [/^Banco: /, /^Em nome de quem: /, /^Autorização: /, /^Observação: /, /^Informe uma data de pagamento válida\.$/, /^Informe a data do pagamento\.$/,
  /^O total cobrado no cartão deve ser igual/, /^O valor de primeira consulta é exclusivo para Pix\.$/, /^Este pagamento originou transferência/, /^Este pagamento tem devolução de crédito/,
  /^Este pagamento já tem movimentações\. A forma/, /^O novo valor não pode ser menor/, /^Este pagamento está cancelado e não pode ser alterado\.$/, /^Somente Financeiro e Administração/,
  /^Edição em planilha disponível/, /^Pagamento com consulta ou movimentações/, /^Há movimentações registradas/, /^Taxa disponível para cartão\.$/, /^Informe uma taxa entre zero/];
const coberta = (m) => COBERTAS.some((r) => r.test(m));
const TELA_PLANILHA_OU_LOTE = new Set([dom.MSG_CONFIRMAR, dom.MSG_PLANILHA]);

const tentar = (fn) => { try { fn(); return null; } catch (e) { return e instanceof dom.PagamentoInvalidoError ? e.message : `EXCECAO ${e.message}`; } };
let ok = 0; let recusas = 0; let fora = 0; const falhas = []; const porTipo = {};
ouro.cenarios.forEach((c, i) => {
  const perfil = permissoesDoPerfil(c.papel || c.perfil);
  const obtido = c.tipo === 'novo' ? tentar(() => dom.conferirLancamento(c.record, perfil)) : tentar(() => dom.conferirRevisao(c.antes, c.depois, perfil));
  porTipo[c.tipo] = (porTipo[c.tipo] || 0) + 1;
  if (c.esperado.ok) {
    if (obtido) falhas.push(`#${i} ${c.tipo}: o front aceita e o servidor recusou: ${obtido}`); else ok += 1;
    return;
  }
  if (!coberta(c.esperado.erro)) { fora += 1; return; }
  recusas += 1;
  const igual = obtido === c.esperado.erro || (c.tipo !== 'novo' && c.esperado.erro.startsWith('Somente Financeiro') || c.esperado.erro.startsWith('Edição em planilha')) && TELA_PLANILHA_OU_LOTE.has(obtido);
  if (!igual) falhas.push(`#${i} ${c.tipo}: front "${c.esperado.erro}" servidor "${obtido}"`); else ok += 1;
});
console.log(`ouro pagamentos (regras): ${ok} conferências iguais ao código do front (${recusas} recusas com a frase do front, ${fora} recusas de digitação fora do registro)`);
console.log(Object.entries(porTipo).map(([k, v]) => `${k}=${v}`).join(' '));

// Mutantes: o que o front jamais produz e o servidor tem de recusar.
const base = ouro.cenarios.find((c) => c.tipo === 'novo' && c.esperado.ok && c.record.method === 'PIX' && !c.record.purchase).record;
const atendente = permissoesDoPerfil('atendente'); const assistente = permissoesDoPerfil('assistente'); const supervisora = permissoesDoPerfil('supervisora');
const mutantesNovos = [
  { ...base, status: 'Corrigido' }, { ...base, status: 'Cancelado' }, { ...base, confirmation: 'Confirmado' }, { ...base, confirmation: 'A confirmar' }, { ...base, movements: [{ id: 'm', kind: 'refund', amount: 1, bankEffect: -1, creditEffect: -1 }] },
  { ...base, actualFee: 1 }, { ...base, bank: 'Caixa' }, { ...base, method: 'Dinheiro', bank: 'BB' }, { ...base, grossAmount: base.amount + 5 }, { ...base, payerName: '' }, { ...base, payerName: undefined },
  { ...base, purchase: { table: 'first', minutes: 15, amount: base.amount }, cashUnitValue: undefined, method: 'Transferência' }, { ...base, cashUnitValue: undefined }, { ...base, purchase: { table: 'regular', minutes: 10, amount: base.amount } },
  { ...base, authorization: 'x'.repeat(101) }, { ...base, note: 'x'.repeat(4001) }, { ...base, paidAt: '2026-02-30' },
];
mutantesNovos.forEach((m, i) => assert.ok(tentar(() => dom.conferirLancamento(m, atendente)), `mutante de lançamento ${i} foi aceito`));
assert.strictEqual(tentar(() => dom.conferirLancamento({ ...base, confirmation: 'Confirmado' }, atendente)), dom.MSG_CONFIRMAR);
const antes = ouro.cenarios.find((c) => c.tipo === 'revisao' && c.esperado.ok && c.mov === 0 && c.base === 'pix').antes;
const comTransfer = { ...antes, movements: [{ id: 'm1', kind: 'balance-transfer', amount: 20, bankEffect: 0, creditEffect: -20 }] };
const mutantesRevisao = [
  [antes, { ...antes, confirmation: 'Confirmado' }, atendente], [antes, { ...antes, confirmation: 'Confirmado' }, supervisora], [antes, { ...antes, clientId: '999' }, atendente], [antes, { ...antes, actualFee: 2 }, atendente],
  [{ ...antes, status: 'Cancelado' }, { ...antes, status: 'Cancelado', amount: antes.amount + 1 }, assistente], [{ ...antes, status: 'Cancelado' }, { ...antes, status: 'Cancelado', confirmation: 'Confirmado' }, assistente],
  [comTransfer, { ...comTransfer, amount: antes.amount + 1 }, atendente], [comTransfer, { ...comTransfer, paidAt: '2026-10-01' }, atendente], [comTransfer, { ...comTransfer, method: 'Transferência' }, atendente],
  [{ ...antes, movements: [{ id: 'm1', kind: 'refund', amount: 60, bankEffect: -60, creditEffect: -60 }] }, { ...antes, movements: [{ id: 'm1', kind: 'refund', amount: 60, bankEffect: -60, creditEffect: -60 }], amount: 50, grossAmount: 50 }, atendente],
  [{ ...antes, confirmation: 'Confirmado', movements: [comTransfer.movements[0]] }, { ...antes, confirmation: 'A confirmar', movements: [comTransfer.movements[0]] }, assistente],
  [antes, { ...antes, clientId: '999', linkedConsultationId: undefined, ...{} }, assistente].slice(0, 3),
];
mutantesRevisao.slice(0, 11).forEach(([a, d, p], i) => assert.ok(tentar(() => dom.conferirRevisao(a, d, p)), `mutante de revisão ${i} foi aceito`));
// A administradora e a assistente confirmam; a troca de cliente só sem consulta e sem movimentos.
assert.strictEqual(tentar(() => dom.conferirRevisao(antes, { ...antes, confirmation: 'Confirmado' }, assistente)), null);
assert.strictEqual(tentar(() => dom.conferirRevisao({ ...antes, linkedConsultationId: 'C-1' }, { ...antes, linkedConsultationId: 'C-1', clientId: '999' }, assistente)), 'Pagamento com consulta ou movimentações: confira o vínculo antes de trocar a cliente.');
console.log(`mutantes recusados: ${mutantesNovos.length} de lançamento + 11 de revisão`);
if (falhas.length) { console.error(`${falhas.length} divergências; primeiras:\n${falhas.slice(0, 15).join('\n')}`); process.exit(1); }
