'use strict';

/** Confere `consulta-desfechos.js` contra o ouro (`ouro-regras-desfechos-front.json`). */

const fs = require('fs');
const path = require('path');
const des = require('../../../src/gestao-fadas/_comum/dominio/consulta-desfechos');
const { jsonIgual } = require('./comparar');
const { ISO } = require('./fabrica');

const EM = ISO(0, 200);
const executar = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e.message }; } };

function verificar(arquivo = path.join(__dirname, '..', 'ouro-regras-desfechos-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; const mensagens = {}; let ok = 0; let aceitas = 0;
  ouro.casos.forEach((c, k) => {
    const cen = ouro.cenarios[c.c]; const clone = (x) => JSON.parse(JSON.stringify(x));
    const item = () => clone(c.item);
    let feito;
    switch (c.t) {
      case 'solicitar': feito = executar(() => des.solicitarRevisaoDeCancelamento(item(), c.queixa, 'Laya', EM, c.papel, c.detalhes)); break;
      case 'decidir': feito = executar(() => des.decidirRevisaoDeCancelamento(item(), c.decisao, c.motivo, 'Laya', EM, c.papel, c.msg)); break;
      case 'decidir-lista': feito = executar(() => des.decidirNaLista(cen.consultas.map((x) => (x.id === c.item.id ? item() : clone(x))), { id: c.item.id, updatedAt: c.versao }, { decision: 'unpaid', observation: 'Ok', actor: 'Laya', at: EM, role: c.papel, complaintDetails: c.detalhes }, cen.pagamentos)); break;
      case 'queixa': feito = executar(() => des.comQueixa(item(), c.detalhes, 'Laya', EM, c.papel)); break;
      case 'erro-entrada': feito = executar(() => des.validarEntradaDeErro(c.motivo, c.detalhe)); break;
      case 'validar-queixa': feito = executar(() => des.validarQueixa(clone(c.q), c.obrig)); break;
      default: throw new Error(c.t);
    }
    const esperado = c.r;
    const bom = esperado.ok !== undefined ? feito.ok !== undefined && jsonIgual(feito.ok, esperado.ok) : feito.erro === esperado.erro;
    if (bom) { ok += 1; if (esperado.ok !== undefined) aceitas += 1; else mensagens[esperado.erro] = (mensagens[esperado.erro] || 0) + 1; } else falhas.push(`${c.t} #${k}: ${feito.erro || 'aceitou'} x ${esperado.erro || 'aceita'}`.slice(0, 300));
  });
  return { ok, falhas, aceitas, mensagens };
}

module.exports = { verificar };
