'use strict';

/** Compara os portes (`orientacao-financeira.js`, `nota-cliente.js`, `texto-formatado.js`) com o ouro do código do front. Devolve `{ ok, falhas }`. */

const fs = require('fs');
const path = require('path');
const orient = require('../../src/gestao-fadas/_comum/dominio/orientacao-financeira');
const nota = require('../../src/gestao-fadas/_comum/dominio/nota-cliente');
const fmt = require('../../src/gestao-fadas/_comum/dominio/texto-formatado');

const clonar = (x) => JSON.parse(JSON.stringify(x));
const estavel = (v) => {
  if (Array.isArray(v)) return `[${v.map(estavel).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${estavel(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
};
const igual = (a, b) => estavel(a) === estavel(b);

function verificar(arquivo = path.join(__dirname, 'ouro-ficha-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else if (falhas.length < 30) falhas.push(`${nome} ${detalhe}`); };
  ouro.orient.forEach((c, k) => {
    let r; let erro = null;
    try { r = orient.decidir(c.atual ? clonar(c.atual) : undefined, clonar(c.comando), c.papel, c.ator, c.em, c.id, c.esperada); } catch (e) { erro = e.message; }
    marcar(`orientação #${k} ${c.papel} ${c.comando.action}`, erro === c.erro && igual(r, c.resultado), `servidor=${erro || 'ok'} front=${c.erro || 'ok'}`);
    // O que o front aceita, o pedido montado pela tela também passa por `aplicar` (um evento novo no fim) e dá o mesmo registro, no relógio do servidor.
    if (c.resultado && c.resultado !== c.atual && !(c.atual && c.atual.history.some((e) => e.id === c.id))) {
      try {
        const s = orient.aplicar(c.atual ? clonar(c.atual) : null, clonar(c.resultado), { nome: c.ator, papel: c.papel }, c.em);
        marcar(`aplicar #${k}`, igual(s, c.resultado));
      } catch (e) { marcar(`aplicar #${k}`, false, e.message); }
    }
  });
  ouro.formas.forEach((f, k) => marcar(`forma #${k}`, orient.valida(f.valor) === f.valida));
  ouro.notas.forEach((c, k) => {
    let r; let erro = null;
    try {
      if (c.tipo === 'criar') r = nota.criar({ id: 'n1', clientId: '900013', text: c.text, ...(c.formatting ? { formatting: c.formatting } : {}) }, { nome: 'Khloe', papel: 'atendente' }, ouro.agora);
      else r = nota.editar(clonar(c.atual), { id: c.atual.id, clientId: c.atual.clientId, text: c.text, ...(c.formatting ? { formatting: c.formatting } : {}) }, { nome: 'Clara', papel: c.role }, ouro.agora);
    } catch (e) { erro = e.message; }
    marcar(`nota ${c.tipo} #${k}`, erro === c.erro && igual(r, c.resultado), `servidor=${erro || JSON.stringify(r).slice(0, 80)} front=${c.erro || 'ok'}`);
  });
  ouro.normal.forEach((c, k) => marcar(`formatação #${k}`, igual(fmt.normalizar(c.text, c.formatting), c.saida)));
  // Mutantes: o que o front nunca produz é recusado.
  const base = orient.decidir(undefined, { action: 'request', reason: 'Peço decisão.' }, 'atendente', 'Khloe', '2026-10-30T15:00:00.000Z', 'ev-1');
  const recusa = (nome, fn) => { try { fn(); marcar(`mutante ${nome}`, false, 'aceito'); } catch (e) { marcar(`mutante ${nome}`, e instanceof orient.OrientacaoInvalidaError, e.message); } };
  const ator = { nome: 'Clara', papel: 'supervisora' }; const agora = '2026-10-31T10:00:00.000Z';
  const dec = orient.decidir(base, { action: 'release', reason: 'Liberada.' }, 'supervisora', 'Clara', agora, 'ev-2');
  recusa('histórico apagado', () => orient.aplicar(base, { ...dec, history: [dec.history[1]] }, ator, agora));
  recusa('dois eventos', () => orient.aplicar(base, { ...dec, history: [...dec.history, { ...dec.history[1], id: 'ev-3' }] }, ator, agora));
  recusa('evento antigo trocado', () => orient.aplicar(base, { ...dec, history: [{ ...dec.history[0], reason: 'Outra coisa.' }, dec.history[1]] }, ator, agora));
  recusa('atendente decide', () => orient.aplicar(base, dec, { nome: 'Khloe', papel: 'atendente' }, agora));
  recusa('taróloga', () => orient.aplicar(null, base, { nome: 'Osíris', papel: 'tarologa' }, agora));
  recusa('forma ruim', () => orient.aplicar(null, { ...base, revision: 0 }, ator, agora));
  const recusaNota = (nome, fn) => { try { fn(); marcar(`mutante ${nome}`, false, 'aceito'); } catch (e) { marcar(`mutante ${nome}`, e instanceof nota.NotaInvalidaError, e.message); } };
  recusaNota('nota sem id', () => nota.forma({ clientId: '900013', text: 'x' }));
  recusaNota('nota de outra cliente', () => nota.editar({ id: 'n1', clientId: '900013', text: 'a', author: 'K', createdAt: agora }, { id: 'n1', clientId: '900014', text: 'b' }, ator, agora));
  return { ok, falhas };
}

module.exports = { verificar };
