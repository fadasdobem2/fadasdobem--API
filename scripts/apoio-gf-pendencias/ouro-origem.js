'use strict';

/** Compara a DERIVAÇÃO das Pendências no servidor (`pendencias-origem.js`) com o ouro do código do front. Devolve `{ ok, falhas }`. */

const fs = require('fs');
const path = require('path');
const dom = require('../../src/gestao-fadas/_comum/dominio/pendencias');
const org = require('../../src/gestao-fadas/_comum/dominio/pendencias-origem');

const clonar = (x) => JSON.parse(JSON.stringify(x));
const AGORA = '2026-10-12T17:00:00.000Z';
const ATOR = { id: 'u1', nome: 'Laya', papel: 'administradora' };

function verificar(arquivo = path.join(__dirname, 'ouro-origem-front.json')) {
  const ouro = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const falhas = []; let ok = 0;
  const marcar = (nome, bom, detalhe = '') => { if (bom) ok += 1; else falhas.push(`${nome} ${detalhe}`.slice(0, 300)); };
  const lanca = (nome, fn, classe) => { try { fn(); marcar(nome, false, 'aceito'); } catch (e) { marcar(nome, e.name === classe, `${e.name}: ${e.message}`); } };
  ouro.casos.forEach((c, k) => {
    const hoje = ouro.dia;
    const o = org.derivar(clonar(c.entrada), { hoje, registros: clonar(c.registros) });
    marcar(`datas #${k}`, JSON.stringify(org.datasDeBusca({ hoje, registros: c.registros, agenda: c.entrada.agenda })) === JSON.stringify(c.datas));
    const chavesFront = c.fontes.map(([key]) => key).sort();
    const chavesServidor = [...o.fontes.keys()].sort();
    marcar(`chaves das fontes #${k}`, JSON.stringify(chavesFront) === JSON.stringify(chavesServidor), `${chavesFront.length} x ${chavesServidor.length}`);
    for (const [key, snap] of c.fontes) {
      const lista = o.fontes.get(key) || [];
      marcar(`snapshot ${key} #${k}`, lista.length > 0 && dom.igual(lista[lista.length - 1], snap), JSON.stringify(lista.at(-1)) + ' x ' + JSON.stringify(snap));
    }
    marcar(`origens #${k}`, JSON.stringify([...o.origens].sort()) === JSON.stringify(c.origens));
    // Resolvida e reaberta: o que o front faz, o servidor aceita; o que o front não faz, recusa.
    const porChave = Object.fromEntries(c.registros.map((r) => [r.key, r]));
    for (const r of c.registros) {
      if (!org.derivavel(r.snapshot)) continue;
      const depois = c.reconciliado[r.key];
      const eventoNovo = depois.events.length > r.events.length;
      const acao = eventoNovo ? depois.events.at(-1).action : null;
      const resolvida = c.resolvidas.includes(r.key); const reaberta = c.reabertas.includes(r.key);
      const tentar = (pedido) => { const saida = dom.aplicar(clonar(r), clonar(pedido), ATOR, AGORA); return org.conferirOrigem(clonar(r), clonar(pedido), saida, o); };
      if (resolvida || reaberta) {
        try { const s = tentar(depois); marcar(`${acao} aceita ${r.key} #${k}`, s.events.at(-1).action === acao && Boolean(s.resolvedAt) === resolvida); } catch (e) { marcar(`${acao} aceita ${r.key} #${k}`, false, e.message); }
      } else {
        // Sem evento do Sistema: o front deixou como estava. Resolver à força ou reabrir à força é recusado.
        const forca = clonar(r);
        if (!r.resolvedAt) forca.resolvedAt = '2026-10-12T16:00:00.000Z';
        if (!r.resolvedAt) { forca.events.push({ at: AGORA, actor: { id: 'system', name: 'Sistema', role: 'administradora' }, action: 'resolved', from: r.queue, to: r.queue, reason: dom.MOTIVO_RESOLVIDA }); lanca(`resolver à força ${r.key} #${k}`, () => tentar(forca), 'PendenciaMudouError'); }
        else { const fila = dom.filaInicial(r.snapshot); const reab = clonar(r); delete reab.resolvedAt; reab.queue = fila; reab.events.push({ at: AGORA, actor: { id: 'system', name: 'Sistema', role: 'administradora' }, action: 'reopened', from: r.queue, to: fila, reason: dom.MOTIVO_REABERTA }); lanca(`reabrir à força ${r.key} #${k}`, () => tentar(reab), 'PendenciaMudouError'); }
      }
    }
    // Encaminhar: o front aceita, o servidor também; snapshot adulterado ou pendência que não existe é recusado.
    for (const e of c.encaminhadas) {
      const antes = e.antes ? clonar(e.antes) : null;
      const pedido = clonar(e.depois);
      try { const saida = dom.aplicar(antes, clonar(pedido), { id: 'u1', nome: 'Khloe', papel: 'atendente' }, AGORA); org.conferirOrigem(antes, pedido, saida, o); marcar(`encaminhar aceita ${pedido.key} #${k}`, true); } catch (err) { marcar(`encaminhar aceita ${pedido.key} #${k}`, false, err.message); }
      if (org.derivavel(e.snapshot)) {
        const ruim = clonar(pedido); ruim.snapshot.detail = `${ruim.snapshot.detail} (adulterado)`;
        lanca(`encaminhar adulterado ${pedido.key} #${k}`, () => { const s = dom.aplicar(clonar(antes), clonar(ruim), { id: 'u1', nome: 'Khloe', papel: 'atendente' }, AGORA); org.conferirOrigem(antes, ruim, s, o); }, 'PendenciaMudouError');
      }
    }
    // Pendência derivada que não existe em lugar nenhum: nenhum encaminhamento a cria.
    const fantasma = { id: 'finish:inexistente', occurrence: 'x', financial: false, tone: 'finish', title: 'T', who: 'W', detail: 'D' };
    const pf = { key: dom.chaveDe(fantasma), snapshot: fantasma, queue: 'supervisao', events: [{ at: AGORA, actor: { id: 'u', name: 'K', role: 'atendente' }, action: 'forward', from: 'atendimento', to: 'supervisao', reason: 'Conferir.' }] };
    lanca(`fantasma #${k}`, () => { const s = dom.aplicar(null, clonar(pf), { id: 'u1', nome: 'Khloe', papel: 'atendente' }, AGORA); org.conferirOrigem(null, pf, s, o); }, 'PendenciaMudouError');
    void porChave;
  });
  return { ok, falhas };
}

module.exports = { verificar };
