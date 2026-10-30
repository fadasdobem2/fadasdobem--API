'use strict';

/**
 * Verificador OFFLINE do fluxo do painel no servidor (Maturacao/39): roda o domínio portado (`painel-*.js`) sobre as entradas do OURO gerado do
 * código REAL do front (`gerar-ouro-gf-painel-fluxo.js`, `Date.now` travado) e exige o mesmo resultado: `freeNow` e demais campos da equipe,
 * listas da fila geral, tempo/grupo de cada item e as validações (encaminhar, lançar, agendar) com as MESMAS frases. Mais os mutantes:
 * o servidor tem de RECUSAR o que o front recusaria. Sem banco, sem relógio do sistema (o `now` vem do caso).
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { fluxoDoPainel } = require('../src/gestao-fadas/_comum/dominio/painel-fluxo');
const q = require('../src/gestao-fadas/_comum/dominio/painel-fila-geral');
const k = require('../src/gestao-fadas/_comum/dominio/painel-continuacao');
const v = require('../src/gestao-fadas/_comum/dominio/painel-validacao');
const { MUTANTES } = require('./apoio-gf-painel/mutantes-fluxo');
const { resumoDoFluxo } = require('./apoio-gf-painel/resumo-fluxo');

const originalNow = Date.now;
Date.now = () => { throw new Error('Date.now() chamado dentro da regra: o relógio tem de ser injetado'); };

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-fluxo.json'), 'utf8'));
const ids = (l) => (l || []).map((x) => x.id);
const tentar = (fn) => { try { fn(); return { ok: true }; } catch (e) { return { erro: e.message }; } };
let falhas = 0; const mostrar = (m) => { falhas += 1; if (falhas <= 12) console.error(m); };
const comparar = (rotulo, esperado, obtido) => { try { assert.deepStrictEqual(obtido, esperado); } catch (_e) { mostrar(`${rotulo}\n  esperado ${JSON.stringify(esperado)}\n  obtido   ${JSON.stringify(obtido)}`); } };

let mutantes = 0; let mutantesRecusados = 0; let validacoes = 0; let recusas = 0; let livres = 0;
ouro.casos.forEach((caso, n) => {
  const e = caso.entrada; const rot = (s) => `caso ${n} ${s}`;
  const f = fluxoDoPainel(e);
  comparar(rot('fluxo'), caso.fluxo, JSON.parse(JSON.stringify(resumoDoFluxo(f))));
  comparar(rot('continuacoes'), caso.continuacoes, k.reservasDeContinuacao({ agenda: e.agenda, consultations: e.consultations, now: e.now }).map((r) => [r.source.tarotId, r.source.id, r.item.id]).sort());
  comparar(rot('tempos'), caso.tempos, e.agenda.map((a) => { const t = q.temporizacao(a, e.date, e.now); return { id: a.id, requestedAt: t.requestedAt, enteredAt: t.enteredAt, future: t.future, waitingWindow: t.waitingWindow, active: t.active, status: t.status, waitMs: t.waitMs, label: t.label, grupo: q.grupo(a, e.date, e.now) }; }));
  livres += f.team.filter((r) => r.freeNow).length;
  for (const m of caso.mutantes || []) {
    const mutada = MUTANTES[m.nome](e, { item: m.item, tarotId: m.tarotId });
    const obt = tentar(() => {
      if (m.tipo === 'encaminhar') v.validarEncaminhamento(mutada, m.item, m.tarotId, m.aprov || undefined);
      else if (m.tipo === 'lancar') v.validarLancamento(mutada, m.item, m.tarotId, m.aprov || undefined);
      else v.validarAgendamento(mutada, m.item, m.tarotId, m.dataAg, m.hora || undefined);
    });
    mutantes += 1; if (!m.front.ok) mutantesRecusados += 1;
    comparar(rot(`mutante ${m.nome} ${m.tipo}`), m.front.ok ? { ok: true } : { erro: m.front.erro }, obt);
  }
  for (const x of caso.validacoes) {
    const obt = {
      encaminhar: tentar(() => v.validarEncaminhamento(e, x.item, x.tarotId, x.aprov || undefined)),
      lancar: tentar(() => v.validarLancamento(e, x.item, x.tarotId, x.aprov || undefined)),
      agendar: tentar(() => v.validarAgendamento(e, x.item, x.tarotId, x.dataAg, x.hora || undefined)),
    };
    for (const nome of ['encaminhar', 'lancar', 'agendar']) {
      validacoes += 1; if (!x[nome].ok) recusas += 1;
      comparar(rot(`${nome} ${x.item}->${x.tarotId}`), x[nome].ok ? { ok: true } : { erro: x[nome].erro }, obt[nome]);
    }
  }
});

// colação pt-BR própria x ICU (só o verificador usa Intl, como referência)
{
  const { compararPtBR } = require('../src/gestao-fadas/_comum/dominio/colacao-ptbr'); const icu = new Intl.Collator('pt-BR');
  let sem = 7; const r = () => { sem = (Math.imul(sem, 1664525) + 1013904223) >>> 0; return sem / 4294967296; };
  const al = "aAáÁàâãäeEéÉêiIíoOóÔõuUúüçÇnNñbBcCdDzZ xyXY-_.'0123456789Ìì"; let ruins = 0;
  for (let k = 0; k < 100000; k += 1) { const g = () => Array.from({ length: 1 + Math.floor(r() * 6) }, () => al[Math.floor(r() * al.length)]).join(''); const a = g(); const b = r() < 0.3 ? a.toUpperCase() : g(); if (Math.sign(icu.compare(a, b)) !== compararPtBR(a, b)) ruins += 1; }
  if (ruins) mostrar(`colação pt-BR: ${ruins} divergências do ICU`);
}
Date.now = originalNow;
if (falhas) { console.error(`FALHOU: ${falhas} divergências entre o servidor e o código real do front.`); process.exit(1); }
console.log(`OK: ${ouro.casos.length} casos, ${livres} leitoras livres conferidas, ${validacoes} validações (${recusas} recusas com a frase do front) idênticas ao front; ${mutantes} mutantes (${mutantesRecusados} recusados com a frase do front) idênticos.`);
