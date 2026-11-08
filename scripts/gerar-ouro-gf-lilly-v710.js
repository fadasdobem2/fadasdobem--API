'use strict';

/**
 * Gera o OURO da Lilly/Site v710 (c0ce39e) A PARTIR DO CÓDIGO REAL da Nice:
 *   node scripts/gerar-ouro-gf-lilly-v710.js --front=<pasta do front com node_modules, com a v710> [--lilly=<server/lilly>]
 * Roda as funções REAIS: `sameAgendaOccurrence`, `agendaDuplicateMatches/Message`, `assertNoGeneralQueueConflict`, `duplicateIntakeRequest`,
 * `requestAppointment/eligibleRequestAppointment` (vite do front) e `consultationPausedSecondsBetween/consultationEndWithPauses`, `closingTiming` (.mjs da Lilly).
 * Grava scripts/apoio-gf-lilly-v710/ouro-v710.json. Todo valor é fictício; modo real (sem calendário de demonstração).
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { alea, sorteio, chance, iso, soma } = require('./apoio-gf-agenda/aleatorio-pedido');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front') || '');
const lilly = path.resolve(arg('lilly') || '/Users/patrick.developer/Desktop/Developer/Projects/Nice/fadasdobemsuspiro/fadasdobemsuspiro/Nice-github/fadasdobem-site/server/lilly');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do front com node_modules>.'); process.exit(2); }
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const roda = (fn) => { try { const v = fn(); return { v: v === undefined ? null : v }; } catch (e) { return { e: e.message, nome: e.name }; } };
const AGORA = Date.parse('2026-11-08T15:00:00.000Z');
const HOJE = '2026-11-08';

function item(i, extra = {}) {
  const horario = sorteio([undefined, undefined, '09:00', '20:00', '21:30']);
  const dia = sorteio([soma(HOJE, -1), HOJE, HOJE, soma(HOJE, 1), soma(HOJE, 2)]);
  const tipo = sorteio(['sem', 'exato', 'aprox', 'turno', 'depois']);
  const plano = tipo === 'sem' ? undefined : { who: 'staff', timing: tipo === 'exato' ? 'exact' : tipo === 'aprox' ? 'approximate' : tipo === 'turno' ? 'shift' : 'after', ...(tipo === 'turno' ? { shift: { label: 'Noite', start: '19:00', end: '23:00' } } : { time: chance(0.12) ? 'abc' : horario || '20:00' }) };
  return {
    id: `a${i}`, tarotId: sorteio(['osiris', 'osiris', 'nyx', 'afila']), clientId: sorteio(['900001', '900001', '900002', '']), ...(chance(0.15) ? { leadId: 'lead-1' } : {}), client: 'Ana', date: dia, position: 1 + (i % 4),
    createdAt: iso(AGORA - sorteio([0.5, 5, 30, 60, 100]) * 3600000), contact: { attempt: 1, date: dia, tags: chance(0.1) ? [sorteio(['Cancelada', 'Concluída', 'Avisada'])] : [] },
    ...(plano ? { contactPlan: plano } : { ...(horario && chance(0.5) ? { scheduledTime: horario } : {}), ...(horario && chance(0.4) ? { requestedTime: horario } : {}) }),
    ...(chance(0.1) ? { workflowStatus: sorteio(['Concluída', 'Em consulta', 'Avisada']) } : {}), ...(chance(0.08) ? { agendaOutcome: 'Cancelada' } : {}), ...(chance(0.12) ? { requestId: sorteio(['rq-1', 'rq-2']) } : {}),
    ...(chance(0.12) ? { queueReservation: { tarotId: 'osiris', at: iso(AGORA - 3600000), by: 'Khloe' } } : {}), ...extra,
  };
}
const pausas = () => N(Math.floor(alea() * 4), () => { const ini = AGORA - Math.floor(alea() * 90) * 60000; return { startedAt: iso(ini), ...(chance(0.8) ? { endedAt: iso(ini + Math.floor(alea() * 20) * 60000) } : {}) }; });

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error', cacheDir: '/private/tmp/fadas-ouro-lilly-v710', optimizeDeps: { noDiscovery: true, include: [] } });
  const pausa = await import(pathToFileURL(path.join(lilly, '..', '..', 'features', 'domain', 'consultation-pause-timing.mjs')).href);
  const fechamento = await import(pathToFileURL(path.join(lilly, 'consultation-closing.mjs')).href);
  try {
    const l = (p) => vite.ssrLoadModule(p);
    const cal = await l('/features/domain/operation-calendar.ts');
    if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
    const occ = await l('/features/agenda/agenda-occurrence.ts');
    const dup = await l('/features/agenda/agenda-duplicate.ts');
    const conf = await l('/features/agenda/general-queue-conflicts.ts');
    const im = await l('/features/agenda/agenda-intake-model.ts');
    const out = { gerado: 'agenda-occurrence, agenda-duplicate, general-queue-conflicts, agenda-intake-model (vite do front v710) + consultation-pause-timing e consultation-closing (.mjs da Lilly)', hoje: HOJE, agora: AGORA };

    out.ocorrencia = N(700, (i) => { const a = item(i); const b = item(i + 1000); const now = AGORA + sorteio([-6, -2, 0, 2, 6]) * 3600000; return { a, b, now, esperado: occ.sameAgendaOccurrence(a, b, HOJE, now) }; });
    out.duplicidade = N(500, (i) => {
      const agenda = N(1 + Math.floor(alea() * 4), (k) => item(i * 10 + k)); const cand = { ...item(5000 + i), id: chance(0.3) ? agenda[0].id : `n${i}`, requestId: sorteio([undefined, 'rq-1']) };
      const now = AGORA + sorteio([-4, 0, 4]) * 3600000; const excluirId = chance(0.3) ? agenda[0].id : undefined; const nome = sorteio([undefined, 'Brisa', ' ']);
      const opcoes = { today: HOJE, now, excludeId: excluirId, professionalName: nome };
      const achados = dup.agendaDuplicateMatches(agenda, cand, opcoes);
      return { agenda, cand, now, excluirId, nome, esperado: { ids: achados.map((x) => x.id), mensagem: achados[0] ? dup.agendaDuplicateMessage(achados[0], agenda, opcoes) : null } };
    });
    // Casos dirigidos: cliente na Fila Geral COM reserva vigente para a mesma profissional do candidato (a profissional contada é a reservada).
    out.duplicidade.push(...N(150, (i) => {
      const reservada = item(7000 + i, { tarotId: 'afila', clientId: '900001', leadId: undefined, date: HOJE, contactPlan: undefined, scheduledTime: undefined, requestedTime: undefined, agendaOutcome: undefined, workflowStatus: undefined, contact: { attempt: 1, date: HOJE, tags: [] }, queueReservation: { tarotId: 'osiris', at: iso(AGORA - 3600000), by: 'Khloe' }, ...(chance(0.3) ? { immediateReservationRelease: { tarotId: 'osiris', date: HOJE } } : {}) });
      const cand = { ...item(8000 + i, { tarotId: 'osiris', clientId: '900001', leadId: undefined, date: HOJE, contactPlan: undefined, scheduledTime: undefined, requestedTime: undefined }), id: 'novo' };
      const agenda = [reservada]; const now = AGORA; const opcoes = { today: HOJE, now, excludeId: undefined, professionalName: 'Osíris' };
      const achados = dup.agendaDuplicateMatches(agenda, cand, opcoes);
      return { agenda, cand, now, excluirId: undefined, nome: 'Osíris', esperado: { ids: achados.map((x) => x.id), mensagem: achados[0] ? dup.agendaDuplicateMessage(achados[0], agenda, opcoes) : null } };
    }));
    out.conflitoFilaGeral = N(500, (i) => {
      const origem = item(i, { tarotId: 'afila', clientId: '900001', leadId: undefined }); const resto = N(Math.floor(alea() * 4), (k) => item(i * 10 + k, { clientId: sorteio(['900001', '900001', '900002']), leadId: undefined }));
      const agenda = [origem, ...resto]; const cand = { ...origem, tarotId: sorteio(['osiris', 'nyx']), date: sorteio([HOJE, soma(HOJE, 1), soma(HOJE, 2)]), scheduledTime: sorteio([undefined, '09:00', '20:00']), requestedTime: undefined, contactPlan: sorteio([undefined, { who: 'staff', timing: 'none' }, { who: 'staff', timing: 'exact', time: '20:00' }, { who: 'staff', timing: 'approximate', time: '09:00' }]), standbyDate: undefined };
      const now = AGORA + sorteio([-4, 0, 4]) * 3600000;
      const nomes = { osiris: 'Osíris', nyx: 'Nyx', afila: undefined };
      const r = roda(() => conf.assertNoGeneralQueueConflict(agenda, origem, cand, { today: HOJE, now, professionalName: (id) => nomes[id] }));
      return { agenda, origem, cand, now, esperado: r.e ? r.e : null };
    });
    // Dirigidos: dois pedidos com planos de horário "exato/aprox" mas relógio ilegível, e outro com horário válido.
    out.conflitoFilaGeral.push(...N(200, (i) => {
      const clock = () => sorteio([{ who: 'staff', timing: 'exact', time: 'abc' }, { who: 'staff', timing: 'approximate', time: '09:00' }, { who: 'staff', timing: 'exact', time: '20:00' }, { who: 'staff', timing: 'after', time: '09:00' }]);
      const origem = item(9000 + i, { tarotId: 'afila', clientId: '900001', leadId: undefined, date: HOJE, contactPlan: clock(), scheduledTime: undefined, requestedTime: undefined, agendaOutcome: undefined, workflowStatus: undefined, queueReservation: undefined, contact: { attempt: 1, date: HOJE, tags: [] } });
      const outro = item(9500 + i, { tarotId: sorteio(['osiris', 'nyx']), clientId: '900001', leadId: undefined, date: HOJE, contactPlan: clock(), scheduledTime: undefined, requestedTime: undefined, agendaOutcome: undefined, workflowStatus: undefined, queueReservation: undefined, contact: { attempt: 1, date: HOJE, tags: [] } });
      const cand = { ...origem, tarotId: 'osiris', contactPlan: clock(), date: HOJE, standbyDate: undefined }; const now = AGORA;
      const r = roda(() => conf.assertNoGeneralQueueConflict([origem, outro], origem, cand, { today: HOJE, now, professionalName: (id) => ({ osiris: 'Osíris', nyx: 'Nyx' })[id] }));
      return { agenda: [origem, outro], origem, cand, now, esperado: r.e ? r.e : null };
    }));
    out.pedidos = N(400, (i) => {
      const date = sorteio([HOJE, soma(HOJE, 1)]); const mk = (k, e = {}) => ({ id: `rq-${k}`, tarotId: 'osiris', clientId: sorteio(['900001', '900002']), client: 'Ana', date, at: iso(AGORA), note: '', stage: sorteio(['ask', 'ask', 'descheduled']), ...(chance(0.5) ? { requestedTime: sorteio(['09:00', '20:00']) } : {}), ...(chance(0.2) ? { agendaId: 'a0' } : {}), ...e });
      const pedidos = N(1 + Math.floor(alea() * 3), (k) => mk(k)); const cand = mk(99); const agenda = N(Math.floor(alea() * 3), (k) => item(i * 10 + k, { id: k === 0 ? 'a0' : `x${k}`, tarotId: 'osiris', date, requestId: chance(0.3) ? 'rq-0' : undefined }));
      const pedido = pedidos[0]; const now = AGORA;
      const real = Date.now; Date.now = () => now;
      try {
        const d = im.duplicateIntakeRequest(pedidos, cand, [], agenda);
        return { pedidos, cand, agenda, now, esperado: { duplicado: d ? d.id : null, doPedido: (im.requestAppointment(pedido, agenda) || {}).id ?? null, elegivel: (im.eligibleRequestAppointment(pedido, agenda, []) || {}).id ?? null } };
      } finally { Date.now = real; }
    });
    out.pausa = N(300, () => {
      const c = { startedAt: iso(AGORA - 120 * 60000), pauseHistory: pausas() }; const de = AGORA - Math.floor(alea() * 100) * 60000; const ate = de + Math.floor(alea() * 100) * 60000; const seg = Math.floor(alea() * 3600);
      return { c, de, ate, seg, agora: iso(AGORA), esperado: { pausados: pausa.consultationPausedSecondsBetween(c, de, ate), fim: roda(() => pausa.consultationEndWithPauses(c, seg, iso(AGORA), c.startedAt)) } };
    });
    out.fechamento = N(400, () => {
      const inicio = AGORA - sorteio([5, 20, 45, 90]) * 60000; const row = { id: 'c1', clientId: '1', tarologistId: 'o', status: sorteio(['in_progress', 'in_progress', 'ended', 'prepared']), startedAt: iso(inicio), ...(chance(0.7) ? { tarologistStartedAt: iso(inicio + 60000) } : {}), awaitingTarologistStart: chance(0.1), pauseHistory: pausas(), ...(chance(0.3) ? { tarologistFinishReport: { minutes: sorteio([5, 12.5, 30, 500]) } } : {}) };
      const evento = { at: iso(AGORA + sorteio([-30, 0, 5, 60]) * 60000), data: chance(0.4) ? { minutes: sorteio([3, 10, 18.5, 300, -1, 0]) } : {} };
      return { row, evento, esperado: roda(() => fechamento.closingTiming(row, evento)) };
    });
    const destino = path.join(__dirname, 'apoio-gf-lilly-v710', 'ouro-v710.json');
    fs.writeFileSync(destino, `${JSON.stringify(out)}\n`);
    console.log(`OK -> ${destino}: ${Object.keys(out).filter((k) => Array.isArray(out[k])).map((k) => `${k} ${out[k].length}`).join(' | ')}`);
  } finally { await vite.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
