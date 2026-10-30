'use strict';

/** Confere `consulta-tarifa.js`, `consulta-maximo.js` e `consulta-edicao-cobranca.js` contra o ouro (`ouro-regras-edicao-front.json`). */

const fs = require('fs');
const path = require('path');
const tar = require('../../../src/gestao-fadas/_comum/dominio/consulta-tarifa');
const max = require('../../../src/gestao-fadas/_comum/dominio/consulta-maximo');
const cobr = require('../../../src/gestao-fadas/_comum/dominio/consulta-edicao-cobranca');
const { jsonIgual } = require('./comparar');
const { HISTORICOS } = require('./gerar-edicao');
const { ISO } = require('./fabrica');

const executar = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e.message }; } };
const clone = (x) => JSON.parse(JSON.stringify(x));
/** O servidor carimba o autor e o instante dele: o resto tem de ser igual. */
const semCarimbo = (x) => { const y = clone(x); if (y && y.billing) { delete y.billing.decidedBy; delete y.billing.decidedAt; } return y; };

function verificar(arquivo = path.join(__dirname, '..', 'ouro-regras-edicao-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0; let aceitas = 0; let recusasDoMutante = 0; const mensagens = {};
  const conta = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`.slice(0, 300)); };
  ouro.casos.forEach((c, k) => {
    const cen = ouro.cenarios[c.c]; const h = HISTORICOS[c.h || 0];
    const ctx = () => ({ consultations: clone(cen.consultas), profiles: { [cen.perfil.clientId]: cen.perfil, 900200: cen.vazio, '900200': cen.vazio }, history: h });
    const compara = (nome, esperado, feito) => {
      const bom = esperado.ok !== undefined ? feito.ok !== undefined && jsonIgual(feito.ok, esperado.ok) : feito.erro === esperado.erro;
      if (bom) { ok += 1; if (esperado.ok !== undefined) aceitas += 1; else mensagens[esperado.erro] = (mensagens[esperado.erro] || 0) + 1; } else falhas.push(`${nome} #${k}: ${feito.erro || 'resultado diferente'} x ${esperado.erro || 'aceita'}`.slice(0, 300));
    };
    if (c.t === 'tarifa') compara('tarifa', c.r, executar(() => tar.resolverTarifa(clone(c.req), ctx())));
    else if (c.t === 'nova') compara('nova', c.r, executar(() => tar.precificarNova(clone(c.item), ctx(), cen.pagamentos)));
    else if (c.t === 'complemento') compara('complemento', c.r, executar(() => tar.reprecificarComplemento(clone(c.item), clone(c.anterior), ctx(), cen.pagamentos)));
    else if (c.t === 'maximo') {
      const m = max.mapaDeMaximos(clone(cen.consultas), cen.pagamentos, { [cen.perfil.clientId]: cen.perfil });
      compara('maximo', c.r, { ok: Object.fromEntries([...m.entries()]) });
    } else if (c.t === 'cobranca') {
      if (c.r.erro) { compara('cobranca (recusa do front)', c.r, executar(() => cobr.refazerCobranca(clone(c.antes), clone(c.pedidoBase), { ...ctx(), payments: cen.pagamentos }, { em: ISO(2), ator: 'Laya', contratoMudou: c.contratoMudou, dispensa: c.dispensa }))); return; }
      // 1) o refeito é o do front (com o carimbo do navegador).
      const pedidoBase = clone(c.pedidoBase); pedidoBase.billing = { ...(c.r.ok.billing || {}), minimumWaived: Boolean(c.r.ok.billing && c.r.ok.billing.minimumWaived) };
      const contexto = { ...ctx(), payments: cen.pagamentos };
      const feito = executar(() => cobr.refazerCobranca(clone(c.antes), { ...pedidoBase, billing: c.r.ok.billing }, contexto, { em: ISO(2), ator: 'Laya', contratoMudou: c.contratoMudou }));
      compara('cobranca', { ok: semCarimbo(c.r.ok) }, feito.ok ? { ok: semCarimbo(feito.ok) } : feito);
      // 2) o servidor aceita o registro do front e grava o dele (instante do servidor).
      const pedido = { ...clone(c.pedidoBase), ...clone(c.r.ok), updatedAt: ISO(2) };
      const aceito = executar(() => cobr.conferirECorrigir(clone(c.antes), pedido, contexto, { em: ISO(3), ator: 'Servidor' }));
      conta(`cobranca aceita #${k}`, aceito.ok && jsonIgual(semCarimbo(aceito.ok), semCarimbo(c.r.ok)) && aceito.ok.billing.decidedAt === ISO(3), aceito.erro || 'diferente');
      // 3) mutante: o navegador mexe no valor do minuto ou na tarifa, e o servidor recusa.
      const ruim = clone(pedido); ruim.minuteValue = (ruim.minuteValue || 2.96) + 0.5;
      const recusado = executar(() => cobr.conferirECorrigir(clone(c.antes), ruim, contexto, { em: ISO(3), ator: 'Servidor' }));
      conta(`cobranca mutante #${k}`, recusado.erro === cobr.MENSAGEM, recusado.erro || 'aceitou'); if (recusado.erro) recusasDoMutante += 1;
    }
  });
  return { ok, falhas, aceitas, recusasDoMutante, mensagens };
}

module.exports = { verificar };
