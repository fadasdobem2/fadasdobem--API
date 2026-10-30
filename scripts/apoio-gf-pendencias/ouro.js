'use strict';

/** Compara o porte (`_comum/dominio/pendencias.js`) com o ouro do código do front. Devolve `{ ok, falhas }`. */

const fs = require('fs');
const path = require('path');
const dom = require('../../src/gestao-fadas/_comum/dominio/pendencias');

const clonar = (x) => JSON.parse(JSON.stringify(x));
const AGORA = '2026-10-31T12:00:00.000Z';

function verificar(arquivo = path.join(__dirname, 'ouro-pendencias-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`); };
  ouro.chaves.forEach((c, k) => {
    marcar(`chave #${k}`, dom.chaveDe(c.snapshot) === c.key);
    marcar(`fila inicial #${k}`, dom.filaInicial(c.snapshot) === c.fila);
    for (const [papel, v] of Object.entries(c.visivel)) marcar(`visível ${papel} #${k}`, dom.visivel(papel, c.snapshot) === v);
  });
  ouro.encaminhar.forEach((c, k) => {
    marcar(`pode ${c.papel} ${c.de}>${c.para} #${k}`, dom.podeEncaminhar(c.papel, c.de, c.para, c.snapshot.financial, c.snapshot.tone) === c.pode);
    const ator = { id: 'u1', nome: 'Fulana', papel: c.papel };
    const pedido = c.resultado;
    if (pedido) {
      // O que o front aceita, o servidor aceita e carimba igual (mesmo ator, motivo aparado, instante do servidor).
      try {
        const saida = dom.aplicar(clonar(c.antes), clonar(pedido), ator, AGORA);
        const e = saida.events.at(-1);
        marcar(`aceita ${c.papel} ${c.de}>${c.para} #${k}`, saida.queue === pedido.queue && e.reason === pedido.events.at(-1).reason && e.action === pedido.events.at(-1).action && e.actor.role === c.papel && e.at === AGORA);
      } catch (e) { marcar(`aceita ${c.papel} ${c.de}>${c.para} #${k}`, false, e.message); }
      // Mutantes: o que o front nunca produz.
      const recusa = (nome, mut, antes = c.antes) => { try { dom.aplicar(clonar(antes), mut, ator, AGORA); marcar(`mutante ${nome} #${k}`, false, 'aceito'); } catch (e) { marcar(`mutante ${nome} #${k}`, e instanceof dom.PendenciaInvalidaError, e.message); } };
      const m1 = clonar(pedido); m1.queue = c.de === 'atendimento' ? 'administracao' : 'atendimento'; if (m1.queue !== pedido.queue) recusa('fila trocada', m1);
      const m2 = clonar(pedido); m2.events = []; m2.queue = m2.queue; if (c.antes.queue !== pedido.queue) recusa('fila sem evento', m2);
      const m3 = clonar(pedido); m3.events.push({ ...m3.events[0] }); recusa('dois eventos', m3);
      const m4 = clonar(pedido); m4.events[0].reason = '   '; recusa('motivo vazio', m4);
      const m5 = clonar(pedido); m5.events[0].reason = 'x'.repeat(1001); recusa('motivo longo', m5);
    } else {
      // O que o front recusa o servidor também recusa (monta o registro que a tela montaria, se pudesse).
      const novo = { key: c.antes.key, snapshot: c.snapshot, queue: c.para, events: [{ at: AGORA, actor: { id: 'u1', name: 'Fulana', role: c.papel }, action: c.para === 'supervisao' || c.para === 'administracao' ? 'forward' : 'return', from: c.de, to: c.para, reason: 'Conferir isto.' }] };
      if (c.para !== c.de) { try { dom.aplicar(clonar(c.antes), novo, { id: 'u1', nome: 'Fulana', papel: c.papel }, AGORA); marcar(`recusa ${c.papel} ${c.de}>${c.para} #${k}`, false, 'aceito'); } catch (e) { marcar(`recusa ${c.papel} ${c.de}>${c.para} #${k}`, e instanceof dom.PendenciaInvalidaError, e.message); } }
    }
  });
  ouro.reconciliar.forEach((c, k) => {
    const ator = { id: 'u1', nome: 'Fulana', papel: 'administradora' };
    try {
      const resolvida = dom.aplicar(clonar(c.antes), clonar(c.resolvida), ator, AGORA);
      marcar(`resolve #${k}`, Boolean(resolvida.resolvedAt) && resolvida.queue === c.resolvida.queue && resolvida.events.at(-1).action === 'resolved' && resolvida.events.at(-1).reason === c.resolvida.events.at(-1).reason);
      const pedidoReabrir = { ...clonar(c.reaberta), events: [...clonar(resolvida.events), clonar(c.reaberta.events.at(-1))] };
      const reaberta = dom.aplicar(resolvida, pedidoReabrir, ator, AGORA);
      marcar(`reabre #${k}`, !reaberta.resolvedAt && reaberta.queue === c.reaberta.queue && reaberta.events.at(-1).action === 'reopened' && reaberta.events.at(-1).reason === c.reaberta.events.at(-1).reason);
    } catch (e) { marcar(`reconcilia #${k}`, false, e.message); }
    if (c.semente) { try { dom.aplicar(null, clonar(c.semente), ator, AGORA); marcar(`semente #${k}`, true); } catch (e) { marcar(`semente #${k}`, false, e.message); } }
    try { dom.aplicar(clonar(c.antes), { ...clonar(c.resolvida), queue: 'atendimento', events: c.resolvida.events.map((e) => ({ ...e, to: 'atendimento' })) }, ator, AGORA); marcar(`resolução com fila trocada #${k}`, c.antes.queue === 'atendimento', 'aceito'); } catch (e) { marcar(`resolução com fila trocada #${k}`, e instanceof dom.PendenciaInvalidaError); }
  });
  return { ok, falhas };
}

module.exports = { verificar };
if (require.main === module) { const r = verificar(); console.log(JSON.stringify({ ok: r.ok, falhas: r.falhas.slice(0, 20) }, null, 1)); }
