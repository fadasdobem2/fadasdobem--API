'use strict';

/** Confere `consulta-conferencia.js` e `consulta-conferencia-avaliacao.js` contra o ouro (`ouro-regras-conferencia-front.json`). Devolve `{ ok, falhas, resumo }`. */

const fs = require('fs');
const path = require('path');
const conf = require('../../../src/gestao-fadas/_comum/dominio/consulta-conferencia');
const aval = require('../../../src/gestao-fadas/_comum/dominio/consulta-conferencia-avaliacao');
const { estavel } = require('../../../src/gestao-fadas/features/financeiro-cliente/fin.comum');
const { jsonIgual } = require('./comparar');

function verificar(arquivo = path.join(__dirname, '..', 'ouro-regras-conferencia-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0; const resumo = { aceitas: 0, recusas: {} };
  ouro.casos.forEach((c, k) => {
    const cen = ouro.cenarios[c.c];
    const item = () => JSON.parse(JSON.stringify(c.item));
    const fin = () => ({ payments: cen.pagamentos, consultations: cen.consultas.map((x) => (x.id === 'K1' ? item() : x)), profile: cen.perfil });
    const a = c.args; let feito;
    try {
      switch (c.t) {
        case 'aprovar': { const f = fin(); feito = { ok: conf.aprovarEncerramento(f.consultations.find((x) => x.id === 'K1'), a.versao, a.ator, a.em, f) }; break; }
        case 'fluxo-aprovar': { const f = fin(); const it = f.consultations.find((x) => x.id === 'K1'); const cand = aval.comBeneficiosDaConferencia(it, a.selecao, f, a.ator, a.em); const av = aval.avaliarConferencia(cand, f, a.em); if (av.error) throw new Error(av.error); feito = { ok: conf.aprovarEncerramento(cand, a.versao, a.ator, a.em, f) }; break; }
        case 'aprovar-sem-saldo': feito = { ok: conf.aprovarEncerramento(item(), a.versao, a.ator, a.em, undefined) }; break;
        case 'decisao': feito = { ok: conf.decidirRevisaoFinanceira(item(), a.status, a.ator, a.nota, a.em, a.versao, fin()) }; break;
        case 'rejeitar': feito = { ok: conf.rejeitarCorrecao(item(), a.versao, a.ator, a.motivo, a.em) }; break;
        case 'avaliacao': { const r = aval.avaliarConferencia(item(), fin(), a.em); feito = { ok: { error: r.error, mustReview: r.precisaConferir, extra: r.extra, early: r.early, minutes: r.minutes } }; break; }
        case 'beneficios': feito = { ok: aval.comBeneficiosDaConferencia(item(), a.selecao, fin(), a.ator, a.em) }; break;
        default: throw new Error(`tipo ${c.t}`);
      }
    } catch (e) { feito = { erro: e.message }; }
    const nome = `${c.t} #${k} (${cen.nome}, ${c.item.status})`;
    if (c.r.ok !== undefined) {
      const bom = feito.ok !== undefined && jsonIgual(feito.ok, c.r.ok);
      if (bom) { ok += 1; resumo.aceitas += 1; } else falhas.push(`${nome}: ${feito.erro || 'resultado diferente'}`.slice(0, 300));
    } else if (feito.erro === c.r.erro) { ok += 1; resumo.recusas[c.r.erro] = (resumo.recusas[c.r.erro] || 0) + 1; } else falhas.push(`${nome}: recusa ${feito.erro || 'aceitou'} x ${c.r.erro}`.slice(0, 300));
  });
  return { ok, falhas, resumo };
}

module.exports = { verificar, estavel };
