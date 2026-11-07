'use strict';

/**
 * validate: `FadasAdapter.validate(action, conversation, legacyBotRequest)` -> `POST /lilly/actions/validate`, para os 13 `action.kind`. A Lilly lê
 * `allowed`, `reason`, `contactId` (adapters.mjs:62 update_contact) e `context` (runtime.mjs:567-576, :585). Recusa é 200 allowed:false.
 */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r }) => {
  const { acao, autorizar, prepararConsulta } = criarAuxiliares({ adapter, umbler, AGORA, r });
  const chat = (id, contactId) => ({ id, contact: { id: contactId, tags: [], phoneNumber: '+5511900000001' } });
  const v = (acao_, conv) => adapter.validate(acao_, conv);
  const formaOk = (x) => x && typeof x.allowed === 'boolean' && (x.reason === undefined || typeof x.reason === 'string') && (x.contactId === undefined || typeof x.contactId === 'string');
  const regra = (x, permitido) => formaOk(x) && x.allowed === permitido && (permitido || (typeof x.reason === 'string' && x.reason.length > 0));

  log('validate (13 kinds)');
  await passo('note/public_reply/mark_attention: permitido com vínculo (context para a Lilly checar telefone/presença); recusado sem vínculo', async () => {
    for (const [kind, payload] of [['note', { text: 'Nota' }], ['public_reply', { text: 'Olá' }], ['mark_attention', { unread: true, waiting: true }]]) {
      const x = await v(acao(kind, { conversationId: 'chat-D', clientId: '900104', payload }), chat('chat-D', 'ct-D'));
      conferir(`${kind} permitido (forma {allowed,reason?,contactId?,context?})`, regra(x, true) && x.context && typeof x.context === 'object', JSON.stringify(x));
      const no = await v(acao(kind, { conversationId: 'chat-sem', clientId: '900104', payload }), chat('chat-sem', 'ct-s'));
      conferir(`${kind} sem vínculo = recusado com motivo`, regra(no, false), JSON.stringify(no));
    }
  });
  await passo('update_contact: devolve contactId do vínculo (adapters.mjs:62 exige validated.contactId); sem nome recusa', async () => {
    const x = await v(acao('update_contact', { conversationId: 'chat-D', clientId: '900104', payload: { name: '900104 - Duda (Pré-pago)' } }), chat('chat-D', 'ct-D'));
    conferir('allowed e contactId === ct-D', regra(x, true) && x.contactId === 'ct-D', JSON.stringify(x));
    conferir('sem nome: recusa', regra(await v(acao('update_contact', { conversationId: 'chat-D', clientId: '900104', payload: {} }), chat('chat-D', 'ct-D')), false));
  });
  await passo('knowledge_proposal: permitido com pergunta e resposta; recusado sem resposta', async () => {
    conferir('permitido', regra(await v(acao('knowledge_proposal', { conversationId: 'chat-D', payload: { question: 'Atendem aos domingos?', answer: 'Sim.' } })), true));
    conferir('recusado', regra(await v(acao('knowledge_proposal', { conversationId: 'chat-D', payload: { question: 'Atendem aos domingos?' } })), false));
  });
  await passo('register_client / update_client: permitido para ID existente; recusado sem ID (cadastro novo) e cliente inexistente', async () => {
    const reg = { name: 'Duda Souza', identificationName: 'Duda', normalizeName: true, preservePreferences: true, allowMissingEmail: true, allowMissingBirthDate: true, phone: '+55 11 9877-6666' };
    conferir('register_client com ID existente', regra(await v(acao('register_client', { conversationId: 'chat-D', clientId: '900104', payload: { ...reg, clientId: '900104' } }), chat('chat-D', 'ct-D')), true));
    conferir('register_client sem ID (lead): recusado com motivo', regra(await v(acao('register_client', { conversationId: 'chat-N', payload: reg })), false));
    conferir('update_client permitido', regra(await v(acao('update_client', { conversationId: 'chat-D', clientId: '900104', payload: { clientId: '900104', treatAs: 'Duda', onlyIfEmpty: true, sourceMessageIds: ['m1'], preservePreferences: true } })), true));
    conferir('update_client cliente inexistente', regra(await v(acao('update_client', { conversationId: 'chat-D', clientId: '999999', payload: { clientId: '999999', treatAs: 'X' } })), false));
  });
  await passo('schedule: fila geral e tarólogo permitidos; tarólogo inativo, inexistente e cliente já agendada recusados', async () => {
    const sch = (clientId, conv, tarologistId, extra = {}) => acao('schedule', { conversationId: conv, clientId, tarologistId, payload: { reason: 'staff_command', confirmed: true, position: 'last', preserveQueue: true, ...extra } });
    conferir('fila geral (afila), payload exato do motor engine.mjs:623', regra(await v(sch('900105', 'chat-E', 'afila')), true));
    conferir('tarólogo 9001', regra(await v(sch('900105', 'chat-E', '9001')), true));
    conferir('tarólogo inativo 9003', regra(await v(sch('900105', 'chat-E', '9003')), false));
    conferir('tarólogo inexistente', regra(await v(sch('900105', 'chat-E', 'fantasma')), false));
    conferir('cliente com agendamento aberto (900101/ag-1)', regra(await v(sch('900101', 'chat-A', '9002')), false));
  });
  await passo('remove_appointment / reschedule: permitidos com a prova do evento humano; recusados sem ela', async () => {
    const prova = await autorizar('chat-C', 'ct-C');
    const base = { conversationId: 'chat-C', clientId: '900103', tarologistId: '9002' };
    conferir('remove com prova', regra(await v(acao('remove_appointment', { ...base, payload: { appointmentId: 'ag-4', preserveHistory: true, ...prova } })), true));
    conferir('remove sem prova', regra(await v(acao('remove_appointment', { ...base, payload: { appointmentId: 'ag-4', preserveHistory: true } })), false));
    conferir('reschedule com prova', regra(await v(acao('reschedule', { ...base, payload: { appointmentId: 'ag-4', date: '2026-11-09', preserveHistory: true, ...prova } })), true));
    conferir('reschedule de agendamento de outra cliente', regra(await v(acao('reschedule', { ...base, clientId: '900104', conversationId: 'chat-D', payload: { appointmentId: 'ag-4', date: '2026-11-09', preserveHistory: true, ...prova } })), false));
  });
  await passo('payment: permitido com referência + prova; recusado sem prova e sem referência', async () => {
    const prova = await autorizar('chat-G', 'ct-G');
    const base = { conversationId: 'chat-G', clientId: '900107' };
    const pay = { amount: 35, endToEndId: 'E2E-VAL-1', sourceEventId: 'mp-before-registration:val1', providerConfirmed: true };
    conferir('com prova e referência', regra(await v(acao('payment', { ...base, payload: { ...pay, ...prova } })), true));
    conferir('sem prova', regra(await v(acao('payment', { ...base, payload: pay })), false));
    conferir('sem referência', regra(await v(acao('payment', { ...base, payload: { amount: 35, sourceEventId: 'x1', humanConfirmed: true, ...prova } })), false));
  });
  await passo('start_consultation: permitido na conversa do TARÓLOGO (a cliente não tem vínculo com ela); recusado se status esperado não confere ou se a conversa é de outra cliente', async () => {
    await prepararConsulta('con-val', '900109', '9001');
    const base = { conversationId: 'chat-mara', clientId: '900109', tarologistId: '9001' };
    const p = { consultationId: 'con-val', clientId: '900109', tarologistId: '9001', startedAt: ISO_AGORA(), sourceEventId: 'umbler:T1', sourceConversationId: 'chat-mara', expectedStatus: 'prepared', minutes: 30, channel: 'WhatsApp: texto/áudio', ddd: '' };
    const xs = await v(acao('start_consultation', { ...base, payload: p }));
    conferir('preparada', regra(xs, true), JSON.stringify(xs));
    conferir('conversa vinculada a OUTRA cliente (chat-D é da Duda)', regra(await v(acao('start_consultation', { ...base, conversationId: 'chat-D', payload: { ...p, sourceConversationId: 'chat-D' } })), false));
    conferir('status esperado errado', regra(await v(acao('start_consultation', { ...base, payload: { ...p, expectedStatus: 'in_progress' } })), false));
  });
  await passo('tarologist_schedule_note: scheduleId do PRÓPRIO snapshot é aceito; scheduleId desconhecido e changesSchedule:true recusados', async () => {
    const s = await adapter.snapshot({ id: 'umbler:T2', type: 'message', actor: 'tarologist', conversationId: 'chat-mara', tarologistId: '9001', at: AGORA.toISOString(), data: {} });
    const scheduleId = s.tarologists.find((t) => t.id === '9001').scheduleId;
    const base = { conversationId: 'chat-mara', tarologistId: '9001' };
    const p = { scheduleId, text: 'Chegada confirmada às 10:00.', status: 'arrived', informationOnly: true, changesSchedule: false, sourceEventId: 'umbler:T2', sourceConversationId: 'chat-mara' };
    conferir(`scheduleId ${scheduleId}`, regra(await v(acao('tarologist_schedule_note', { ...base, payload: p })), true), scheduleId);
    conferir('changesSchedule:true recusado', regra(await v(acao('tarologist_schedule_note', { ...base, payload: { ...p, changesSchedule: true } })), false));
    conferir('tarólogo inexistente recusado', regra(await v(acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: 'fantasma', payload: p })), false));
  });
  await passo('os 13 kinds do knownActionKinds da Lilly (runtime.mjs:35) têm validação habilitada (allowed é booleano, nunca "não habilitada")', async () => {
    const kinds = ['note', 'public_reply', 'mark_attention', 'register_client', 'update_client', 'update_contact', 'schedule', 'remove_appointment', 'reschedule', 'payment', 'start_consultation', 'tarologist_schedule_note', 'knowledge_proposal'];
    for (const kind of kinds) {
      const x = await v(acao(kind, { conversationId: 'chat-D', clientId: '900104', tarologistId: '9001', payload: {} }), chat('chat-D', 'ct-D'));
      conferir(`${kind}: resposta válida`, formaOk(x) && !/ainda não está habilitada/.test(x.reason || ''), JSON.stringify(x));
    }
  });
  function ISO_AGORA() { return new Date().toISOString(); }
};
