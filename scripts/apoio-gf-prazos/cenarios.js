'use strict';

/**
 * Cenários dos prazos de atendimento (Maturacao/56 grupo D): geração determinística (semente fixa) de entradas centradas nas BORDAS de 5:00, 10:00 e 15:00,
 * na virada do dia operacional (06:00) e na viragem de dia civil. Usado só pelo gerador do ouro; o verificador lê o JSON gravado.
 */

let semente = 20261102;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;
const inteiro = (n) => Math.floor(aleatorio() * n);
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const diaOp = (ms) => new Date(ms - 9 * 3600000).toISOString().slice(0, 10);
const somar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const relogio = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);
const clonar = (v) => JSON.parse(JSON.stringify(v));

/** Instantes de relógio: meio do dia, antes/depois de 06:00, virada de dia civil e fim do turno da madrugada. */
const AGORAS = ['2026-10-12T10:00:00-03:00', '2026-10-12T05:55:00-03:00', '2026-10-12T06:00:00-03:00', '2026-10-12T06:04:59-03:00', '2026-10-13T00:03:00-03:00', '2026-10-12T23:58:00-03:00', '2026-10-12T14:20:30-03:00', '2026-03-01T03:30:00-03:00'].map(Date.parse);
/** Atrasos (ms) em torno de 5:00, 10:00 e 15:00, e valores comuns; um futuro (-1 s) e o instante exato (0). */
const ATRASOS = [0, 1, 999, 1000, 59999, 60000, 299999, 300000, 300001, 299000, 301000, 599999, 600000, 600001, 599000, 601000, 899999, 900000, 900001, 1800000, 3600000, 7200000, -1000, -1];

const evento = (item, tag, em, dia, extra = {}) => ({ id: `${item.id}-${tag}-${em}`, actor: 'Equipe', at: iso(em), date: dia, attempt: item.contact.attempt, tag, active: true, before: [], after: [tag], ...extra });

function cliente(i, agora, dia) {
  const id = `ag${i}`; const item = { id, clientId: `c${i}`, client: `Cliente ${i}`, tarotId: sorteio(['r1', 'r2', 'afila']), date: dia, time: '09:00', createdAt: iso(agora - 3 * 3600000), channel: 'Telefone', observation: '', response: 'Aguardando resposta', position: i + 1, contact: { attempt: 1, date: dia, tags: [] }, contactHistory: [] };
  const pilha = sorteio([['Avisada'], ['Avisada'], ['Vai pagar'], ['Vai pagar'], ['Avisada', 'Pode agora'], ['Pode agora'], ['Avisada', 'Vai pagar'], ['Não respondeu'], ['Chama depois'], ['Cliente vai chamar'], ['Não voltou'], []]);
  item.contact = { attempt: 1, date: chance(0.93) ? dia : somar(dia, -1), tags: pilha };
  const base = agora - sorteio(ATRASOS);
  item.contactHistory = pilha.map((t, k) => evento(item, t, k === 0 ? base : base + k * 1000, item.contact.date, { after: pilha.slice(0, k + 1) }));
  if (chance(0.15)) item.contactHistory.push(evento(item, sorteio(['Pode agora', 'Vai pagar', 'Pago', 'Avisar de novo']), base + sorteio([1, 1000, 30000, 200000]), item.contact.date, { before: sorteio([[], ['Vai pagar'], ['Pode agora']]), after: [] }));
  if (chance(0.06)) item.contactHistory.forEach((e) => { e.active = chance(0.5); });
  if (chance(0.12)) item.contactPlan = sorteio([{ who: 'client', timing: 'none' }, { who: 'staff', timing: 'exact', time: relogio(agora - 30 * MIN), callback: true }, { who: 'staff', timing: 'after', time: relogio(agora + sorteio([-1, 1, 14, 15, 16]) * MIN) }]);
  if (chance(0.1)) item.scheduledTime = relogio(agora + sorteio([-61, -16, -15, -1, 0, 1, 5, 15, 16, 60]) * MIN);
  if (chance(0.05)) item.workflowStatus = sorteio(['Em consulta', 'Concluída', 'Avisada']);
  if (chance(0.04)) { item.agendaOutcome = 'Cancelada'; }
  if (chance(0.06)) item.queueDeferral = { attempt: 1, at: iso(agora - 5 * MIN), by: 'Equipe', reason: 'Chama depois' };
  if (chance(0.05)) item.date = somar(dia, sorteio([-1, 1]));
  if (chance(0.05)) item.createdAt = iso(agora + 10 * MIN);
  if (chance(0.05)) item.standbyDate = dia;
  if (chance(0.45)) {
    const minutos = sorteio([1, 2, 5, 10, 20, 30, 1440, 1441, 0, 2.5]); const em = base + sorteio([-1000, 0, 1, 1000, 60000, 120000]);
    const anterior = item.contactHistory[item.contactHistory.length - 1];
    item.requestedWaitHistory = [{ id: `wait-${id}-${em}`, minutes: minutos, at: iso(em), by: 'Equipe', attempt: chance(0.9) ? 1 : 2, afterEventId: chance(0.7) && anterior ? anterior.id : chance(0.5) ? '' : 'inexistente' }];
    if (chance(0.15)) item.requestedWaitHistory.unshift({ id: `wait-old-${id}`, minutes: 3, at: iso(base - 60000), by: 'Equipe', attempt: 1 });
  } else if (chance(0.08)) item.queuePaymentWait = { requestedMinutes: sorteio([5, 15]), requestedAt: iso(base + 1000), by: 'Equipe' };
  return item;
}

function consulta(i, item, agora, dia) {
  return { id: `k${i}`, clientId: chance(0.5) ? item.clientId : `outra${i}`, client: 'Cliente', tarotId: sorteio(['r1', 'r2']), tarot: 'Leitora', status: sorteio(['Em curso', 'Em curso', 'Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Devolvida']), startedAt: iso(agora - 30 * MIN), durationSeconds: 600, audit: [],
    agendaItemId: chance(0.4) ? item.id : undefined, ...(chance(0.2) ? { tarologistFinishReport: { submittedAt: iso(agora - 3 * MIN), minutes: 10, clientWantsMoreTime: chance(0.5), reporterName: 'Leitora' } } : {}) };
}

function pagamentos(item, base, agora, consultas) {
  const lista = [];
  const n = chance(0.45) ? 1 + inteiro(2) : 0;
  for (let j = 0; j < n; j += 1) {
    const informado = base + sorteio([-60000, -1, 0, 1, 1000, 60000, 400000, 700000]); const p = { id: `p${item.id}-${j}`, clientId: chance(0.9) ? item.clientId : 'outra-cli', client: 'C', amount: sorteio([44.4, 88.8, 20, 0, 150]), status: sorteio(['Informado', 'Informado', 'Corrigido', 'Cancelado', 'Pendente']), method: 'PIX', paidAt: iso(informado), informedAt: iso(chance(0.97) ? informado : agora + 1000) };
    if (chance(0.3)) p.confirmation = sorteio(['Confirmado', 'A confirmar']);
    if (chance(0.15) && consultas.length) p.linkedConsultationId = sorteio(consultas).id;
    lista.push(p);
  }
  return lista;
}

function perfilDaCliente() { return chance(0.7) ? undefined : { id: 'x', name: 'Nome', credit: sorteio([0, 20, 44.4]), movements: [], ...(chance(0.3) ? { paymentProfile: 'Pós-pago' } : {}) }; }

/** Entrada completa de um caso de espera/painel (sem o resultado). */
function casoDeEspera(n) {
  const agora = sorteio(AGORAS) + (chance(0.4) ? inteiro(120) * 1000 : 0); const dia = diaOp(agora); const date = chance(0.9) ? dia : somar(dia, sorteio([-1, 1]));
  const item = cliente(n, agora, dia); const outros = chance(0.3) ? [cliente(n + 1000, agora, dia)] : [];
  if (outros[0] && chance(0.6)) outros[0].clientId = item.clientId;
  const agenda = [item, ...outros];
  const consultations = Array.from({ length: inteiro(4) }, (_, i) => consulta(i + 1, item, agora, dia));
  const base = Date.parse((item.contactHistory[0] || { at: iso(agora) }).at);
  const continuacao = chance(0.18);
  if (continuacao) {
    const origem = { id: 'korigem', clientId: item.clientId, client: 'Cliente', tarotId: item.tarotId === 'afila' ? 'r1' : item.tarotId, tarot: 'Leitora', status: 'Concluída', startedAt: iso(agora - 90 * MIN), endedAt: iso(agora - 40 * MIN), durationSeconds: 1200, audit: [],
      tarologistMoreTimeRequest: { active: true, requestedAt: iso(agora - 50 * MIN), reporterName: 'Leitora', ...(chance(0.12) ? { suspended: { tag: 'Chama depois', at: iso(agora - 20 * MIN), by: 'x' } } : {}), ...(chance(0.06) ? { archived: true } : {}), ...(chance(0.06) ? { reservationRelease: { reason: 'manual', at: iso(agora) } } : {}) } };
    consultations.push(origem); item.continuationRequest = { sourceConsultationId: 'korigem', requestedAt: iso(agora - 50 * MIN), requestedBy: 'Leitora' };
  }
  const payments = agenda.flatMap((a) => pagamentos(a, base, agora, consultations));
  return { agora, entrada: { agenda, consultations, payments, date, now: agora }, item: item.id, perfil: perfilDaCliente() || null, continuacao };
}

const SEMANA = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
/** Caso de fim de turno: o `now` fica em torno de 15 min do fim de um período. */
function casoDeTurno(n) {
  const dia = sorteio(['2026-10-12', '2026-10-13', '2026-12-20', '2026-03-01']); const horas = sorteio(['9h às 18h', '0h às 23h', '22h às 6h', '9h às 12h e 14h às 18h', 'Folga', 'Horário não informado', '8h às 17h30', '18h às 6h']);
  const perfil = { id: 'r1', name: 'Ana', online: true, status: 'Disponível', official: [], today: '', note: '', weeklySchedule: Object.fromEntries(SEMANA.map((d) => [d, chance(0.8) ? horas : sorteio(['Folga', '9h às 18h']) ])) };
  if (chance(0.3)) perfil.presenceConfirmedAt = iso(Date.parse(`${dia}T10:00:00-03:00`));
  if (chance(0.2)) perfil.shiftAvailableSince = iso(Date.parse(`${dia}T09:00:00-03:00`));
  if (chance(0.25)) perfil.presenceDate = chance(0.5) ? dia : somar(dia, -1);
  const fim = sorteio(['18:00', '23:00', '06:00', '12:00', '17:30']); const fimMs = Date.parse(`${dia}T${fim}:00-03:00`) + (fim === '06:00' ? 86400000 : 0);
  if (chance(0.2)) { perfil.shiftExit = 'return'; perfil.presenceDate = dia; perfil.expectedReturn = iso(fimMs - 3 * 3600000); perfil.returnUntil = iso(fimMs); if (chance(0.5)) perfil.returnForecast = { kind: sorteio(['exact', 'next-shift']), scheduleDate: dia }; }
  if (chance(0.2)) perfil.presenceConfirmedPeriod = { date: sorteio([dia, dia, somar(dia, -1)]), startAt: iso(fimMs - 4 * 3600000), endAt: iso(fimMs + sorteio([0, 15 * MIN, -MIN])) };
  const overrides = chance(0.2) ? { 'r1:2026': { startDate: dia, endDate: dia, absenceType: sorteio(['Nenhuma', 'Férias']), todayHours: sorteio(['9h às 18h', 'Folga', '10h às 20h']), updatedAt: iso(fimMs - 6 * 3600000), tarotId: 'r1' } } : {};
  const ref = sorteio([fimMs, fimMs, Date.parse(`${dia}T09:00:00-03:00`), Date.parse(`${dia}T14:00:00-03:00`)]);
  const now = ref - sorteio([0, 1, 999, 1000, 60000, 899999, 900000, 900001, 840000, 59999, -1, -60000, 3600000, 14 * MIN + 30000]);
  const dataConsulta = chance(0.88) ? dia : somar(dia, sorteio([-1, 1]));
  return { perfil, overrides, date: dataConsulta, now };
}

module.exports = { AGORAS, ATRASOS, casoDeEspera, casoDeTurno, aleatorio, sorteio, chance, inteiro, clonar, iso, MIN };
