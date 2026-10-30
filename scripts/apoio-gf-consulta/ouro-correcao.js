'use strict';

/**
 * Compara a CORREÇÃO DE TEMPO do servidor (`consulta-correcao.js`) com o ouro do código do front. Devolve `{ ok, falhas, naoPortados }`.
 * Bônus e complemento (`validateMinuteBenefits`, `validateComplementChanges`) entram na conferência (Maturacao/38): `naoPortados` é sempre 0.
 */

const fs = require('fs');
const path = require('path');
const corr = require('../../src/gestao-fadas/_comum/dominio/consulta-correcao');
const { estavel } = require('../../src/gestao-fadas/features/financeiro-cliente/fin.comum');

function verificar(arquivo = path.join(__dirname, 'ouro-correcao-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0; let naoPortados = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`.slice(0, 400)); };
  ouro.casos.forEach((c, k) => {
    const cen = ouro.cenarios[c.idx];
    const lista = cen.consultas.map((x) => (x.id === c.item.id ? c.item : x));
    const fin = { consultations: lista, payments: cen.pagamentos, profile: cen.perfil };
    const nota = 'Divergência D1; solicitada por Osíris: ajuste';
    let feito;
    try { feito = { ok: corr.corrigirTempo(JSON.parse(JSON.stringify(c.item)), c.minutos, nota, 'Laya', ouro.em, c.item.updatedAt, fin) }; } catch (e) { feito = { erro: e.message }; }
    if (c.resultado.ok) marcar(`correção #${k}`, Boolean(feito.ok) && estavel(feito.ok) === estavel(c.resultado.ok), feito.erro || 'resultado diferente');
    else marcar(`recusa #${k}`, feito.erro === c.resultado.erro, `${feito.erro || 'aceitou'} x ${c.resultado.erro}`);
    // Versão velha e motivo vazio: o front recusa com estas frases.
    if (c.resultado.ok) {
      try { corr.corrigirTempo(JSON.parse(JSON.stringify(c.item)), c.minutos, nota, 'Laya', ouro.em, 'outra-versao', fin); marcar(`versão velha #${k}`, false, 'aceito'); } catch (e) { marcar(`versão velha #${k}`, /foi atualizada/.test(e.message)); }
      try { corr.corrigirTempo(JSON.parse(JSON.stringify(c.item)), c.minutos, '  ', 'Laya', ouro.em, c.item.updatedAt, fin); marcar(`motivo vazio #${k}`, false, 'aceito'); } catch (e) { marcar(`motivo vazio #${k}`, /Motivo da correção/.test(e.message)); }
    }
  });
  return { ok, falhas, naoPortados };
}

module.exports = { verificar };
