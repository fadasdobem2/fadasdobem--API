'use strict';

/** Verificador OFFLINE (Maturacao/39): `painel-pagamentos.js` contra o ouro do código real do front (`gerar-ouro-gf-painel-pagamentos.js`). */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const p = require('../src/gestao-fadas/_comum/dominio/painel-pagamentos');

const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-pagamentos.json'), 'utf8'));
Date.now = () => { throw new Error('Date.now() chamado dentro da regra'); };
const json = (v) => JSON.parse(JSON.stringify(v));
let falhas = 0;
const comparar = (r, e, o) => { try { assert.deepStrictEqual(o, e); } catch (_e) { falhas += 1; if (falhas <= 8) console.error(`${r}\n  esperado ${JSON.stringify(e).slice(0, 400)}\n  obtido   ${JSON.stringify(o).slice(0, 400)}`); } };
let grupos = 0; let acoes = 0; let conferidos = 0; let recusados = 0;
const tenta = (fn) => { try { return { ok: json(fn()) }; } catch (x) { return { erro: x.message }; } };
ouro.casos.forEach((c, n) => {
  const e = c.entrada;
  const r = p.pagamentosSemAgenda(e.pagamentos, e.consultations, e.agenda, e.perfis, e.cadastros, e.data, e.agora, e.preco || undefined);
  grupos += r.length; comparar(`caso ${n} sem agenda`, c.semAgenda, json(r));
  comparar(`caso ${n} contatos`, c.contatos, e.pagamentos.map((x) => json(p.contato(x, e.data, e.agora))));
  for (const a of c.acoes) {
    let k = 0; const id = () => `id-${++k}`; let res;
    try { res = { ok: json((a.acao === 'asked' ? p.marcarPerguntado : p.retomarAcompanhamento)(e.pagamentos, a.ids, a.ator, e.agora, id)) }; } catch (x) { res = { erro: x.message }; }
    acoes += 1; comparar(`caso ${n} ${a.acao}`, a.res, res);
    // revisão do pagamento (`POST /payments/:id/revise`): o servidor refaz o evento do front com ator e instante dele
    if (res.ok) e.pagamentos.forEach((antes, i) => {
      const depois = res.ok[i]; if (JSON.stringify(depois) === JSON.stringify(antes)) return;
      conferidos += 1; comparar(`caso ${n} conferir ${antes.id}`, { ok: depois.serviceFollowUp }, tenta(() => p.conferirAcompanhamento(antes, depois, a.ator, e.agora, () => 'x')));
      const ev = depois.serviceFollowUp.events; const velhos = antes.serviceFollowUp ? antes.serviceFollowUp.events : [];
      const adulterados = [
        { events: [...ev, { ...ev[ev.length - 1], id: 'extra' }] },
        { events: ev.map((x, j) => (j === ev.length - 1 ? { ...x, action: 'xyz' } : x)) },
        ...(velhos.length ? [{ events: [{ ...velhos[0], actor: 'Outra pessoa' }, ...ev.slice(1)] }, { events: ev.slice(1) }] : []),
      ];
      for (const adulterado of adulterados) { recusados += 1; const r = tenta(() => p.conferirAcompanhamento(antes, { ...depois, serviceFollowUp: adulterado }, a.ator, e.agora, () => 'x')); if (!r.erro) comparar(`caso ${n} adulterado deveria ser recusado`, 'erro', 'aceito'); }
    });
  }
});
if (falhas) { console.error(`FALHOU: ${falhas} divergências com o código real do front.`); process.exit(1); }
console.log(`OK: ${ouro.casos.length} casos, ${grupos} grupos de pagamento sem agenda e ${acoes} ações de acompanhamento iguais ao front; ${conferidos} revisões de acompanhamento refeitas pelo servidor e ${recusados} adulteradas recusadas.`);
