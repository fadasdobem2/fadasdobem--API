'use strict';

/**
 * Gera o OURO do fluxo do painel (Maturacao/39) a partir do CÓDIGO REAL do front, com o relógio FIXO por caso (`Date.now` travado em `agora`):
 * `panelFlow` (equipe com `freeNow`, listas da fila geral), `generalQueueTiming`/`generalQueueGroup` e as validações
 * `validateGeneralMatch`, `validateGeneralConsultationLaunch`, `validateGeneralScheduling`. Grava em scripts/apoio-gf-painel/ouro-painel-fluxo.json.
 *   node scripts/gerar-ouro-gf-painel-fluxo.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { MUTANTES } = require('./apoio-gf-painel/mutantes-fluxo');
const { resumoDoFluxo } = require('./apoio-gf-painel/resumo-fluxo');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261124;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;
const inteiro = (n) => Math.floor(aleatorio() * n);

// Instantes que atravessam a virada do dia operacional (06:00-06:00, America/Sao_Paulo)
const AGORAS = ['2026-10-12T10:00:00-03:00', '2026-10-12T05:50:00-03:00', '2026-10-12T06:05:00-03:00', '2026-10-13T00:30:00-03:00', '2026-10-12T23:55:00-03:00', '2026-10-12T14:20:00-03:00'].map(Date.parse);
const iso = (ms) => new Date(ms).toISOString();
const minutos = (n) => n * 60000;
const diaOp = (ms) => new Date(ms - 9 * 3600000).toISOString().slice(0, 10);
const somar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const LEITORAS = ['r1', 'r2', 'r3'];
const relogio = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);

function evento(item, tag, em, dia, extra = {}) {
  return { id: `${item.id}-${tag}-${em}`, actor: 'Equipe', at: iso(em), date: dia, attempt: item.contact.attempt, tag, active: true, before: [], after: [tag], ...extra };
}

let FATOR = 1;
const raro = (p) => aleatorio() < p * FATOR;

function agendamento(i, agora, dia) {
  const id = `ag${i}`;
  const geral = chance(0.55);
  const item = { id, clientId: raro(0.12) ? `c${Math.max(0, i - 1)}` : `c${i}`, client: `Cliente ${i}`, tarotId: geral ? 'afila' : sorteio(LEITORAS), date: sorteio([dia, dia, dia, dia, somar(dia, 1), somar(dia, -1)]),
    time: sorteio(['09:00', '03:00', '10:30']), createdAt: iso(agora - minutos(10 + inteiro(400))), channel: 'Telefone', observation: '', response: 'Aguardando resposta', position: i + 1, contact: { attempt: 1, date: dia, tags: [] }, contactHistory: [] };
  if (chance(0.55)) {
    const tags = sorteio([['Avisada'], ['Pode agora'], ['Avisada', 'Pode agora'], ['Vai pagar'], ['Chama depois'], ['Não respondeu'], ['Não pode agora'], ['Cliente vai chamar'], ['Não voltou'], ['Próximo turno'], ['Chamar cliente']]);
    item.contact = { attempt: 1, date: chance(0.85) ? dia : somar(dia, -1), tags };
    item.contactHistory = tags.map((t, k) => evento(item, t, agora - minutos(30 - k), item.contact.date, { after: tags }));
  }
  if (geral && chance(0.5)) item.queueReservation = { tarotId: sorteio(LEITORAS), at: iso(agora - minutos(inteiro(40))), by: 'Equipe' };
  if (item.queueReservation && raro(0.15)) item.immediateReservationRelease = { tarotId: item.queueReservation.tarotId, date: item.date, scheduledTime: item.scheduledTime, requestedTime: item.requestedTime, at: iso(agora - minutos(2)), by: 'Equipe' };
  if (raro(0.25)) item.scheduledTime = sorteio(['09:30', '10:30', '14:00', '05:30', '23:50', '00:20', '06:00', '05:59']);
  // horários RELATIVOS ao relógio fixo: exercitam as fronteiras de 15 min (janela de espera), 'já passou' e o fim do turno, inclusive na virada das 06:00
  if (chance(0.3)) item.scheduledTime = relogio(agora + sorteio([-61, -16, -15, -1, 0, 1, 5, 14, 15, 16, 30, 59, 60]) * 60000);
  if (chance(0.15)) item.contactPlan = sorteio([{ who: 'staff', timing: 'shift', shift: { label: 'Agora', start: relogio(agora - sorteio([5, 30, 61]) * 60000), end: relogio(agora + sorteio([-1, 0, 1, 30]) * 60000) } },
    { who: 'staff', timing: 'after', time: relogio(agora + sorteio([-1, 0, 1, 14, 15, 16]) * 60000), callback: chance(0.5) }, { who: 'staff', timing: 'exact', time: relogio(agora + sorteio([-1, 0, 1, 15]) * 60000), callback: chance(0.5) }]);
  if (raro(0.1)) item.requestedTime = sorteio(['10h', 'de manhã', '11:15', '14h30']);
  if (raro(0.2)) {
    item.contactPlan = sorteio([{ who: 'client', timing: 'none' }, { who: 'staff', timing: 'exact', time: '10:30', callback: true }, { who: 'staff', timing: 'after', time: '09:00', callback: true }, { who: 'staff', timing: 'after', time: '15:00' },
      { who: 'staff', timing: 'shift', shift: { label: 'Manhã', start: '08:00', end: '09:30' } }, { who: 'staff', timing: 'shift', shift: { label: 'Noite', start: '22:00', end: '05:00' } }, { who: 'staff', timing: 'none' }, { who: 'staff', timing: 'approximate', time: '12:00' }]);
  }
  if (raro(0.12)) item.queueDeferral = { attempt: 1, at: iso(agora - minutos(5)), by: 'Equipe', reason: 'Chama depois' };
  if (raro(0.06)) item.workflowStatus = sorteio(['Em consulta', 'Concluída', 'Avisada']);
  if (raro(0.05)) { item.agendaOutcome = 'Cancelada'; item.contact = { attempt: 1, date: dia, tags: ['Cancelada'] }; }
  if (raro(0.1)) item.continuationRequest = { sourceConsultationId: sorteio(['k1', 'k2', 'k3']), requestedAt: iso(agora - minutos(40)), requestedBy: 'Equipe' };
  if (raro(0.1)) { item.contactHistory.push({ id: `common-call-timeout-${id}-1`, actor: 'Sistema', at: iso(agora - minutos(1 + inteiro(30))), date: dia, attempt: 1, tag: sorteio(['Não respondeu', 'Não voltou']), active: true, before: sorteio([['Avisada'], ['Pode agora']]), after: ['Não respondeu'] }); }
  if (raro(0.08)) item.standbyDate = dia;
  if (raro(0.06)) item.positionOverrides = { 'explicit:general': inteiro(5), [`yield:queue:${item.tarotId}`]: inteiro(5) };
  if (raro(0.07)) { delete item.createdAt; }
  return item;
}

function consulta(i, agenda, agora, dia) {
  const item = sorteio(agenda);
  const c = { id: `k${i}`, clientId: chance(0.35) ? item.clientId : `outra${i}`, client: 'Cliente', tarotId: sorteio(LEITORAS), tarot: 'Leitora', status: sorteio(['Em curso', 'Em curso', 'Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Devolvida']),
    startedAt: iso(agora - minutos(10 + inteiro(90))), durationSeconds: 600, audit: [], agendaItemId: chance(0.3) ? item.id : undefined, awaitingTarologistStart: chance(0.3) };
  if (raro(0.1)) c.startedAt = iso(agora - minutos(1500 + inteiro(600)));
  if (raro(0.1)) c.tarologistStartedAt = iso(agora - minutos(60));
  if (raro(0.06)) c.migrationPending = true;
  if (raro(0.15)) c.pauseHistory = [{ id: `p${i}`, startedAt: iso(agora - minutos(5)), startedBy: 'x', reason: 'x', ...(chance(0.4) ? { endedAt: iso(agora - minutos(1)) } : {}) }];
  if (raro(0.25)) c.tarologistFinishReport = { submittedAt: iso(agora - minutos(3)), minutes: 10, clientWantsMoreTime: raro(0.5), reporterName: 'Leitora' };
  if (raro(0.15)) c.finishReview = { at: iso(agora) };
  if (raro(0.3) && ['Concluída', 'Finalizada pelo tarólogo', 'Em curso'].includes(c.status)) {
    c.tarologistMoreTimeRequest = { active: chance(0.85), requestedAt: iso(agora - minutos(4 + inteiro(60))), reporterName: 'Leitora', ...(raro(0.15) ? { suspended: { tag: sorteio(['Não respondeu', 'Chama depois', 'Não pode agora']), at: iso(agora - minutos(2)), by: 'Equipe' } } : {}),
      ...(raro(0.1) ? { archived: true } : {}), ...(raro(0.08) ? { queueAdvance: { successorAgendaId: sorteio(agenda).id, at: iso(agora - minutos(1)), eventId: 'e1' } } : {}), ...(raro(0.08) ? { reservationRelease: { reason: 'manual', at: iso(agora) } } : {}),
      ...(raro(0.1) ? { notified: { at: iso(agora - minutos(3)), by: 'Equipe' } } : {}), ...(raro(0.1) ? { noResponse: { at: iso(agora - minutos(2)), by: 'Equipe' } } : {}) };
  }
  if (raro(0.15)) c.continuation = { sourceConsultationId: sorteio(['k1', 'k2']) };
  if (raro(0.06)) c.coverage = { kind: 'Complemento', sourceConsultationId: sorteio(['k1', 'k2']) };
  if (raro(0.05)) c.finishCorrections = [{ status: 'pending', minutes: 12, beforeMinutes: 10, reason: 'x' }];
  return c;
}

function pagamentosDoCaso(agenda, agora, dia) {
  const clientes = [...new Set(agenda.map((a) => a.clientId))];
  return Array.from({ length: inteiro(5) }, (_, i) => ({ id: `p${i}`, clientId: sorteio(clientes), client: 'C', amount: sorteio([44.4, 88.8, 35, 20]), status: 'Informado', method: 'PIX', paidAt: new Date(agora - inteiro(900) * 60000).toISOString(), informedAt: new Date(agora - 3600000).toISOString(), movements: [], audit: [], ...(chance(0.2) ? { confirmation: 'Aguardando' } : {}) }));
}

function perfil(id, agora, dia) {
  const p = { id, name: sorteio(['Ana', 'Álvaro', 'Bia', 'Cíntia', 'Zeca']), online: chance(0.8), status: sorteio(['Disponível', 'Disponível', 'Pausa', 'Em consulta']), official: [], today: '', note: '',
    weeklySchedule: Object.fromEntries(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].map((d) => [d, sorteio(['0h às 23h', '9h às 18h', 'Folga', '22h às 6h', 'Horário não informado'])])) };
  if (chance(0.7)) p.shiftStatus = sorteio(['Disponível', 'Disponível', 'Disponível', 'Em pausa', 'Offline']);
  if (raro(0.25)) p.shiftExit = sorteio(['ended', 'missing', 'return', 'shift-ended']);
  if (raro(0.4)) p.presenceDate = dia;
  if (raro(0.15)) p.returnForecast = { kind: 'next-shift', scheduleDate: dia };
  if (raro(0.2)) { p.presenceConfirmation = { reason: 'idle', requestedAt: iso(agora), deadlineAt: iso(agora + minutos(5)) }; }
  if (raro(0.1)) p.registrationActive = false;
  if (raro(0.15)) { p.expectedReturn = iso(agora + minutos(30)); p.returnUntil = iso(agora + minutos(300)); p.shiftExit = 'return'; p.presenceDate = dia; }
  if (raro(0.1)) p.presenceConfirmedPeriod = { date: dia, startAt: iso(agora - minutos(60)), endAt: iso(agora + minutos(120)) };
  return p;
}


async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-painel-fluxo', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateNow = Date.now;
  try {
    const fl = await vite.ssrLoadModule('/features/painel/panel-flow-model.ts');
    const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    const ids = (l) => (l || []).map((x) => x.id);
    const casos = []; let pulados = 0; const estat = { livre: 0, validacoesOk: 0, validacoesRecusa: 0, mutantes: 0, mutantesRecusados: 0 };
    for (let k = 0; k < 600; k += 1) {
      const agora = sorteio(AGORAS) + (chance(0.5) ? minutos(inteiro(30)) : 0);
      const dia = diaOp(agora);
      const date = chance(0.9) ? dia : somar(dia, sorteio([-1, 1]));
      Date.now = () => agora;
      FATOR = chance(0.5) ? 0.15 : 1;
      const agenda = Array.from({ length: 3 + inteiro(9) }, (_, i) => agendamento(i, agora, dia));
      const pagamentosFila = [];
      // modo "fila": várias clientes na fila própria da MESMA taróloga, prontas e pagas em ordens diferentes (exercita as comparações de ordem)
      if (chance(0.5)) {
        const donaDaFila = sorteio(['r1', 'r2']);
        agenda.forEach((a, i) => {
          if (a.tarotId === 'afila' && chance(0.7)) return;
          a.tarotId = donaDaFila; a.date = dia; delete a.scheduledTime; delete a.requestedTime; a.contactPlan = undefined; a.standbyDate = undefined; a.queueDeferral = undefined; a.agendaOutcome = undefined; a.workflowStatus = chance(0.9) ? undefined : a.workflowStatus;
          const tags = sorteio([['Pode agora'], ['Avisada'], ['Avisada', 'Pode agora'], ['Não respondeu'], ['Não pode agora'], [], ['Vai pagar']]);
          a.contact = { attempt: 1, date: dia, tags }; a.contactHistory = tags.map((t, j) => ({ id: `h${i}${j}`, actor: 'x', at: new Date(agora - 900000 + j * 1000).toISOString(), date: dia, attempt: 1, tag: t, active: true, before: [], after: tags }));
          if (tags.includes('Não respondeu') && chance(0.3)) a.contactHistory.push({ id: `common-call-timeout-${a.id}-1`, actor: 'Sistema', at: new Date(agora - 60000).toISOString(), date: dia, attempt: 1, tag: 'Não respondeu', active: true, before: ['Pode agora'], after: ['Não respondeu'] });
          if (chance(0.15)) a.positionOverrides = { [`explicit:queue:${donaDaFila}`]: inteiro(5) + 1 };
          if (chance(0.15)) a.positionOverrides = { ...a.positionOverrides, [`yield:queue:${donaDaFila}`]: inteiro(5) + 1 };
          if (chance(0.15)) a.queueReservation = { tarotId: donaDaFila, at: new Date(agora - 300000).toISOString(), by: 'x' };
          if (chance(0.2)) a.reservationClock = { active: true, tarotId: donaDaFila, startedAt: new Date(agora - 100000).toISOString() };
        });
        const comPagamento = agenda.filter(() => chance(0.6));
        comPagamento.forEach((a, i) => pagamentosFila.push({ id: `pf${i}`, clientId: a.clientId, client: 'C', amount: sorteio([44.4, 88.8, 20]), status: 'Informado', method: 'PIX', paidAt: new Date(agora - inteiro(600) * 60000).toISOString(), informedAt: new Date(agora - 3600000).toISOString(), movements: [], audit: [] }));
      }
      const consultations = Array.from({ length: inteiro(7) }, (_, i) => consulta(i + 1, agenda, agora, dia));
      const profiles = LEITORAS.slice(0, 2 + inteiro(2)).map((id) => perfil(id, agora, dia));
      const accounts = chance(0.2) ? [{ tarotId: 'r2', role: 'tarologa', active: false, access: sorteio(['Ativo', 'Acesso pendente', 'Bloqueado']) }] : [];
      const overrides = chance(0.25) ? { 'r1:2026': { startDate: dia, endDate: dia, absenceType: sorteio(['Nenhuma', 'Férias']), todayHours: sorteio(['9h às 18h', 'Folga']), updatedAt: iso(agora - minutos(10)), tarotId: 'r1' } } : {};
      const intakeEvents = chance(0.45) ? [{ id: 'ev1', tarotId: sorteio(LEITORAS), date: dia, mode: sorteio(['open', 'no_more', 'until_end', 'on_return', 'count']), at: iso(agora - minutos(inteiro(120))), by: 'Equipe', consultationIds: [], closeScope: sorteio(['shift', 'day', undefined]),
        closedUntil: chance(0.5) ? iso(agora + minutos(90)) : iso(agora - minutos(5)), endTime: sorteio(['12:00', '23:00', '03:00']), returnTime: sorteio(['09:00', '13:00', '23:00']), count: 2, agendaIds: chance(0.3) ? ['ag1'] : [] }] : [];
      const restrictions = chance(0.2) ? [{ id: 'rs1', clientId: sorteio(['c0', 'c1', 'c2', 'c3']), tarotId: sorteio(LEITORAS), active: chance(0.8) }] : [];
      const entrada = { agenda, consultations, payments: [...pagamentosDoCaso(agenda, agora, dia), ...pagamentosFila], profiles, accounts, overrides, date, now: agora, intakeEvents, restrictions };
      const caso = { agora, entrada: JSON.parse(JSON.stringify(entrada)) };
      const fluxo = tentar(() => fl.panelFlow(entrada));
      if (fluxo.erro) { pulados += 1; continue; }
      const f = fluxo.ok;
      caso.fluxo = resumoDoFluxo(f);
      caso.continuacoes = fl.panelContinuationReservations({ agenda, consultations, now: agora }).map((r) => [r.source.tarotId, r.source.id, r.item.id]).sort();
      caso.tempos = agenda.map((a) => { const t = fl.generalQueueTiming(a, date, agora); return { id: a.id, requestedAt: t.requestedAt, enteredAt: t.enteredAt, future: t.future, waitingWindow: t.waitingWindow, active: t.active, status: t.status, waitMs: t.waitMs, label: t.label, grupo: fl.generalQueueGroup(a, date, agora) }; });
      caso.validacoes = [];
      const geral = agenda.filter((a) => a.tarotId === 'afila');
      for (let v = 0; v < 5; v += 1) {
        const candidatos = f.generalAll.concat(f.futureGeneral);
        const alvo = chance(0.6) && candidatos.length ? sorteio(candidatos) : chance(0.9) && geral.length ? sorteio(geral) : sorteio(agenda);
        const tarotId = chance(0.5) && f.free.length ? sorteio(f.free).id : chance(0.93) ? sorteio(LEITORAS) : 'inexistente';
        const aprov = chance(0.3) ? { clientId: alvo.clientId, tarotId, consultationIds: consultations.filter((c) => c.status === 'Em curso').map((c) => c.id).slice(0, 2) } : undefined;
        const dataAg = chance(0.7) ? date : somar(date, sorteio([0, 1, 2])); const hora = chance(0.5) ? sorteio(['08:00', '10:00', '12:30', '02:00', '23:30']) : undefined;
        const r = { item: alvo.id, tarotId, aprov: aprov || null, dataAg, hora: hora || null,
          encaminhar: tentar(() => { fl.validateGeneralMatch(entrada, alvo.id, tarotId, aprov); return true; }),
          lancar: tentar(() => { fl.validateGeneralConsultationLaunch(entrada, alvo.id, tarotId, aprov); return true; }),
          agendar: tentar(() => { fl.validateGeneralScheduling(entrada, alvo.id, tarotId, dataAg, hora); return true; }) };
        for (const n of ['encaminhar', 'lancar', 'agendar']) { if (r[n].ok) estat.validacoesOk += 1; else estat.validacoesRecusa += 1; }
        caso.validacoes.push(r);
      }
      // mutantes: parte de um destino que o front ACEITA e o corrompe; o front passa a recusar e o servidor tem de recusar com a mesma frase
      caso.mutantes = [];
      for (const x of caso.validacoes) {
        for (const tipo of ['encaminhar', 'lancar', 'agendar']) {
          if (!x[tipo].ok || !chance(0.5)) continue;
          const nome = sorteio(Object.keys(MUTANTES)); const alvoMut = { item: x.item, tarotId: nome === 'leitora_inexistente' ? 'inexistente' : x.tarotId };
          const mutada = MUTANTES[nome](entrada, alvoMut);
          const res = tentar(() => {
            if (tipo === 'encaminhar') fl.validateGeneralMatch(mutada, alvoMut.item, alvoMut.tarotId, x.aprov || undefined);
            else if (tipo === 'lancar') fl.validateGeneralConsultationLaunch(mutada, alvoMut.item, alvoMut.tarotId, x.aprov || undefined);
            else fl.validateGeneralScheduling(mutada, alvoMut.item, alvoMut.tarotId, x.dataAg, x.hora || undefined);
            return true;
          });
          caso.mutantes.push({ nome, tipo, item: alvoMut.item, tarotId: alvoMut.tarotId, aprov: x.aprov, dataAg: x.dataAg, hora: x.hora, front: res });
          estat.mutantes += 1; if (!res.ok) estat.mutantesRecusados += 1;
        }
      }
      estat.livre += f.team.filter((r) => r.freeNow).length;
      casos.push(caso);
    }
    Date.now = dateNow;
    const saida = path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-fluxo.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'panel-flow-model.ts (panelFlow, generalQueueTiming, validateGeneral*), panel-model.ts, general-reservations.ts, reader-continuation.ts, more-time-agenda.ts, agenda-intake-model.ts, staff-presence-model.ts do front, com Date.now travado por caso', casos })}\n`);
    console.log(`OK: ${casos.length} casos (pulados ${pulados} onde o front lançou), ${estat.livre} leitoras livres, ${estat.validacoesOk} validações aceitas, ${estat.validacoesRecusa} recusadas, ${estat.mutantes} mutantes (${estat.mutantesRecusados} recusados pelo front) -> ${path.relative(process.cwd(), saida)}`);
  } finally { Date.now = dateNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
