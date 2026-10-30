'use strict';

/**
 * Cenários do ouro da derivação das Pendências (Maturacao/35): consultas, agenda, pagamentos e divergências sorteados com semente fixa.
 * `antes` é o mundo em que as pendências nasceram; `depois` é o mundo atual (encerrou consulta, pagou, resolveu divergência, apagou a agenda...).
 * Sem relógio nem aleatoriedade do ambiente. Mudar este arquivo muda o ouro (gere de novo).
 */

function semente(n) {
  let a = n >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clonar = (x) => JSON.parse(JSON.stringify(x));

function cenario(k, dia) {
  const rnd = semente(20261130 + k * 7919);
  const sorteio = () => rnd();
  const um = (l) => l[Math.floor(rnd() * l.length)];
  const chance = (p) => rnd() < p;
  const base = Date.parse(`${dia}T12:00:00-03:00`);
  const iso = (min) => new Date(base + min * 60000).toISOString();
  const clientes = ['9001', '9002', '9003', '9004'];
  const consultas = []; const agenda = []; const pagamentos = []; const divergencias = [];

  const nC = 2 + Math.floor(rnd() * 6);
  for (let i = 0; i < nC; i += 1) {
    const status = um(['Em curso', 'Em curso', 'Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Desistiu', 'Anulada', 'Devolvida', 'Não houve']);
    const clientId = um(clientes);
    const c = { id: `K${k}-${i}`, clientId, client: `Cliente ${clientId}`, tarotId: um(['t1', 't2']), tarot: 'Taróloga', status, startedAt: iso(-Math.floor(rnd() * 90) - (chance(0.15) ? 1500 : 0)), durationSeconds: 600, audit: [] };
    if (status !== 'Em curso') c.endedAt = iso(-5);
    if (chance(0.3)) c.tarologistFinishReport = { submittedAt: iso(-8), minutes: 10 + Math.floor(rnd() * 20), ...(chance(0.2) ? { endedAt: iso(-8) } : {}) };
    if (chance(0.2)) c.finishReview = { at: iso(-3) };
    if (chance(0.15)) c.finishCorrections = [{ status: um(['pending', 'done']) }];
    if (chance(0.15)) c.cancellationReview = { status: um(['pending', 'pending', 'unpaid', 'paid']), requestedAt: iso(-20), complaint: 'Cliente reclamou.' };
    if (chance(0.5)) c.paymentDisposition = um(['Sem pagamento', 'Pago', 'Crédito']);
    if (chance(0.2)) c.coverage = { kind: 'Crédito', minutes: 20 };
    if (chance(0.2)) c.billing = { funding: [{ paymentId: `P${k}-0` }] };
    if (chance(0.1)) c.migrationPending = true;
    if (chance(0.15)) c.tarologistStartedAt = iso(-40);
    consultas.push(c);
  }
  const nA = 1 + Math.floor(rnd() * 5);
  for (let i = 0; i < nA; i += 1) {
    const clientId = um(clientes);
    const data = chance(0.75) ? dia : um(['2026-10-11', '2026-10-13']);
    const a = { id: `A${k}-${i}`, clientId, client: `Cliente ${clientId}`, tarotId: um(['t1', 't2', 'afila']), date: data, time: '09:00', createdAt: iso(-200 - Math.floor(rnd() * 100)), position: i + 1, contact: { attempt: 1, date: data, tags: [] }, contactHistory: [] };
    if (chance(0.5)) a.paymentExpectedAmount = um([0, 50, 88.8, 120.5]);
    if (chance(0.3)) a.paymentPending = true;
    if (chance(0.15)) a.workflowStatus = um(['Em consulta', 'Concluída', 'Avisada']);
    if (chance(0.1)) a.agendaOutcome = 'Cancelada';
    if (chance(0.15)) a.resolutionHistory = [{ action: um(['Agendamento mantido', 'Correspondência invalidada', 'Agendamento editado']), consultationId: um(consultas).id }];
    if (chance(0.15)) a.standbyDate = '2026-10-11';
    if (chance(0.15)) a.resolvedByConsultationId = um(consultas).id;
    agenda.push(a);
  }
  for (const c of consultas) if (chance(0.35)) c.agendaItemId = um(agenda).id;
  const nP = Math.floor(rnd() * 5);
  for (let i = 0; i < nP; i += 1) {
    const p = { id: `P${k}-${i}`, clientId: um(clientes), client: 'Cliente', amount: um([29.6, 59.2, 88.8, 120]), status: um(['Informado', 'Informado', 'Pendente', 'Cancelado', 'Corrigido']), paidAt: iso(-300), informedAt: iso(-300) };
    if (chance(0.5)) p.confirmation = um(['Confirmado', 'A confirmar']);
    if (chance(0.35)) p.linkedConsultationId = um(consultas).id;
    if (chance(0.15)) p.movements = [{ id: `M${i}`, kind: um(['refund', 'adjust']), amount: 10, bankEffect: -10, creditEffect: -10, occurredAt: iso(-100) }];
    pagamentos.push(p);
  }
  const nD = Math.floor(rnd() * 4);
  for (let i = 0; i < nD; i += 1) {
    const clientId = um(clientes);
    const d = { id: `D${k}-${i}`, kind: um(['Operacional', 'Financeira']), status: um(['Pendente', 'Em conferência', 'Resolvida']), createdAt: iso(-500 + i), client: `Cliente ${clientId}`, reason: 'Motivo.', reportedBy: 'Osíris', ...(chance(0.7) ? { clientId } : {}) };
    if (chance(0.4)) d.issueType = 'Minutagem incorreta';
    if (chance(0.4)) { d.reportedMinutes = 25; d.recordedMinutes = chance(0.7) ? 20 : undefined; d.tarot = 'Osíris'; }
    if (chance(0.1)) d.deletedAt = iso(-50);
    divergencias.push(d);
  }
  const antes = clonar({ consultas, agenda, pagamentos, divergencias });
  // O mundo muda: alguns encerram, pagam, resolvem ou somem.
  const depois = clonar(antes);
  depois.consultas = depois.consultas.filter(() => !chance(0.12)).map((c) => (chance(0.25) ? { ...c, status: 'Concluída', endedAt: iso(-1), finishReview: { at: iso(-1) }, cancellationReview: c.cancellationReview ? { ...c.cancellationReview, status: 'paid' } : undefined } : c));
  depois.agenda = depois.agenda.filter(() => !chance(0.12)).map((a) => (chance(0.2) ? { ...a, agendaOutcome: 'Cancelada' } : a));
  depois.divergencias = depois.divergencias.map((d) => (chance(0.3) ? { ...d, status: 'Resolvida' } : d));
  if (chance(0.3)) depois.pagamentos = depois.pagamentos.map((p) => ({ ...p, status: 'Informado', confirmation: 'Confirmado' }));
  depois.consultas = depois.consultas.map((c) => JSON.parse(JSON.stringify(c)));
  return { antes, depois, sorteio };
}

module.exports = { cenario };
