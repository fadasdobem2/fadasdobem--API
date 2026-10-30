'use strict';

/**
 * Gera os CASOS DE OURO da fila geral, da admissão do turno e da regra de início (Maturacao/29 seção 11) a partir do CÓDIGO do front:
 * `general-reservations.ts`, `panel-flow-model.ts` (reservar, liberar, encaminhar, preparar), `reader-continuation.ts`,
 * `agenda-intake-model.ts` e `staff-presence-model.ts`. Grava entradas e saídas em scripts/apoio-gf-painel/ouro-fila-geral.json.
 *   node scripts/gerar-ouro-gf-fila-geral.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real (sem a demonstração), sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261114;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;

const AGORA = Date.parse('2026-10-12T10:00:00-03:00');
const DIA = '2026-10-12';
const iso = (ms) => new Date(ms).toISOString();
const minutos = (n) => n * 60000;

function evento(item, tag, em, extra = {}) {
  return { id: `${item.id}-${tag}-${em}`, actor: 'Equipe', at: iso(em), date: DIA, attempt: 1, tag, active: true, before: [], after: [tag], ...extra };
}

function agendamento(i) {
  const id = `ag${i}`;
  const item = { id, clientId: `c${i}`, client: `Cliente ${i}`, tarotId: chance(0.8) ? 'afila' : 'reader', date: chance(0.15) ? '2026-10-13' : DIA, time: '09:00', createdAt: iso(AGORA - minutos(30 + i)),
    channel: 'Telefone', observation: '', response: 'Aguardando resposta', position: i + 1, contact: { attempt: 1, date: DIA, tags: [] }, contactHistory: [] };
  if (chance(0.45)) { const tags = sorteio([['Avisada'], ['Pode agora'], ['Avisada', 'Pode agora'], ['Vai pagar'], ['Chama depois'], ['Não respondeu'], ['Não pode agora']]); item.contact = { attempt: 1, date: DIA, tags }; item.contactHistory = tags.map((t, k) => evento(item, t, AGORA - minutos(20 - k), { after: tags })); }
  if (chance(0.5)) item.queueReservation = { tarotId: 'reader', at: iso(AGORA - minutos(Math.floor(aleatorio() * 25))), by: 'Equipe' };
  if (item.queueReservation && chance(0.15)) item.immediateReservationRelease = { tarotId: 'reader', date: item.date, scheduledTime: item.scheduledTime, requestedTime: item.requestedTime, at: iso(AGORA - minutos(2)), by: 'Equipe' };
  if (chance(0.2)) item.scheduledTime = sorteio(['09:30', '10:30', '14:00', '05:30']);
  if (chance(0.1)) item.requestedTime = sorteio(['10h', 'de manhã', '11:15']);
  if (chance(0.15)) item.contactPlan = sorteio([{ who: 'client', timing: 'none' }, { who: 'staff', timing: 'exact', time: '10:30', callback: true }, { who: 'staff', timing: 'after', time: '09:00', callback: true }, { who: 'staff', timing: 'shift', shift: { label: 'Manhã', start: '08:00', end: '09:30' } }, { who: 'staff', timing: 'none' }]);
  if (chance(0.12)) item.queueDeferral = { attempt: 1, at: iso(AGORA - minutos(5)), by: 'Equipe', reason: 'Chama depois' };
  if (chance(0.08)) item.workflowStatus = sorteio(['Em consulta', 'Concluída', 'Avisada']);
  if (chance(0.06)) { item.agendaOutcome = 'Cancelada'; item.contact = { attempt: 1, date: DIA, tags: ['Cancelada'] }; }
  if (chance(0.08)) item.continuationRequest = { sourceConsultationId: 'k1', requestedAt: iso(AGORA - minutos(40)), requestedBy: 'Equipe' };
  if (chance(0.12)) item.contactHistory.push({ id: `common-call-timeout-${id}-1`, actor: 'Sistema', at: iso(AGORA - minutos(1)), date: DIA, attempt: 1, tag: 'Não respondeu', active: true, before: ['Avisada'], after: ['Não respondeu'] });
  if (chance(0.1)) item.queueDeferralHistory = [{ attempt: 1, at: iso(AGORA - minutos(50)), by: 'Equipe', active: false }];
  return item;
}

function consulta(i, agenda) {
  const item = sorteio(agenda);
  const c = { id: `k${i}`, clientId: chance(0.3) ? item.clientId : `outra${i}`, client: 'Cliente', tarotId: chance(0.7) ? 'reader' : 'outra', tarot: 'Leitora', status: sorteio(['Em curso', 'Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Devolvida']),
    startedAt: iso(AGORA - minutos(10 + Math.floor(aleatorio() * 90))), durationSeconds: 600, audit: [], agendaItemId: chance(0.3) ? item.id : undefined };
  if (c.status === 'Em curso' && chance(0.3)) c.tarologistFinishReport = { submittedAt: iso(AGORA - minutos(3)), clientWantsMoreTime: chance(0.5) };
  if (['Concluída', 'Finalizada pelo tarólogo'].includes(c.status) && chance(0.6)) c.tarologistMoreTimeRequest = { active: chance(0.8), requestedAt: iso(AGORA - minutos(4)), ...(chance(0.2) ? { suspended: true } : {}), ...(chance(0.15) ? { archived: true } : {}) };
  if (chance(0.15)) c.continuation = { sourceConsultationId: 'k1' };
  return c;
}

const perfil = (extra = {}) => ({ id: 'reader', name: 'Leitora', online: true, status: 'Disponível', official: [], today: '0h às 23h', weeklySchedule: { segunda: '0h às 23h' }, note: '', ...extra });

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-fila-geral', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const res = await vite.ssrLoadModule('/features/agenda/general-reservations.ts');
    const flow = await vite.ssrLoadModule('/features/painel/panel-flow-model.ts');
    const cont = await vite.ssrLoadModule('/features/agenda/reader-continuation.ts');
    const intake = await vite.ssrLoadModule('/features/agenda/agenda-intake-model.ts');
    const pres = await vite.ssrLoadModule('/features/tarologas/staff-presence-model.ts');
    const rec = await vite.ssrLoadModule('/features/agenda/agenda-common-deadlines.ts');
    const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    let contador = 0;
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: () => `id-${++contador}`, configurable: true });
    const ids = (agenda) => JSON.parse(JSON.stringify(agenda));

    const casos = [];
    let reservouOk = 0; let roteouOk = 0;
    for (let k = 0; k < 90; k += 1) {
      const agenda = Array.from({ length: 3 + Math.floor(aleatorio() * 6) }, (_, i) => agendamento(i));
      const consultas = Array.from({ length: Math.floor(aleatorio() * 5) }, (_, i) => consulta(i, agenda));
      const agora = AGORA + (chance(0.3) ? minutos(Math.floor(aleatorio() * 20)) : 0);
      const entrada = { agenda, consultations: consultas, payments: [], date: DIA, now: agora, profiles: [perfil(), perfil({ id: 'outra', name: 'Outra' })], accounts: [], overrides: {} };
      const alvo = sorteio(agenda.filter((a) => a.tarotId === 'afila') .concat([agenda[0]]));
      const caso = { agenda, consultas, agora, alvo: alvo.id };
      caso.ativa = agenda.map((a) => res.generalReservationActive(a, DIA, agora));
      caso.recesso = agenda.map((a) => rec.commonAgendaRecession(a) || null);
      caso.reservas = res.generalReservations(agenda, 'reader', DIA, consultas, agora).map((a) => a.id);
      caso.conflito = (res.generalReservationConflict(agenda, consultas, 'reader', DIA, alvo.clientId, alvo.id, agora) || {}).id || null;
      caso.conflito2 = (res.generalReservationConflict(agenda, consultas, 'reader', DIA, 'x', undefined, agora) || {}).id || null;
      caso.liberadaPropria = agenda.map((a) => res.releaseOwnQueueReservation([a], a.id, 'reader', 'Equipe', agora)[0]);
      caso.continuacao = [undefined, 'k1', 'k2'].map((s) => (cont.continuationReservationConflict(consultas, 'reader', s) || {}).id || null);
      contador = 0; caso.preparada = tentar(() => ids(flow.prepareGeneralReservation(alvo, DIA, agora, 'Equipe')));
      caso.liberada = ids(flow.releaseGeneralReservation(agenda, alvo.id, 'Equipe', agora));
      contador = 0; caso.reservada = tentar(() => ids(flow.reserveGeneralClient(entrada, alvo.id, 'reader', 'Equipe')));
      contador = 0; caso.encaminhada = tentar(() => ids(flow.routeGeneral(entrada, alvo.id, 'reader', 'Equipe')));
      if (caso.reservada.ok) reservouOk += 1;
      if (caso.encaminhada.ok) roteouOk += 1;
      casos.push(caso);
    }

    const casosAdmissao = [];
    for (let k = 0; k < 120; k += 1) {
      const modo = sorteio(['open', 'no_more', 'until_end', 'on_return', 'count']);
      const escopo = sorteio(['shift', 'day', undefined]);
      const base = { id: `ev${k}`, tarotId: 'reader', date: DIA, mode: modo, at: iso(AGORA - minutos(Math.floor(aleatorio() * 120))), by: 'Equipe', consultationIds: [] };
      if (modo === 'no_more') Object.assign(base, { closeScope: escopo || 'day', closedUntil: chance(0.3) ? iso(AGORA - minutos(5)) : iso(AGORA + minutos(90)), agendaIds: chance(0.4) ? ['ag1'] : [], ...(escopo === 'shift' ? { endTime: '12:00' } : {}) });
      if (modo === 'until_end') base.endTime = sorteio(['09:00', '12:00', '23:00']);
      if (modo === 'on_return') { base.returnTime = sorteio(['09:00', '11:00', '13:00']); base.endTime = sorteio(['12:00', '14:00', '03:00']); }
      if (modo === 'count') base.count = 2;
      const eventos = chance(0.15) ? [] : [base];
      const antes = chance(0.5) ? { id: 'ag1', tarotId: 'reader', clientId: 'cx', date: DIA, standbyDate: chance(0.3) ? DIA : undefined, contact: { attempt: 1, date: DIA, tags: [] }, position: 1, time: '09:00', createdAt: iso(AGORA) } : undefined;
      const alvo = { tarotId: 'reader', date: DIA, clientId: chance(0.7) ? 'cx' : 'cy', ...(chance(0.3) ? { standbyDate: DIA } : {}), ...(chance(0.5) ? { scheduledTime: sorteio(['08:00', '10:00', '12:30', '02:00']) } : {}) };
      const agora = AGORA + (chance(0.3) ? minutos(Math.floor(aleatorio() * 300)) : 0);
      const vigente = intake.currentIntake(eventos, 'reader', DIA, agora) || null;
      casosAdmissao.push({ eventos, antes: antes || null, alvo, agora, vigente,
        admissao: intake.intakeAdmissionError(vigente || undefined, antes, alvo, agora), inicio: intake.intakeStartError(vigente || undefined, antes, alvo, agora),
        retornoAberto: vigente ? intake.intakeReturnIsOpen(vigente, agora) : null });
    }

    const casosPresenca = [];
    for (let k = 0; k < 60; k += 1) {
      const p = { id: 'reader', name: 'Leitora', online: chance(0.7), status: sorteio(['Disponível', 'Pausa', 'Em consulta']), official: [], today: '', weeklySchedule: {}, note: '' };
      if (chance(0.6)) p.shiftStatus = sorteio(['Disponível', 'Em pausa', 'Offline']);
      if (chance(0.3)) p.shiftExit = sorteio(['ended', 'missing', 'return']);
      if (chance(0.4)) p.presenceDate = DIA;
      if (chance(0.2)) p.returnForecast = { kind: 'next-shift' };
      if (chance(0.25)) p.presenceConfirmation = { reason: 'idle', requestedAt: iso(AGORA), deadlineAt: iso(AGORA + minutos(5)) };
      if (chance(0.2)) p.registrationActive = chance(0.5);
      const antes = chance(0.5) ? { id: 'ag1', tarotId: 'reader', clientId: 'cx', date: DIA, scheduledTime: '10:00' } : undefined;
      const alvo = { tarotId: 'reader', clientId: sorteio(['cx', 'cy']), date: DIA, ...(chance(0.3) ? { scheduledTime: '10:00' } : {}) };
      casosPresenca.push({ perfil: p, antes: antes || null, alvo, escolha: pres.staffPresenceChoice(p, DIA), inicio: pres.presenceStartError(p, DIA, AGORA), admissao: pres.presenceAdmissionError(p, antes, alvo, AGORA) });
    }

    const saida = path.join(__dirname, 'apoio-gf-painel', 'ouro-fila-geral.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'general-reservations.ts, panel-flow-model.ts, reader-continuation.ts, agenda-intake-model.ts, staff-presence-model.ts, agenda-common-deadlines.ts do front', dia: DIA, casos, casosAdmissao, casosPresenca }, null, 1)}\n`);
    console.log(`OK: ${casos.length} casos de fila, ${casosAdmissao.length} de admissão, ${casosPresenca.length} de presença (reservou ${reservouOk}, encaminhou ${roteouOk}) -> ${path.relative(process.cwd(), saida)}`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
