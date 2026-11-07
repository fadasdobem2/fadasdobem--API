'use strict';

/**
 * execute da agenda: schedule (fila geral e tarólogo) com o payload EXATO do motor (engine.mjs:623), remove_appointment e reschedule.
 * A Lilly lê `committed` (runtime.mjs:650) e `result.id`/`result.position` (engine.mjs:937) e re-lê o snapshot (appointment(), engine.mjs:105).
 */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, consulta, contar, IntegrationError, importar }) => {
  const { acao, autorizar, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  const motor = await importar('engine.mjs');
  const operacional = (await adapter.snapshot({ id: 'umbler:O1', type: 'message', actor: 'client', conversationId: 'chat-E', clientId: '900105', at: AGORA.toISOString(), data: {} })).operationalDate;
  const soma = (d, k) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const sch = (clientId, conv, tarologistId, extra = {}) => acao('schedule', { conversationId: conv, clientId, tarologistId, payload: { reason: 'staff_command', confirmed: true, position: 'last', preserveQueue: true, ...extra } });
  const snap = (clientId, conv) => adapter.snapshot({ id: `umbler:S${Math.random()}`, type: 'message', actor: 'client', conversationId: conv, clientId, at: new Date().toISOString(), data: {} });

  log('execute: schedule / remove_appointment / reschedule');
  let geral; let aGeral;
  await passo('schedule fila geral: {committed:true, result:{id, position}}; a Lilly acha o agendamento no snapshot seguinte (engine.mjs:105)', async () => {
    aGeral = sch('900105', 'chat-E', 'afila');
    const x = await adapter.execute(aGeral);
    geral = x.result;
    conferir('committed === true (runtime.mjs:650)', x.committed === true);
    conferir('result.id (AG-...) e position inteira (engine.mjs:937)', /^AG-/.test(geral.id) && Number.isInteger(geral.position) && geral.position >= 2, JSON.stringify(geral));
    const s = await snap('900105', 'chat-E');
    const ag = s.appointments.find((a) => a.id === geral.id);
    conferir('snapshot traz o agendamento na fila geral com a posição devolvida', ag && ag.tarologistId === 'afila' && ag.position === geral.position && ag.clientId === '900105');
    conferir('appointment() REAL da Lilly o enxerga como vivo (usado em scheduled(), engine.mjs:620)', Boolean(s.appointments.find((a) => a.clientId === '900105' && a.tarologistId === 'afila' && !['removed', 'cancelled', 'completed', 'declined'].includes(a.status))));
  });
  await passo('repetição com a MESMA Idempotency-Key (longa, com ":"): mesmo result, nenhum agendamento novo; corpo diferente na mesma chave: 409', async () => {
    const antes = await contar('gf_agenda');
    const rep = await adapter.execute(aGeral);
    conferir(`chave com ${aGeral.idempotencyKey.length} caracteres: mesmo id`, rep.committed === true && rep.result.id === geral.id && (await contar('gf_agenda')) === antes);
    const { erro } = await tentar(adapter.execute({ ...aGeral, payload: { ...aGeral.payload, preserveQueue: false, confirmed: false } }));
    conferir('409 vira IntegrationError definitiva (uncertain:false)', erro instanceof IntegrationError && erro.status === 409 && erro.uncertain === false);
  });
  await passo('cliente já agendada: 409 definitivo, sem segundo agendamento', async () => {
    const antes = await contar('gf_agenda');
    const { erro } = await tentar(adapter.execute(sch('900105', 'chat-E', '9001')));
    conferir('409 LILLY_APPOINTMENT_EXISTS', erro instanceof IntegrationError && erro.status === 409 && erro.uncertain === false);
    conferir('nada novo', (await contar('gf_agenda')) === antes);
  });
  let hana;
  await passo('schedule fila de tarólogo (9001) cria posição na fila dele; tarólogo inativo é 4xx', async () => {
    const x = await adapter.execute(sch('900108', 'chat-H', '9001'));
    hana = x.result;
    conferir('result.id/position/tarologistId', x.committed === true && /^AG-/.test(hana.id) && Number.isInteger(hana.position) && hana.tarologistId === '9001', JSON.stringify(hana));
    const { erro } = await tentar(adapter.execute(sch('900109', 'chat-I', '9003')));
    conferir('tarólogo inativo = 4xx definitivo', erro instanceof IntegrationError && erro.status >= 400 && erro.status < 500 && erro.uncertain === false, String(erro && erro.status));
  });
  await passo('schedule com o payload do funil de pagamento (intake) sem pagamento: 4xx; data passada: 4xx', async () => {
    const intake = (extra = {}) => sch('900109', 'chat-I', '9002', { intakeId: 'umbler:IN1', scope: 'tarologist', channel: 'WhatsApp', minutes: 30, date: operacional, reason: 'paid_intake', ...extra });
    const a = await tentar(adapter.execute(intake()));
    conferir('paid_intake sem paymentId', a.erro instanceof IntegrationError && a.erro.status >= 400 && a.erro.status < 500 && a.erro.uncertain === false, String(a.erro && a.erro.status));
    const b = await tentar(adapter.execute(sch('900109', 'chat-I', '9002', { date: soma(operacional, -1) })));
    conferir('dia passado', b.erro instanceof IntegrationError && b.erro.status === 422 && b.erro.uncertain === false);
  });
  await passo('reschedule: devolve {date, position}; a nota da Lilly usa r.date/r.position (engine.mjs:939); repetição idempotente', async () => {
    const prova = await autorizar('chat-H', 'ct-H');
    const amanha = soma(operacional, 1);
    const a = acao('reschedule', { conversationId: 'chat-H', clientId: '900108', tarologistId: '9001', payload: { appointmentId: hana.id, date: amanha, preserveHistory: true, ...prova } });
    const x = await adapter.execute(a);
    conferir('committed + date + position', x.committed === true && x.result.date === amanha && Number.isInteger(x.result.position), JSON.stringify(x));
    const rep = await adapter.execute(a);
    conferir('repetição: mesmo result', rep.result.date === amanha && rep.result.position === x.result.position);
    const s = await snap('900108', 'chat-H');
    const ag = s.appointments.find((q) => q.id === hana.id);
    log('   (info) agendamento remarcado no snapshot:', JSON.stringify(ag));
    conferir('snapshot reflete a nova data', ag && ag.date === amanha, JSON.stringify(ag));
  });
  await passo('remove_appointment: {id, removed:true}; sem prova = 4xx; depois some do "vivo" no snapshot', async () => {
    const base = { conversationId: 'chat-C', clientId: '900103', tarologistId: '9002' };
    const sem = await tentar(adapter.execute(acao('remove_appointment', { ...base, payload: { appointmentId: 'ag-4', preserveHistory: true } })));
    conferir('sem prova = 422 definitivo', sem.erro instanceof IntegrationError && sem.erro.status === 422 && sem.erro.uncertain === false);
    const prova = await autorizar('chat-C', 'ct-C');
    const x = await adapter.execute(acao('remove_appointment', { ...base, payload: { appointmentId: 'ag-4', preserveHistory: true, ...prova } }));
    conferir('committed, id e removed:true', x.committed === true && x.result.id === 'ag-4' && x.result.removed === true, JSON.stringify(x));
    const s = await snap('900103', 'chat-C');
    const vivo = s.appointments.filter((a) => a.id === 'ag-4' && !['removed', 'cancelled', 'completed', 'declined'].includes(a.status));
    conferir('ag-4 não é mais "vivo" para a Lilly (engine.mjs:44)', vivo.length === 0, JSON.stringify(s.appointments.filter((a) => a.id === 'ag-4')));
  });
  await passo('motor REAL: com o snapshot atualizado, schedule_accepted não agenda de novo quem já tem fila (engine.mjs:620)', async () => {
    const s = await snap('900105', 'chat-E');
    let st = { ...motor.createInitialState(), enabled: true };
    const e = { id: 'umbler:SA1', type: 'message', actor: 'client', internal: false, conversationId: 'chat-E', clientId: '900105', tarologistId: 'afila', at: AGORA.toISOString(), text: 'pode agendar', data: { intent: 'schedule_accepted' } };
    st = motor.processEvent(st, e, { ...s, config: { enabled: true } }).state;
    const t = motor.processTimers(st, new Date(AGORA.getTime() + 4 * 60000).toISOString(), { ...s, config: { enabled: true } });
    conferir('nenhuma ação schedule duplicada', t.actions.filter((a) => a.kind === 'schedule').length === 0);
  });
};
