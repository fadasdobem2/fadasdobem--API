'use strict';

/**
 * Executa os cenários do ouro do Ponto sobre um conjunto de funções (`fns`): as do FRONT no gerador, as do SERVIDOR no verificador.
 * O resultado é normalizado como JSON (campo `undefined` some) e recusas viram `{ erro: <frase> }` com a MESMA frase que a tela mostra.
 */

const { versao, historias } = require('./cenarios');

const json = (v) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));
function tentar(f) { try { return { ok: json(f()) }; } catch (e) { return { erro: e.message }; } }

function executarTurno(fns, caso) {
  const atores = { a: { id: 'conta-1', name: 'Atendente 1' }, outra: { id: 'conta-2', name: 'Atendente 2' } };
  let atual; const saida = [];
  caso.passos.forEach((p, i) => {
    const esperado = p.esperado === 'atual' ? (atual && atual.id) : p.esperado === 'errado' ? 'turno-inexistente' : undefined;
    const r = tentar(() => { const n = fns.turno.apply(atual && JSON.parse(JSON.stringify(atual)), atores[p.ator], p.comando, p.agora, `novo-${caso.nome}-${i}`, esperado); return { turno: n === undefined ? null : n, mudou: !(n === undefined || (atual && JSON.stringify(n) === JSON.stringify(atual))) }; });
    if (r.ok && r.ok.turno) atual = r.ok.turno;
    saida.push({ r, estado: atual ? fns.turno.status(atual, p.estadoEm) : null, podeIniciar: atual ? fns.turno.canStart(atual, p.estadoEm) : null });
  });
  return saida;
}

function executarCalendario(fns, grupo) {
  const c = fns.calendario; const base = c.DEFAULT; const hist = historias(base); const h = (n) => (n ? hist[n] : undefined);
  const casos = grupo.casos.map((x) => ({ n: x.nome, data: tentar(() => c.operationalDateAt(x.em, h(x.historia))), metrica: tentar(() => c.metricsGenerationDay(x.em, h(x.historia))) }));
  const janelas = []; for (const n of [null, 'h8', 'h4']) for (const d of grupo.datas) {
    janelas.push({ n, d, j: tentar(() => c.operationalWindow(d, d, h(n))), p: tentar(() => c.operationalWindow(d, '2026-12-16', h(n))), r: tentar(() => c.operationalWindowLabel(d, d, h(n))), v: tentar(() => c.operationVersionForDate(d, h(n)).id), i: tentar(() => c.operationalDayStart(d, h(n))) });
  }
  const horas = ['00:00', '05:59', '06:00', '08:00', '23:59', '24:00', '9h', '', 'x'];
  const relogio = []; for (const d of ['2026-11-04', '2018-11-04', '2018-02-18', '2019-02-17', '2026-02-30', '']) for (const hr of horas) relogio.push({ d, hr, r: tentar(() => c.saoPauloWallTimestamp(d, hr)) });
  const invalidas = [{ dayStart: '08:00', metricsTime: '07:00' }, { dayStart: '25:00' }, { serviceHours: [] }, { id: '' }, { effectiveFrom: '2026-13-01' }, { createdBy: ' ' },
    { serviceHours: base.serviceHours.map((r) => (r.weekday === 1 ? { ...r, defined: true, start: '09:00', end: '09:00', endDayOffset: 0 } : r)) },
    { serviceHours: base.serviceHours.map((r) => (r.weekday === 1 ? { ...r, defined: true, start: '09:00', end: '12:00', endDayOffset: 1 } : r.weekday === 2 ? { ...r, defined: true, start: '08:00', end: '10:00', endDayOffset: 0 } : r)) },
    { serviceHours: base.serviceHours.map((r) => (r.weekday === 3 ? { ...r, endDayOffset: 2 } : r)) }];
  const versoes = invalidas.map((extra, k) => ({ k, v: tentar(() => c.validateOperationVersion({ ...versao(`x${k}`, '2026-12-01', '06:00', '06:00'), ...extra })) }));
  const hs = [base, ...hist.h8, ...hist.h4, versao('z', '2026-11-20', '08:00', '08:30')];
  const historias2 = [[base], [base, versao('a', '2026-11-20', '08:00', '08:30')], hist.h8, hist.h4, [hist.h8[1]], [base, hist.h8[1], hist.h8[1]], [], [{ ...base, id: 'outra' }], hs].map((x) => c.validOperationHistory(x));
  const anexos = [['2026-11-20', 'n1', '2026-11-05'], ['2026-11-05', 'n2', '2026-11-05'], ['2026-11-15', 'n3', '2026-11-05'], ['2026-11-25', 'n4', '2026-11-05'], ['2026-11-20', 'v8', '2026-11-05'], ['2026-11-25', 'n5', 'sem-data']]
    .map(([de, id, hoje]) => tentar(() => c.appendOperationVersion(hist.h8, versao(id, de, '07:00', '07:30'), hoje).map((v) => v.id)));
  return { casos, janelas, relogio, versoes, historias2, anexos };
}

function executarEscala(fns, caso) {
  const e = fns.escala; const roster = caso.roster ? JSON.parse(JSON.stringify(caso.roster)) : undefined;
  const aplicar = []; let atual = roster;
  for (const ed of caso.edicoes) {
    const r = tentar(() => e.edit(atual && JSON.parse(JSON.stringify(atual)), JSON.parse(JSON.stringify(ed))));
    aplicar.push(r); if (r.ok) atual = r.ok;
  }
  return { valida: e.valid(roster), edicoes: aplicar, dias: caso.datas.map((d) => { const p = e.forDate(atual, d); return { d, p: json(p), t: e.describe(p) }; }) };
}

function executarRegistro(fns, caso) {
  const r = fns.registro; const { perfil, excecoes, feriados, hoje } = caso; const id = perfil.id;
  const porData = caso.datas.map((d) => ({ d, entrada: json(r.rosterEntry(perfil, excecoes, d, feriados)), agenda: r.isRosterScheduleDate(perfil, excecoes, d, feriados), fechado: r.isClosedRosterSunday(perfil, excecoes, d, feriados),
    edita: r.canEditOwnHoursDate(perfil, excecoes, d, hoje, feriados), origem: json(r.ownHoursOriginLabel(perfil, excecoes, d, feriados)), resposta: r.hasRosterAnswer(excecoes, id, d), relacionado: json(r.relatedRosterSaturday(d)), especial: r.isSpecialRosterDate(d, feriados) }));
  return { porData, sabado: r.nextRosterSaturday(hoje), pedido: r.saturdayRosterRequestOpen(hoje), pendentes: r.pendingRosterDates(id, hoje, feriados, excecoes), pendentesDoPerfil: r.pendingRosterDates(id, hoje, feriados, excecoes, perfil),
    proximas: json(r.ownUpcomingHoursDates(perfil, excecoes, hoje, feriados)), proximasEscala: json(r.ownUpcomingRosterDates(perfil, excecoes, hoje, feriados)) };
}

module.exports = { json, tentar, executarTurno, executarCalendario, executarEscala, executarRegistro };
