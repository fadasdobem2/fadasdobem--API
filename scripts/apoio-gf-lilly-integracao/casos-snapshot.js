'use strict';

/**
 * snapshot: `FadasAdapter.snapshot(event, conversation)` -> `POST /lilly/context`. Confere o que o código REAL da Lilly lê:
 * `complete` (engine.mjs:104), `clients` (engine.mjs:55), `links` + verifiedDestination (engine.mjs:57 e :191), telefone pelo
 * phoneLookup (phone-identity.mjs:39), tarólogos/consultas/agenda com os estados que o motor aceita (engine.mjs:44, :335, :783-785).
 */

module.exports = async ({ adapter, importar, conferir, passo, log, r, avulso, AGORA }) => {
  const motor = await importar('engine.mjs');
  const fone = await importar('phone-identity.mjs');
  const ev = (extra = {}) => ({ id: 'umbler:E9', type: 'message', at: AGORA.toISOString(), conversationId: 'chat-A', actor: 'client', internal: false, data: {}, ...extra });
  const umbler = (id, contactId, phoneNumber) => ({ id, contact: { id: contactId, phoneNumber } });

  log('snapshot (FadasAdapter.snapshot -> POST /lilly/context)');
  let s;
  await passo('formato: complete:true, arrays e datas que o motor lê; sem segredos do legado', async () => {
    s = await adapter.snapshot(ev(), umbler('chat-A', 'ct-A', '+5511998887777'));
    conferir('complete === true (engine.mjs:104)', s.complete === true);
    for (const k of ['clients', 'tarologists', 'appointments', 'consultations', 'payments', 'links', 'messages']) conferir(`${k} é array`, Array.isArray(s[k]));
    conferir('operationalDate AAAA-MM-DD e now ISO', /^\d{4}-\d{2}-\d{2}$/.test(s.operationalDate) && !Number.isNaN(Date.parse(s.now)));
    const texto = JSON.stringify(s);
    conferir('nenhum dado sensível do legado', !/SENHA-NAO-PODE-SAIR|nao\.pode\.sair|00000000191|Rua Secreta|MOTIVO-PESSOAL|OBSERVACAO-NAO-PODE-SAIR/.test(texto));
  });
  await passo('cliente por telefone: "+55 DDD número" e phoneLookup da Lilly acha exatamente uma cliente (phone-identity.mjs:39)', async () => {
    const ana = s.clients.find((c) => c.id === '900101');
    conferir('telefone no formato +55 DD número', /^\+55 \d{2} \d{4,5}-\d{4}$/.test(ana.phone) && ana.phones.includes(ana.phone));
    const l = fone.phoneLookup(s, '+5511998887777');
    conferir('lookup completo com 1 cliente', l.complete === true && l.matches.length === 1 && l.matches[0].id === '900101');
    conferir('providerPhone lê o contato da Umbler no mesmo formato', fone.providerPhone(ev(), s, { conversation: { id: 'chat-A', contact: { id: 'ct-A', phoneNumber: '+5511998887777' } } }) === '+5511998887777');
  });
  await passo('cadastro sem nono dígito: a Lilly (que recebe 9 dígitos da Umbler) ainda acha a cliente; evidência phoneLookup completa', async () => {
    const d = await adapter.snapshot(ev({ conversationId: 'chat-N' }), umbler('chat-N', 'ct-N', '+5511998776666'));
    const l = fone.phoneLookup(d, '+5511998776666');
    conferir('1 cliente, Duda, por nono dígito', l.complete === true && l.matches.length === 1 && l.matches[0].id === '900104');
    conferir('phoneLookup declarado pelo servidor e completo (phone-identity.mjs:41-43)', d.phoneLookup && d.phoneLookup.complete === true && fone.fullPhone(d.phoneLookup.phone) === '+5511998776666');
    const compartilhado = await adapter.snapshot(ev({ conversationId: 'chat-Z' }), umbler('chat-Z', 'ct-Z', '+5531977771234'));
    conferir('telefone compartilhado: o motor veria 2 candidatas (não cria cadastro novo)', fone.phoneLookup(compartilhado, '+5531977771234').matches.length === 2);
    const desconhecido = await adapter.snapshot(ev({ conversationId: 'chat-Y' }), umbler('chat-Y', 'ct-Y', '+5511900000000'));
    const lu = fone.phoneLookup(desconhecido, '+5511900000000');
    conferir('telefone desconhecido: complete:true e nenhuma cliente (libera cadastro novo)', lu.complete === true && lu.matches.length === 0);
  });
  await passo('vínculos: cliente com vínculo único é destino verificado; com vínculo inativo extra (conflito 1:1) a Lilly recusa', async () => {
    const d = await adapter.snapshot(ev({ conversationId: 'chat-D', clientId: '900104' }), umbler('chat-D', 'ct-D', '+5511998776666'));
    const link = d.links.find((x) => x.clientId === '900104');
    conferir('link com clientId/fadasClientId/conversationId/verified/active (engine.mjs:57,:191)', link && link.fadasClientId === '900104' && link.conversationId === 'chat-D' && link.verified === true && link.active === true);
    conferir('verifiedDestination true (REAL)', motor.verifiedDestination(d, '900104', 'chat-D') === true);
    conferir('Ana (vínculo ativo + inativo em outra conversa): destino NÃO verificado, como o contrato quer', motor.verifiedDestination(s, '900101', 'chat-A') === false && s.links.some((x) => x.active === false));
    conferir('outra conversa não vale', motor.verifiedDestination(d, '900104', 'chat-A') === false);
  });
  await passo('tarólogos, agenda e consultas com os estados que o motor aceita', async () => {
    const mara = s.tarologists.find((t) => t.id === '9001');
    conferir('status de presença conhecido + scheduleId (engine.mjs:1263)', ['available', 'busy', 'paused', 'offline'].includes(mara.status) && /@/.test(mara.scheduleId));
    conferir('appointments: status vivo/encerrado do enum (engine.mjs:44) e posição inteira', s.appointments.every((a) => ['scheduled', 'completed', 'cancelled', 'removed', 'declined'].includes(a.status) && (a.position === undefined || Number.isInteger(a.position))));
    const prep = s.consultations.find((c) => c.status === 'prepared');
    conferir('consulta preparada com canal aceito, minutos, versão e sem startedAt (engine.mjs:783-785)', prep && ['WhatsApp', 'PABX', 'Texto/Áudio', 'WhatsApp: texto/áudio', 'WhatsApp Texto/Áudio'].includes(prep.channel) && prep.minutes > 0 && Number.isInteger(prep.version) && !prep.startedAt);
    conferir('em andamento usa in_progress (engine.mjs:777)', s.consultations.some((c) => c.status === 'in_progress'));
    conferir('payments: id/clientId/amount numérico/status', s.payments.every((p) => p.id && p.clientId && typeof p.amount === 'number' && p.status));
  });
  await passo('evento sem conversa da Umbler (consulta administrativa) também devolve snapshot completo', async () => {
    const q = await adapter.snapshot({ id: 'query:u1', type: 'query', actor: 'staff', readOnly: true, text: 'Mara está?', conversationId: '', at: AGORA.toISOString(), requestedBy: 'Laya' });
    conferir('complete:true + tarólogos (runtime.mjs:280-281; query.mjs:81 só responde presença com complete)', q.complete === true && q.tarologists.length >= 2);
    const resposta = (await importar('query.mjs')).answerLillyQuery('Mara está?', { ...q, config: { enabled: true } }, {});
    conferir('a resposta REAL da Lilly usa o snapshot (não cai em "não consegui conferir")', resposta.unavailable !== true, JSON.stringify(resposta).slice(0, 200));
  });
  await passo('motor REAL consome o snapshot: consultation_started da tarólogo gera start_consultation com os campos do contrato', async () => {
    const ctx = { ...s, config: { enabled: true } };
    let st = { ...motor.createInitialState(), enabled: true };
    // Lilly v708: o início só vale no MESMO dia de atendimento do snapshot (engine.mjs:809); o evento nasce no instante do snapshot.
    const e = { id: 'umbler:T1', type: 'message', actor: 'tarologist', internal: false, conversationId: 'chat-mara', tarologistId: '9001', clientId: '', at: s.now, text: 'Começamos', data: { intent: 'consultation_started', explicitStart: true } };
    ctx.tarologists = ctx.tarologists.map((t) => (t.id === '9001' ? { ...t, conversationId: 'chat-mara' } : t));
    const res = motor.processEvent(st, e, ctx);
    const a = res.actions.find((x) => x.kind === 'start_consultation');
    conferir('start_consultation emitido para c-1 (consulta preparada do nosso snapshot)', a && a.payload.consultationId === 'c-1' && a.payload.expectedStatus === 'prepared' && a.payload.expectedVersion === 1 && a.payload.minutes === 30, JSON.stringify(res.actions.map((x) => x.payload)));
  });
};
