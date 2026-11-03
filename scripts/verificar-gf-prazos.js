'use strict';

/**
 * Verificador OFFLINE dos prazos de atendimento (Maturacao/56 grupo D): roda o domínio portado (`prazos-*.js`) sobre as entradas do OURO gerado do
 * código REAL do front (`gerar-ouro-gf-prazos.js`, `Date.now` travado) e exige o mesmo resultado em TODOS os campos: espera de contato/pagamento
 * (5 min atenção, 10 min expirada), prazo combinado, relógio e alertas do painel, revisão prioritária, espera do "mais tempo" e fim de turno (15 min).
 * Inclui as bordas exatas e os mutantes (o servidor tem de responder como o front à entrada alterada). Sem banco, sem relógio do sistema.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const pr = require('../src/gestao-fadas/_comum/dominio/prazos-atendimento');
const lanc = require('../src/gestao-fadas/_comum/dominio/painel-lancamento');
const { resumirEspera, resumirTurno } = require('./apoio-gf-prazos/resumo');

const originalNow = Date.now;
Date.now = () => { throw new Error('Date.now() chamado dentro da regra: o relógio tem de ser injetado'); };

const fns = {
  esperaComum: pr.esperaComum, financiado: (i, e, p) => lanc.financiamentoDoLancamento(i, e, p).funded, prazoPedido: pr.prazoPedido,
  relogioDeContato: pr.relogioDeContato, inicioDoPodeAgora: pr.inicioDoPodeAgora, alertaDeProntaEsperando: pr.alertaDeProntaEsperando, alertaDeContatoEsperando: pr.alertaDeContatoEsperando,
  prazoDeEsperaExpirado: pr.prazoDeEsperaExpirado, esperaPrecisaDeAtencao: pr.esperaPrecisaDeAtencao, esperaDoMaisTempo: pr.esperaDoMaisTempo, fimDoTurno: pr.fimDoTurnoDaLeitora,
};
const ouro = JSON.parse(fs.readFileSync(path.join(__dirname, 'apoio-gf-prazos', 'ouro-prazos-front.json'), 'utf8'));
let falhas = 0; const mostrar = (m) => { falhas += 1; if (falhas <= 10) console.error(m); };
const comparar = (rotulo, esperado, obtido) => { try { assert.deepStrictEqual(obtido, esperado); } catch (_e) { mostrar(`${rotulo}\n  esperado ${JSON.stringify(esperado)}\n  obtido   ${JSON.stringify(obtido)}`); } };

const cont = { campos: 0, mutantes: 0, mudam: 0, expiradas: 0, atencao: 0, bordas: 0, manual: 0, parcial: 0, maisTempo: 0, urgentes: 0, historicoIgual: 0, historicoRotuloDiverge: 0, recusaErro: 0 };
ouro.casos.forEach((c, n) => {
  const obt = resumirEspera(fns, c.entrada, c.item, c.perfil);
  comparar(`caso ${n}${c.borda ? ' (borda)' : ''}`, c.esperado, obt);
  cont.campos += Object.keys(c.esperado).length; if (c.borda) cont.bordas += 1;
  if (c.esperado.wait.expired) cont.expiradas += 1; if (c.esperado.wait.attention) cont.atencao += 1; if (c.esperado.wait.manual) cont.manual += 1; if (c.esperado.wait.automationPaused) cont.parcial += 1;
  if (c.esperado.maisTempo) cont.maisTempo += 1; if (c.esperado.alertaContato && c.esperado.alertaContato.tone === 'urgent') cont.urgentes += 1;
  if (c.esperado.wait.erro) cont.recusaErro += 1;
  for (const m of c.mutantes) {
    cont.mutantes += 1; if (m.muda) cont.mudam += 1;
    comparar(`caso ${n} mutante ${m.nome}`, m.esperado, resumirEspera(fns, m.entrada, c.item, c.perfil));
  }
});
ouro.turnos.forEach((c, n) => comparar(`turno ${n}`, c.esperado, resumirTurno(fns, c)));
// horário de verão histórico: limite conhecido (UTC-3 fixo no servidor). Só o RÓTULO pode divergir; fim, minutos restantes e alerta têm de ser iguais.
for (const h of ouro.historico) {
  const obt = resumirTurno(fns, h);
  if (!h.esperado || !obt || h.esperado.erro || obt.erro) { comparar('histórico', h.esperado, obt); continue; }
  const { timeLabel: a, ...restoFront } = h.esperado; const { timeLabel: b, ...restoApi } = obt;
  comparar(`histórico ${new Date(h.now).toISOString()} (sem o rótulo)`, restoFront, restoApi);
  if (a === b) cont.historicoIgual += 1; else cont.historicoRotuloDiverge += 1;
}
// as bordas exatas têm de aparecer com o sentido certo (guarda contra ouro vazio)
const exige = (cond, msg) => { if (!cond) mostrar(`cobertura: ${msg}`); };
exige(cont.expiradas > 200 && cont.atencao > 100 && cont.manual > 10 && cont.maisTempo > 20 && cont.urgentes > 20, 'o ouro precisa conter espera expirada, em atenção, combinada, de mais tempo e alerta urgente');
exige(cont.mudam > cont.mutantes / 3, 'os mutantes precisam mudar o resultado do caso base na maioria das vezes');
const bordas = ouro.casos.filter((c) => c.borda && c.esperado.wait.kind === 'response' && !c.esperado.wait.manual);
const porAtraso = (ms) => bordas.filter((c) => c.agora - c.esperado.wait.startedAt === ms);
exige(porAtraso(299999).some((c) => !c.esperado.wait.attention) && porAtraso(300000).some((c) => c.esperado.wait.attention) && porAtraso(599999).some((c) => c.esperado.wait.attention && !c.esperado.wait.expired) && porAtraso(600000).some((c) => c.esperado.wait.expired), 'bordas 4:59.999/5:00/9:59.999/10:00 ausentes ou invertidas');
const turnoBorda = ouro.turnos.filter((c) => c.esperado && c.esperado.remainingMinutes !== undefined);
exige(turnoBorda.some((c) => c.esperado.endingSoon) && turnoBorda.some((c) => !c.esperado.endingSoon), 'fim de turno precisa ter casos dentro e fora dos 15 min');
Date.now = originalNow;
if (falhas) { console.error(`FALHOU: ${falhas} divergências entre o servidor e o código real do front.`); process.exit(1); }
console.log(`OK: ${ouro.casos.length} casos de espera (${cont.bordas} bordas exatas; ${cont.expiradas} expiradas, ${cont.atencao} em atenção, ${cont.manual} com prazo combinado, ${cont.parcial} em pausa por pagamento parcial, ${cont.maisTempo} de mais tempo, ${cont.urgentes} alertas urgentes), ${cont.mutantes} mutantes (${cont.mudam} mudam o resultado) e ${ouro.turnos.length} fins de turno idênticos ao front; verão histórico: ${cont.historicoIgual} com rótulo igual e ${cont.historicoRotuloDiverge} com rótulo diferente (limite documentado, o resto igual).`);
