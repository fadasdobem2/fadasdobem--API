'use strict';

/**
 * Casos do fuzz determinístico da validação de entrada (item 1). Roda SÓ no gerador do ouro (a A recebe os casos prontos
 * em fontes/ouro-validacao/validacao.json). Gera corpos válidos e os muta: valores de borda por tipo de campo, campo
 * extra, campo ausente, corpo que não é objeto, combinações sorteadas (PRNG fixo, sempre os mesmos casos).
 */

const rep = (c, n) => c.repeat(n);

function prng(semente) {
  let s = semente >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GENERICO = [null, 0, 1, -1, 1.5, true, false, [], {}, '', ' ', 'x', [1], { a: 1 }];
const DINHEIRO = ['0.00', '-0.00', '00.00', '01.00', '1.00', '1.0', '1', '1.000', '.50', '-.50', '+1.00', '1,00', '1e3', '0.01', '-0.01', '-1.00', '12345678901234567.99',
  '123456789012345678.99', '1234567890123456789.00', ' 1.00', '1.00 ', '١.٠٠', 10.5, 10, 'Infinity', 'NaN', '100.00', '60.00', '40.00', '99.99', '-0.50'];
const DIA = ['2026-02-30', '2026-02-28', '2024-02-29', '2023-02-29', '2100-02-29', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '2026-1-1', '26-10-01',
  '2026-10-01T00:00:00', '2026-10-01 ', '0000-00-00', '9999-12-31', '0001-01-01', '2026-04-31', '2026-10-04', '2026-10-05', '2026-10-06', '2026-09-30', '2026-10-01'];
const INSTANTE = ['2026-10-02T06:00:00', '2026-10-02T06:00', '2026-10-02T06:00:00Z', '2026-10-02 06:00:00', '2026-10-02T24:00:00', '2026-10-02T06:60:00', '2026-10-02T06:00:60',
  '2026-02-30T06:00:00', '2026-10-02T05:00:00', '2026-10-02T06:00:01', '2026-10-05T06:00:00', '2026-10-06T06:00:00', '2026-10-04T06:00:00', '2026-10-02T06:00:00.000',
  '2026-10-02T6:00:00', '2026-10-02t06:00:00', '2026-10-05T00:00:00', '2026-10-05T05:59:59', '2026-10-03T06:00:00'];
const PERCENTUAL = ['0', '100', '100.00', '100.01', '101', '1000', '35.5', '35.50', '35.555', '035', '-1', '', 'abc', '3.', '.5', '35,5', 35, '0.00', '00.50', '99.99', '30', '7.05', '100.0'];
const CHAVE = ['', 'a', rep('a', 64), rep('a', 65), ' k', 'k ', 'k k', 'k\n', 'ç', `${rep('a', 63)} `, ' k', 12, 'chave-1', 'chave-2', '﻿k'];
const TEXTO = ['', ' ', ' ', '​', 'a', rep('a', 200), rep('a', 201), rep('a', 500), rep('a', 501), rep('a', 2000), rep('a', 2001), '  x  ', 'é', '\n', 'a\u0000b', rep('é', 500), rep('😀', 250), rep('😀', 251)];
const ID = ['7', '007', '0', '1e3', '2147483647', '2147483648', '99999999999', '12345678901', '-1', ' 1', '1 ', '', '١٢', '1.0', '+1', '10', '9999999999', '0x10', '1_0', 'abc', 7, null];
const ENUM = ['bonus', 'outro', 'desconto', 'loan', 'advance', 'segunda', 'terca', 'sabado', 'keep', 'next-business-day', 'weekday', 'monthdays', 'none', 'BONUS', '', 7];
const DIAS = [[5], [5, 5], [], [0], [32], [1, 31], [5.5], [5.0], ['5'], [-1], [20, 5, 15], [5, null], 5, null, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]];
const ID_ABERTURA = ['abc', '', 'a', rep('a', 64), rep('a', 65), ' x', 'x y', '7', 'ç', '\n', '00000000-0000-0000-0000-000000000000'];

const NOME_PARA_POOL = {
  amount: DINHEIRO, remaining: DINHEIRO, remainingBalance: DINHEIRO, paidOn: DIA, date: DIA, originalDeliveryOn: DIA, settledThrough: INSTANTE, migrationCut: INSTANTE,
  rate: PERCENTUAL, operationKey: CHAVE, reason: TEXTO, sheetRef: TEXTO, description: TEXTO, remainingBalanceNote: TEXTO, tarotId: ID, kind: ENUM, weekday: ENUM,
  weekendPolicy: ENUM, days: DIAS,
};

const corpoAbertura = () => ({
  tarotId: '7', lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00', remainingBalance: '50.00',
  remainingBalanceNote: 'nota', migrationCut: '2026-10-05T06:00:00', rate: '30',
  openAdjustments: [{ kind: 'bonus', amount: '10.00', description: 'bônus', date: '2026-10-03' }],
  debts: [{ kind: 'loan', remaining: '100.00', originalDeliveryOn: '2026-09-20', sheetRef: 'E5', installments: [{ date: '2026-10-10', amount: '60.00' }, { date: '2026-11-10', amount: '40.00' }] }],
  differences: [{ description: 'dif', amount: '1.25' }], operationKey: 'abre-1',
});

const BASES = {
  commission: () => ({ rate: '35', reason: 'ajuste', operationKey: 'k1' }),
  schedule_weekday: () => ({ schedule: { kind: 'weekday', weekday: 'sexta' }, reason: 'x', operationKey: 'k1' }),
  schedule_monthdays: () => ({ schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'keep' }, operationKey: 'k1' }),
  schedule_none: () => ({ schedule: { kind: 'none' }, operationKey: 'k1' }),
  openings: corpoAbertura,
  confirm: () => ({ operationKey: 'k1' }),
  correct: () => ({ ...corpoAbertura(), reason: 'motivo' }),
  history: () => ({ reason: 'Atendimento da cliente', operationKey: 'k1' }),
};
const ROTA_DE = (base) => (base.startsWith('schedule') ? 'schedule' : base);

/** Caminhos até cada valor (folhas e objetos/listas), como listas de chaves. */
function caminhos(no, prefixo = [], saida = []) {
  if (Array.isArray(no)) no.forEach((x, i) => { saida.push([...prefixo, i]); caminhos(x, [...prefixo, i], saida); });
  else if (no && typeof no === 'object') for (const k of Object.keys(no)) { saida.push([...prefixo, k]); caminhos(no[k], [...prefixo, k], saida); }
  return saida;
}
const nomeDe = (caminho) => [...caminho].reverse().find((c) => typeof c === 'string');
function pai(raiz, caminho) {
  return caminho.slice(0, -1).reduce((no, c) => no[c], raiz);
}
function definir(corpo, caminho, valor, apagar = false) {
  const copia = JSON.parse(JSON.stringify(corpo));
  const p = pai(copia, caminho);
  const ultimo = caminho[caminho.length - 1];
  if (apagar) { if (Array.isArray(p)) p.splice(ultimo, 1); else delete p[ultimo]; } else p[ultimo] = valor;
  return copia;
}
const parametros = (rota) => (rota === 'confirm' || rota === 'correct' ? { ref: 'abertura-1' } : rota === 'openings' ? {} : rota === 'history' ? { id: '12' } : { tarotId: '7' });

function gerarCasos() {
  const casos = [];
  const vistos = new Set();
  const add = (rota, params, corpo, extra = {}) => {
    const corpoJson = corpo && corpo.__bruto ? corpo.__bruto : JSON.stringify(corpo);
    const chave = JSON.stringify([rota, params, corpoJson, extra]);
    if (vistos.has(chave)) return;
    vistos.add(chave);
    casos.push({ rota, params, corpoJson, ...extra });
  };
  const sorteio = prng(20261029);
  const escolher = (lista) => lista[Math.floor(sorteio() * lista.length)];

  for (const [nomeBase, fabrica] of Object.entries(BASES)) {
    const rota = ROTA_DE(nomeBase);
    const base = fabrica();
    const extra = rota === 'history' ? { papel: 'supervisora', sessao: 'sessao-1', existe: true } : {};
    add(rota, parametros(rota), base, extra);
    for (const lixo of [null, [], 'x', 0, true, {}, [{}], '{"a":1}']) add(rota, parametros(rota), lixo, extra);
    add(rota, parametros(rota), { __bruto: '{"operationKey":"k1","__proto__":{"x":1}}' }, extra);
    add(rota, parametros(rota), { __bruto: '{"operationKey":"k1","constructor":1}' }, extra);
    const todos = caminhos(base);
    // O fuzz do corpo de abertura é grande; na correção, que repete os mesmos campos, usa-se uma de cada três mutações.
    const passo = rota === 'correct' ? 3 : 1;
    let contador = 0;
    for (const caminho of todos) {
      add(rota, parametros(rota), definir(base, caminho, undefined, true), extra);
      const pool = [...GENERICO, ...(NOME_PARA_POOL[nomeDe(caminho)] || [])];
      for (const valor of pool) if ((contador += 1) % passo === 0) add(rota, parametros(rota), definir(base, caminho, valor), extra);
      const alvo = caminho.reduce((no, c) => no[c], base);
      if (alvo && typeof alvo === 'object' && !Array.isArray(alvo)) add(rota, parametros(rota), definir(base, [...caminho, 'extra'], 1), extra);
    }
    add(rota, parametros(rota), { ...base, extra: 1 }, extra);
    // Combinações sorteadas de 2 a 3 mutações.
    for (let n = 0; n < (rota === 'openings' || rota === 'correct' ? 140 : 40); n += 1) {
      let corpo = base;
      for (let k = 0; k < 2 + Math.floor(sorteio() * 2); k += 1) {
        const caminho = escolher(todos);
        const pool = [...GENERICO, ...(NOME_PARA_POOL[nomeDe(caminho)] || [])];
        try { corpo = definir(corpo, caminho, escolher(pool)); } catch { /* caminho deixou de existir após outra mutação */ }
      }
      add(rota, parametros(rota), corpo, extra);
    }
    // Segmentos da rota com o corpo válido.
    if (rota === 'commission' || rota === 'schedule') for (const id of ID) add(rota, { tarotId: id }, base);
    if (rota === 'confirm' || rota === 'correct') for (const id of ID_ABERTURA) add(rota, { ref: id }, base);
    if (rota === 'history') for (const id of ID) add(rota, { id }, base, extra);
    if (rota === 'history') {
      for (const papel of ['administradora', 'supervisora']) for (const existe of [true, false]) add(rota, { id: '12' }, base, { papel, sessao: 'sessao-1', existe });
      for (const sessao of [undefined, null, '', 'x']) add(rota, { id: '12' }, base, { papel: 'supervisora', sessao: sessao === undefined ? null : sessao, existe: true });
    }
  }
  // Orçamentos de parcelas e do corte que só a regra conjunta pega.
  const ab = corpoAbertura();
  const variar = (fn) => { const c = JSON.parse(JSON.stringify(ab)); fn(c); return c; };
  for (const c of [
    variar((x) => { x.debts[0].installments[1].amount = '39.99'; }), variar((x) => { x.debts[0].installments[1].amount = '40.01'; }),
    variar((x) => { x.debts[0].installments = []; }), variar((x) => { x.debts[0].installments[0].date = '2026-10-04'; }),
    variar((x) => { x.debts[0].installments[0].date = '2026-10-05'; }), variar((x) => { x.settledThrough = '2026-10-05T06:00:00'; }),
    variar((x) => { x.settledThrough = '2026-10-04T06:00:00'; x.migrationCut = '2026-10-04T06:00:01'; }), variar((x) => { x.debts = []; x.openAdjustments = []; x.differences = []; }),
    variar((x) => { x.debts.push(JSON.parse(JSON.stringify(x.debts[0]))); }), variar((x) => { x.debts[0].remaining = '100.001'; }),
    variar((x) => { x.debts[0].installments = [{ date: '2026-10-10', amount: '100.00' }, { date: '2026-10-10', amount: '0.00' }]; }),
    variar((x) => { x.debts[0].installments = [{ date: '2026-10-10', amount: '150.00' }, { date: '2026-10-11', amount: '-50.00' }]; }),
    variar((x) => { delete x.remainingBalanceNote; delete x.debts[0].originalDeliveryOn; delete x.differences[0].amount; }),
    variar((x) => { x.remainingBalanceNote = null; x.debts[0].originalDeliveryOn = null; x.differences[0].amount = null; }),
    variar((x) => { x.lastPayment.amount = '0.00'; }), variar((x) => { x.lastPayment.amount = '-0.01'; }),
  ]) { add('openings', {}, c); add('correct', { ref: 'abertura-1' }, { ...c, reason: 'motivo' }); }
  return casos;
}

module.exports = { gerarCasos };
