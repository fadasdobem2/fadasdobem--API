'use strict';

/** execute de start_consultation (payload derivado do PRÓPRIO snapshot, como o motor) e tarologist_schedule_note (engine.mjs:1263 e :1299). */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, contar, IntegrationError }) => {
  const { acao, prepararConsulta, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  const snapT = (extra = {}) => adapter.snapshot({ id: 'umbler:T9', type: 'message', actor: 'tarologist', conversationId: 'chat-mara', tarologistId: '9001', at: new Date().toISOString(), data: {}, ...extra });

  log('execute: start_consultation');
  let inicio; let a1;
  await passo('inicia a consulta preparada: result {id, consultationId, startedAt ISO}; a Lilly confere r.id e startedAt (engine.mjs:941)', async () => {
    // O tarólogo só pode ter UMA consulta preparada: reaproveita a 'con-val' criada pelo casos-validate (ou cria, se este arquivo rodar sozinho).
    if (!(await snapT()).consultations.some((c) => c.id === 'con-val')) await prepararConsulta('con-val', '900109', '9001');
    const row = (await snapT()).consultations.find((c) => c.id === 'con-val');
    conferir('snapshot mostra a consulta como prepared com version/minutes/channel que o motor exige (engine.mjs:785)', row && row.status === 'prepared' && Number.isInteger(row.version) && row.minutes > 0 && ['WhatsApp', 'PABX', 'Texto/Áudio', 'WhatsApp: texto/áudio', 'WhatsApp Texto/Áudio'].includes(row.channel), JSON.stringify(row));
    const payload = { consultationId: row.id, clientId: row.clientId, tarologistId: row.tarologistId, startedAt: new Date().toISOString(), sourceEventId: 'umbler:T9', sourceConversationId: 'chat-mara', expectedStatus: row.status, expectedVersion: row.version, minutes: row.minutes, channel: row.channel, ddd: '' };
    a1 = acao('start_consultation', { conversationId: 'chat-mara', clientId: row.clientId, tarologistId: row.tarologistId, payload, evento: 'consultation-start:con-val', sufixo: 'start' });
    const v = await adapter.validate(a1);
    conferir('validate permite na conversa do tarólogo', v.allowed === true, JSON.stringify(v));
    const x = await adapter.execute(a1);
    inicio = x.result;
    conferir('committed e resultado do contrato', x.committed === true && (inicio.id || inicio.consultationId) === 'con-val' && Number.isFinite(Date.parse(inicio.startedAt)), JSON.stringify(x));
    const s = await snapT();
    conferir('snapshot seguinte: consulta in_progress (engine.mjs:777)', s.consultations.find((c) => c.id === 'con-val').status === 'in_progress');
  });
  await passo('repetição idempotente devolve o MESMO startedAt (não reinicia o relógio); chave nova depois de iniciada: 409 definitivo', async () => {
    const rep = await adapter.execute(a1);
    conferir('mesmo startedAt', rep.result.startedAt === inicio.startedAt);
    const nova = acao('start_consultation', { conversationId: 'chat-mara', clientId: '900109', tarologistId: '9001', payload: a1.payload, sufixo: 'start-outra' });
    const { erro } = await tentar(adapter.execute(nova));
    conferir('409 e uncertain:false', erro instanceof IntegrationError && erro.status === 409 && erro.uncertain === false);
  });

  log('execute: tarologist_schedule_note');
  let scheduleId;
  await passo('chegada (engine.mjs:1263): payload exato com scheduleId do snapshot; nota gravada; repetição idempotente', async () => {
    scheduleId = (await snapT()).tarologists.find((t) => t.id === '9001').scheduleId;
    const payload = { scheduleId, text: 'Chegada confirmada às 10:00.', status: 'arrived', informationOnly: true, changesSchedule: false, sourceEventId: 'umbler:T10', sourceConversationId: 'chat-mara' };
    const a = acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9001', payload, evento: 'umbler:T10', sufixo: 'schedule-arrived' });
    const antes = await contar('gf_lilly_notas_horario');
    const x = await adapter.execute(a);
    conferir('committed e result', x.committed === true && x.result.status === 'arrived' && x.result.tarologistId === '9001', JSON.stringify(x));
    conferir('repetição: mesma nota', (await adapter.execute(a)).result.id === x.result.id);
    conferir('1 nota nova gravada', (await contar('gf_lilly_notas_horario')) === antes + 1);
  });
  await passo('recado de horário (engine.mjs:1299, SEM status e SEM tarologistId no payload): aceito, vira waiting com horário esperado', async () => {
    const payload = { scheduleId, date: undefined, expectedAt: '18:00', sourceAt: new Date().toISOString(), text: 'Só entro por volta das 18h', sourceEventId: 'umbler:T11', sourceConversationId: 'chat-mara', informationOnly: true, changesSchedule: false };
    const a = acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9001', payload, evento: 'umbler:T11', sufixo: 'schedule-note' });
    const { valor, erro } = await tentar(adapter.execute(a));
    conferir('committed (payload real do motor, sem status/date)', valor && valor.committed === true, String(erro && `${erro.status} ${erro.message}`));
    const s = await snapT();
    const notas = (s.scheduleNotes || []).filter((n) => n.tarologistId === '9001');
    conferir('snapshot expõe scheduleNotes com tarologistId/date/expectedAt para availability.mjs:75', notas.length >= 1 && notas.every((n) => n.date && (n.status !== 'waiting' || /^\d{2}:\d{2}$|T/.test(`${n.expectedAt}`))), JSON.stringify(notas));
  });
  await passo('recusas definitivas: changesSchedule:true e tarólogo inexistente = 4xx', async () => {
    const base = { scheduleId, text: 'x', status: 'arrived', informationOnly: true, changesSchedule: false, sourceEventId: 'umbler:T12', sourceConversationId: 'chat-mara' };
    const a = await tentar(adapter.execute(acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9001', payload: { ...base, changesSchedule: true } })));
    conferir('changesSchedule:true', a.erro instanceof IntegrationError && a.erro.status === 422 && a.erro.uncertain === false);
    const b = await tentar(adapter.execute(acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: 'fantasma', payload: base })));
    conferir('tarólogo inexistente', b.erro instanceof IntegrationError && b.erro.status >= 400 && b.erro.status < 500 && b.erro.uncertain === false, JSON.stringify({ v: b.valor, e: b.erro && b.erro.status }));
  });
};
