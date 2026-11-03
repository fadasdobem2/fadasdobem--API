'use strict';

/**
 * Gera o OURO do agendamento direto e do fechamento de turno da Agenda (Maturacao/56, grupo C: C1 e C3) A PARTIR DO CÓDIGO REAL DO FRONT:
 *   node scripts/gerar-ouro-gf-agenda-direto.js --front=<pasta do FRONT com node_modules>
 * Grava scripts/apoio-gf-agenda/ouro-agenda-direto.json. Todo valor é fictício; relógio de São Paulo, sem o calendário de demonstração.
 *   - `direto`: a ordem de checagem de `submitSchedule` (agenda-experience.tsx:1085-1131) chamando as funções REAIS do front (`agendaClientChangeError`,
 *     `isAttendanceRestricted`, `validClock`, `currentIntake`, `intakeAdmissionError`, `presenceAdmissionError`, `requestAppointment`,
 *     `scheduleFormAgreementChanged`). A ordem é a única parte transcrita; cada regra é a função do front.
 *   - `turno`: `currentClosurePeriod` (agenda-intake-context.tsx:35-48), transcrito com `professionalPeriodsOnDate`, `professionalPeriodTimestamps`
 *     e `presenceClock` reais.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

let semente = 20261102;
const alea = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(alea() * l.length)];
const chance = (p) => alea() < p;
const sp = (dia, hhmm) => Date.parse(`${dia}T${hhmm}:00-03:00`);
const iso = (ms) => new Date(ms).toISOString();
const soma = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const HORAS = ['09:00', '10:30', '13:00', '17:45', '19:00', '20:30', '21:15', '22:00', '23:30', '01:15', '05:50', '06:00', '25:00', '9h30', ''];

function gerarDireto(m) {
  const casos = [];
  for (let k = 0; k < 600; k += 1) {
    const dia = sorteio(['2026-11-02', '2026-11-04', '2026-11-09']);
    const now = sp(dia, sorteio(['05:30', '09:00', '14:20', '19:45', '21:10', '23:55', '02:30']));
    const hoje = m.cal.operationToday(now);
    const tarotId = sorteio(['osiris', 'nyx', 'afila']);
    const outro = tarotId === 'osiris' ? 'nyx' : 'osiris';
    const clientId = `${900000 + Math.floor(alea() * 4)}`;
    const editando = chance(0.55);
    let antes;
    if (editando) {
      antes = { id: 'ag-1', tarotId: chance(0.7) ? tarotId : outro, clientId: chance(0.85) ? clientId : `${900000 + Math.floor(alea() * 4)}`, client: 'Cliente', date: chance(0.2) ? soma(hoje, -1) : soma(hoje, Math.floor(alea() * 3)),
        time: '10:00', channel: 'WhatsApp', position: 1, response: 'Aguardando resposta', contact: { attempt: 1, date: hoje, tags: chance(0.3) ? ['Próximo turno'] : [] } };
      if (chance(0.25)) antes.standbyDate = hoje;
      if (chance(0.3)) antes.scheduledTime = sorteio(['10:00', '21:00']);
      if (chance(0.15)) { antes.contactPlan = { who: 'staff', timing: 'exact', time: antes.scheduledTime || '19:00' }; antes.scheduledTime = antes.contactPlan.time; }
    }
    const timing = sorteio(['none', 'exact', 'exact', 'approximate', 'after']);
    const hora = sorteio(HORAS);
    const plano = { who: 'staff', timing, ...(timing === 'none' ? {} : { time: /^([01]\d|2[0-3]):[0-5]\d$/.test(hora) ? hora : '20:00' }) };
    // O formulário só deixa digitar um horário marcado inválido no campo "exato"; o plano normalizado nunca o leva (por isso 25:00 vai direto).
    const exato = timing === 'exact' ? (chance(0.12) ? sorteio(['25:00', '9h30', '24:61', '24:00']) : plano.time) : '';
    const form = { clientId, tarotId: chance(0.8) ? tarotId : outro, date: soma(hoje, sorteio([-2, -1, 0, 0, 0, 1, 1, 2, 5])), scheduledTime: exato };
    if (chance(0.15)) form.standbyDate = chance(0.7) ? hoje : soma(hoje, 1);
    const restricoes = chance(0.08) ? [{ id: 'r1', clientId, tarotId: form.tarotId, active: chance(0.85) }] : [];
    const perfil = { id: form.tarotId, name: form.tarotId === 'osiris' ? 'Osíris' : 'Nyx', registrationActive: chance(0.8) };
    const eventos = [];
    if (chance(0.55)) {
      const modo = sorteio(['no_more', 'no_more', 'on_return', 'until_end', 'open']);
      const e = { id: 'ev-1', tarotId: form.tarotId, date: chance(0.85) ? (form.standbyDate || form.date) : hoje, mode: modo, at: iso(now - 3600000), by: 'Khloe', consultationIds: [] };
      if (modo === 'no_more') {
        e.closeScope = sorteio(['shift', 'day']);
        e.closedUntil = e.closeScope === 'shift' ? iso(now + sorteio([-1, 1, 2]) * 3600000) : iso(sp(soma(e.date, 1), '06:00'));
        if (e.closeScope === 'shift') e.endTime = sorteio(['22:00', '23:30', '01:00']);
        e.agendaIds = chance(0.4) ? [antes ? antes.id : 'ag-x'] : [];
      }
      if (modo === 'on_return') { e.returnTime = sorteio(['19:00', '21:00', '23:00']); e.endTime = sorteio(['22:00', '01:00', '06:00']); }
      if (modo === 'until_end') e.endTime = sorteio(['20:00', '23:00']);
      eventos.push(e);
    }
    const pedido = chance(0.15) ? { id: 'rq-1', tarotId: chance(0.8) ? form.tarotId : outro, clientId: chance(0.85) ? clientId : '900099', client: 'Cliente', date: hoje, at: iso(now), note: '', ...(chance(0.2) ? { agendaId: 'ag-z' } : {}) } : undefined;
    const agenda = [];
    if (pedido && chance(0.5)) agenda.push({ id: 'ag-z', tarotId: pedido.tarotId, clientId: pedido.clientId, date: sorteio([hoje, soma(hoje, 1)]), client: 'C', time: '10:00', channel: 'WhatsApp', position: 1, response: 'Aguardando resposta', contact: { attempt: 1, date: hoje, tags: chance(0.2) ? ['Cancelada'] : [] }, ...(chance(0.3) ? { requestId: pedido.id } : {}), ...(chance(0.2) ? { agendaOutcome: 'Cancelada' } : {}) });
    const consultas = chance(0.25) ? [{ id: 'c1', agendaItemId: 'ag-1', status: sorteio(['Em curso', 'Concluída']), tarotId: form.tarotId }] : [];
    casos.push({ now, hoje, antes: antes || null, form, plano, restricoes, perfil, eventos, pedido: pedido || null, agenda, consultas, esperado: m.referencia(m, { now, hoje, antes, form, plano, restricoes, perfil, eventos, pedido, agenda, consultas }) });
  }
  return casos;
}

function gerarTurno(m) {
  const casos = [];
  const DIA = '2026-11-04';
  for (let k = 0; k < 160; k += 1) {
    const now = sp(DIA, sorteio(['00:30', '05:50', '08:00', '09:00', '09:30', '18:00', '18:00', '12:00', '14:59', '15:00', '18:00', '21:45', '23:59', '02:10'])) + (chance(0.3) ? 24 * 3600000 : 0);
    const data = m.cal.operationToday(now);
    const semana = { quarta: sorteio(['9h às 15h', '18h às 23h', '9h às 12h · 18h às 23h', 'Folga', '22h às 06h', 'Horário não informado']), quinta: sorteio(['10h às 18h', '19h às 02h']) };
    const perfil = { id: 'osiris', name: 'Osíris', official: [], today: '', note: '', status: 'Disponível', online: true, weeklySchedule: semana, shiftStatus: 'Disponível', presenceDate: data, presenceHistory: [] };
    if (chance(0.3)) perfil.presenceConfirmedPeriod = { date: sorteio([data, soma(data, -1)]), startAt: iso(now - sorteio([0, 1, 3]) * 3600000), endAt: iso(now + sorteio([-1, 1, 4]) * 3600000) };
    if (chance(0.2)) Object.assign(perfil, { shiftExit: 'return', expectedReturn: iso(now - 3600000), returnUntil: iso(now + sorteio([-0.5, 2]) * 3600000), shiftStatus: 'Offline', online: false });
    const excecoes = chance(0.3) ? { [`osiris@${data}`]: { todayHours: '9h às 12h', periods: [sorteio([{ start: '09:00', end: '12:00' }, { start: '17:00', end: '23:00' }])], note: '', updatedAt: '2026-11-01T10:00:00', absenceType: chance(0.2) ? 'Férias' : 'Nenhuma', startDate: data, endDate: data } } : {};
    if (excecoes[`osiris@${data}`] && excecoes[`osiris@${data}`].absenceType !== 'Nenhuma') excecoes[`osiris@${data}`].periods = [];
    casos.push({ now, data, perfil, excecoes, esperado: m.turno(m, perfil, excecoes, data, now) });
  }
  return casos;
}

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error', cacheDir: '/private/tmp/fadas-ouro-agenda-direto', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const l = (p) => vite.ssrLoadModule(p);
    const cal = await l('/features/domain/operation-calendar.ts');
    if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
    const intake = await l('/features/agenda/agenda-intake-model.ts');
    const presenca = await l('/features/tarologas/staff-presence-model.ts');
    const historia = await l('/features/agenda/agenda-history.ts');
    const restricoes = await l('/features/restricoes/restriction-model.ts');
    const tempo = await l('/features/shared/time-input.tsx');
    const forma = await l('/features/agenda/schedule-form-model.ts');
    const contato = await l('/features/agenda/agenda-contact.ts');
    const tarologas = await l('/features/tarologas/tarologist-presence.ts');
    const m = { cal, intake, presenca, historia, restricoes, tempo, forma, contato, tarologas };

    /** `submitSchedule`, caminho direto: devolve a PRIMEIRA recusa (ou ''), na ordem do código do front. */
    m.referencia = (mod, c) => {
      const { now, hoje, antes, form, plano, restricoes: rs, perfil, eventos, pedido, agenda, consultas } = c;
      const erroId = mod.historia.agendaClientChangeError(antes, form.clientId);
      if (erroId) return erroId;
      if ((!antes || antes.clientId !== form.clientId.trim() || antes.tarotId !== form.tarotId || (antes.date || hoje) !== form.date) && mod.restricoes.isAttendanceRestricted(rs, form.clientId.trim(), form.tarotId)) return 'Indisponível';
      if (form.scheduledTime && !mod.tempo.validClock(form.scheduledTime)) return 'Digite um horário válido, como 21:30, ou deixe em branco.';
      const alvo = { tarotId: form.tarotId, date: form.date, clientId: form.clientId.trim(), standbyDate: form.standbyDate, scheduledTime: form.scheduledTime };
      const admissao = mod.intake.intakeAdmissionError(mod.intake.currentIntake(eventos, form.tarotId, form.standbyDate || form.date, now), antes || undefined, alvo, now) || mod.presenca.presenceAdmissionError(perfil, antes || undefined, alvo, now);
      if (admissao) return admissao;
      const agendaCompleta = antes ? [antes, ...agenda] : agenda;
      if (pedido && ((!antes && pedido.tarotId !== form.tarotId) || pedido.clientId !== form.clientId.trim())) return 'Esta solicitação pertence à cliente e ao tarólogo informados. Abra um novo agendamento para outra pessoa.';
      if (pedido && !antes && mod.intake.requestAppointment(pedido, agenda)) return 'Esta solicitação já tem um agendamento. Abra o registro existente.';
      if (form.standbyDate && form.standbyDate !== form.date) return 'Se der hoje pertence à agenda de hoje. Confira a data.';
      if (!antes) return '';
      const mudaDestino = antes.tarotId !== form.tarotId || (antes.date || hoje) !== form.date;
      const proximoTurno = mod.contato.agendaContact(antes).tags.includes('Próximo turno') && form.tarotId === antes.tarotId;
      const mudou = mod.forma.scheduleFormAgreementChanged(antes, plano, form.tarotId, form.date, hoje, false);
      void agendaCompleta;
      if ((mudaDestino || mudou || proximoTurno) && consultas.some((x) => x.agendaItemId === 'ag-1' && x.status === 'Em curso')) return 'Finalize a consulta em andamento antes de mudar o agendamento.';
      if (mudaDestino && proximoTurno && form.date < hoje) return 'Escolha hoje ou uma data futura para o próximo turno.';
      return '';
    };
    /** `currentClosurePeriod` (agenda-intake-context.tsx:35-48) sem o calendário de demonstração. */
    m.turno = (mod, perfil, excecoes, data, now) => {
      const confirmado = perfil.presenceConfirmedPeriod;
      const explicito = confirmado && confirmado.date === data ? confirmado : perfil.presenceDate === data && perfil.expectedReturn && perfil.returnUntil ? { startAt: perfil.expectedReturn, endAt: perfil.returnUntil } : undefined;
      if (explicito && Date.parse(explicito.startAt) <= now && Date.parse(explicito.endAt) > now) {
        return { start: mod.presenca.presenceClock(explicito.startAt), end: mod.presenca.presenceClock(explicito.endAt), startsAt: Date.parse(explicito.startAt), endsAt: Date.parse(explicito.endAt) };
      }
      const periodos = mod.tarologas.professionalPeriodsOnDate(perfil, excecoes, data, now);
      const achado = mod.tarologas.professionalPeriodTimestamps(periodos, data).find((p) => p.startsAt <= now && p.endsAt > now);
      return achado ? { start: achado.start, end: achado.end, startsAt: achado.startsAt, endsAt: achado.endsAt } : null;
    };

    const direto = gerarDireto(m);
    const turno = gerarTurno(m);
    const destino = path.join(__dirname, 'apoio-gf-agenda', 'ouro-agenda-direto.json');
    fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (agenda-experience submitSchedule, agenda-intake-model, staff-presence-model, agenda-history, restriction-model, time-input, schedule-form-model, agenda-intake-context currentClosurePeriod)', direto, turno })}\n`);
    const recusas = new Set(direto.map((c) => c.esperado));
    console.log(`${direto.length} casos diretos (${recusas.size} desfechos distintos), ${turno.length} casos de turno (${turno.filter((c) => c.esperado).length} com turno vigente) em ${path.relative(process.cwd(), destino)}`);
    for (const r of recusas) console.log(`   - ${r || '(sem recusa)'} : ${direto.filter((c) => c.esperado === r).length}`);
  } finally { await vite.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
