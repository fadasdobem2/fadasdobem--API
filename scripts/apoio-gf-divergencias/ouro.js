'use strict';

/** Compara o porte (`_comum/dominio/divergencias.js`) com o ouro do código do front. Devolve `{ ok, falhas }`. */

const fs = require('fs');
const path = require('path');
const dom = require('../../src/gestao-fadas/_comum/dominio/divergencias');

const CLASSE = { edit: ['edicao', 'arquivo'], archive: ['arquivo'], delete: ['exclusao'], comment: ['comentario'], restore: ['restauracao', 'desarquivar'], trash: ['lixeira'] };
const clonar = (x) => JSON.parse(JSON.stringify(x));

function verificar(arquivo = path.join(__dirname, 'ouro-divergencias-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`); };
  const tarologa = { tarologa: true, proprio: ouro.tarotId, p: {} };
  const equipe = { tarologa: false, proprio: '', p: { canViewDivergences: true, canViewFinancialDivergences: true } };
  ouro.casos.forEach((c, k) => {
    let classe = '';
    try { dom.forma(c.antes); dom.forma(c.depois); classe = dom.conferirTransicao(c.antes, c.depois, tarologa); } catch (e) { marcar(`aceita ${c.mudanca} #${k}`, false, e.message); return; }
    marcar(`classe ${c.mudanca} #${k}`, CLASSE[c.mudanca].includes(classe), `${classe}`);
    const sel = dom.carimbar(c.antes, c.depois, 'Osíris', '2026-10-21T00:00:00.000Z');
    marcar(`carimbo ${c.mudanca} #${k}`, sel.status === c.depois.status && sel.reason === c.depois.reason && (sel.history || []).length === (c.depois.history || []).length);
    // Mutantes: o que o front nunca produz tem de ser recusado.
    const recusa = (nome, mut) => { try { dom.conferirTransicao(c.antes, mut, tarologa); marcar(`mutante ${nome} #${k}`, false, 'aceito'); } catch (e) { marcar(`mutante ${nome} #${k}`, e instanceof dom.DivergenciaInvalidaError, e.message); } };
    const m1 = clonar(c.depois); m1.clientId = '1'; recusa('troca de cliente', m1);
    const m2 = clonar(c.depois); m2.status = 'Resolvida'; m2.resolvedBy = 'Eu'; m2.resolvedAt = c.depois.createdAt; m2.decision = 'x'; if (c.depois.status !== 'Resolvida') recusa('tarologa resolve', m2);
    if ((c.antes.history || []).length) { const m3 = clonar(c.depois); m3.history = m3.history.slice(1); recusa('histórico apagado', m3); }
    const m4 = clonar(c.depois); m4.reporterTarotId = 'outra'; if (m4.reporterTarotId !== c.depois.reporterTarotId) recusa('troca de repórter', m4);
    try { dom.conferirTransicao(c.antes, c.depois, { tarologa: true, proprio: 'outra', p: {} }); marcar(`outra taróloga #${k}`, false, 'aceito'); } catch (e) { marcar(`outra taróloga #${k}`, e instanceof dom.DivergenciaInvalidaError); }
  });
  ouro.staff.forEach((c, k) => {
    try { dom.conferirTransicao(c.antes, c.depois, equipe); marcar(`comentário da equipe #${k}`, true); } catch (e) { marcar(`comentário da equipe #${k}`, false, e.message); }
    try { dom.conferirTransicao(c.antes, c.depois, tarologa); marcar(`taróloga com nota de equipe #${k}`, false, 'aceito'); } catch (e) { marcar(`taróloga com nota de equipe #${k}`, e instanceof dom.DivergenciaInvalidaError); }
  });
  ouro.visibilidade.forEach((v, k) => {
    marcar(`visível #${k}`, dom.visivelDaTarologa(v.item, ouro.tarotId) === v.visivel);
    marcar(`dela #${k}`, dom.dela(v.item, ouro.tarotId) === v.dela);
    marcar(`aberta #${k}`, dom.aberta(v.item) === v.aberta);
    marcar(`outra #${k}`, dom.visivelDaTarologa(v.item, 'outra') === v.outra);
  });
  return { ok, falhas };
}

module.exports = { verificar };
if (require.main === module) { const r = verificar(); console.log(JSON.stringify({ ok: r.ok, falhas: r.falhas.slice(0, 20) }, null, 1)); }
