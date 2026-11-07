'use strict';

/**
 * Cenários e execução do ouro da Jornada (`staff-workday-model.ts` e `staff-day-overview-model.ts`, v702). As ENTRADAS são montadas a partir
 * dos turnos que o próprio front produziu (`montarEntradas`, só no gerador) e gravadas no ouro; o verificador só executa `executarJornada`.
 */

const { prng, sorteio, DIA, BASE, iso } = require('./cenarios');
const { json, tentar } = require('./resumo');

function montarEntradas(turnosFinais, escalas) {
  const s = sorteio(prng(31)); const out = [];
  for (let n = 0; n + 2 < turnosFinais.length && out.length < 140; n += 2) {
    const turnos = turnosFinais.slice(n, n + 3).filter(Boolean);
    if (!turnos.length) continue;
    const t0 = Date.parse(turnos[0].startedAt); const dataFim = DIA(t0 + s.pick([0, 0, 86400000, 2 * 86400000]));
    const dados = [{ accountId: 'conta-1', roster: escalas[n % escalas.length], shifts: turnos.filter((_, i) => i % 2 === 0) }, { accountId: 'conta-2', roster: escalas[(n + 1) % escalas.length], shifts: turnos.filter((_, i) => i % 2 === 1) }];
    const agora = t0 + s.pick([0, 3_600_000, 8 * 3_600_000, 26 * 3_600_000, 90_000_000]);
    const evento = (i, em, extra = {}) => ({ id: `e${n}-${i}`, category: 'cliente', action: 'Editou cadastro', actionCode: 'client.updated', actorId: 'conta-1', actorKind: 'person', at: iso(em), recordId: `r${i}`, detail: 'ok', origin: 'captured', ...extra });
    const gestao = [evento(1, t0 + 600_000), evento(2, t0 + 4_000_000, { actorKind: 'system' }), evento(3, t0 + 9_000_000, { actionCode: 'history.accessed' }), evento(4, t0 + 12_000_000, { actorId: 'conta-2' }), evento(5, t0 + 13_000_000), evento(6, t0 + 20_000_000, { id: `e${n}-0` })];
    const umbler = [1, 2, 3].map((i) => ({ id: `u${n}-${i}`, at: iso(t0 + i * 2_500_000), actorId: 'conta-1', actorKind: i === 2 ? 'robot' : 'person', action: 'Respondeu', actionCode: 'reply', detail: 'x', conversationId: `cv${i}` }));
    out.push({ nome: `jornada ${n}`, contas: [{ id: 'conta-1', name: 'Atendente 1' }, { id: 'conta-2', name: 'Atendente 2' }], dados, data: DIA(t0), dataFim, agora, gestao, umbler });
  }
  return out.concat(manuais());
}

/** Turnos montados à mão para as bordas: pausa que termina em encerramento, saída exatamente no fim do dia Fadas e sinal perdido em trecho. */
function manuais() {
  const t = (id, de, eventos, extra = {}) => ({ id, accountId: 'conta-1', accountName: 'Atendente 1', operationalDate: '2026-11-04', startedAt: de, lastSeenAt: eventos[eventos.length - 1].at, events: eventos, ...extra });
  const contas = [{ id: 'conta-1', name: 'Atendente 1' }, { id: 'conta-2', name: 'Atendente 2' }];
  const base = Date.parse('2026-11-04T12:00:00Z'); const em = (m) => iso(base + m * 60_000);
  const casos = [
    t('m1', em(0), [{ kind: 'start', at: em(0) }, { kind: 'pause', at: em(60) }, { kind: 'end', at: em(100) }], { endedAt: em(100) }),
    t('m2', em(0), [{ kind: 'start', at: em(0) }, { kind: 'end', at: '2026-11-05T09:00:00.000Z' }], { endedAt: '2026-11-05T09:00:00.000Z' }),
    t('m3', em(0), [{ kind: 'start', at: em(0) }, { kind: 'end', at: '2026-11-05T09:00:00.001Z' }], { endedAt: '2026-11-05T09:00:00.001Z' }),
    t('m4', em(0), [{ kind: 'start', at: em(0) }, { kind: 'lost', at: em(40), evidence: 'last-signal' }, { kind: 'restored', at: em(100) }, { kind: 'pause', at: em(130) }]),
    t('m5', em(0), [{ kind: 'start', at: em(0) }, { kind: 'pause', at: em(10) }, { kind: 'resume', at: em(20) }, { kind: 'pause', at: em(30) }, { kind: 'resume', at: em(75) }]),
  ];
  return casos.map((turno, i) => ({
    nome: `jornada manual ${i + 1}`, contas, dados: [{ accountId: 'conta-1', roster: { weekly: [{ from: '2026-11-02', days: { 3: [{ start: '09:00', end: '18:00' }], 4: [{ start: '22:00', end: '03:00' }] } }], exceptions: {} }, shifts: [turno] }, { accountId: 'conta-2', shifts: [] }],
    data: '2026-11-04', dataFim: '2026-11-04', agora: base + 600 * 60_000, gestao: [], umbler: [{ id: `um${i}`, at: em(5), actorId: 'conta-1', actorKind: 'person', action: 'Respondeu', actionCode: 'reply', detail: 'x', conversationId: 'cv' }],
  }));
}

function executarJornada(fns, e) {
  const j = fns.jornada; const todos = e.dados.flatMap((d) => d.shifts); const meus = e.dados[0].shifts;
  const faixa = j.workdayWindow(e.data, meus, undefined, e.agora, undefined, e.dataFim);
  const faixaTurno = meus[0] ? j.workdayWindow(e.data, meus, meus[0], e.agora) : null;
  const linhas = j.workdayRows('conta-1', 'Atendente 1', faixa, todos, e.gestao, e.umbler);
  return {
    resumo: tentar(() => j.summarizeStaffDay(e.contas, e.dados, e.data, e.agora)), faixa: json(faixa), faixaTurno: json(faixaTurno), linhas: json(linhas), pausas: json(j.workdayPauses(meus)),
    lacunas30: json(j.workdayGaps(meus, linhas, e.agora)), lacunas5: json(j.workdayGaps(todos, linhas, e.agora, 5)),
    periodoValido: [j.validStaffPeriod(e.data, e.dataFim), j.validStaffPeriod(e.dataFim, e.data), j.validStaffPeriod('2026-11-01', '2026-12-01'), j.validStaffPeriod('2026-11-01', '2026-12-02'), j.validStaffPeriod('x', e.data)],
  };
}

module.exports = { montarEntradas, executarJornada };
