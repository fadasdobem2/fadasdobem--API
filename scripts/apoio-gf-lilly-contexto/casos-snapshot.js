'use strict';

/** O snapshot de uma conversa vinculada: clientes, links, mensagens, avisos, cotações, agenda (inclui `afila`), tarólogos, escalas e pagamentos. */

module.exports = async ({ snap, body, legado, conferir, passo, AGORA }) => {
  console.log('Snapshot da conversa vinculada (chat-A, Ana 900101)');
  let s;
  await passo('envelope: relógio, dia operacional 06h-06h, hora de início e complete:true', async () => {
    s = await snap(body());
    const x = s.snapshot;
    conferir('now ISO UTC', x.now === AGORA.toISOString());
    conferir('dia operacional e hora de início', x.operationalDate === '2026-11-07' && x.operationalStartHour === 6);
    conferir('todas as consultas exigidas terminaram: complete:true', x.complete === true);
    conferir('todos os assuntos exigidos ok', Object.values(s.cobertura.resumo()).every((v) => v.startsWith('ok')));
  });
  await passo('clients: Ana com identificação, telefone `+55 DD número`, Pós-pago, saldo numérico, contato do vínculo e ficha ausente sem a base', async () => {
    const ana = s.snapshot.clients.find((c) => c.id === '900101');
    conferir('nomes', ana.name === 'Nome Completo 900101' && ana.identificationName === 'Ana' && ana.treatAs === 'Aninha');
    conferir('telefone normalizado', ana.phone === '+55 11 99888-7777');
    conferir('Pós-pago', ana.paymentType === 'postpaid' && ana.postpaid === true);
    conferir('saldo conhecido (número)', typeof ana.balance === 'number');
    conferir('contactId do vínculo vigente', ana.contactId === 'ct-A');
    conferir('sem base de ficha: sem profileUrl e sem clientProfileBaseUrl', ana.profileUrl === undefined && s.snapshot.clientProfileBaseUrl === undefined);
  });
  await passo('clients: as da fila/consultas do dia entram SEM saldo (ausente, nunca 0)', async () => {
    const ids = s.snapshot.clients.map((c) => c.id);
    conferir('Bia (afila), Cris, Duda e Eva presentes', ['900102', '900103', '900104', '900105'].every((i) => ids.includes(i)));
    conferir('sem balance fora do foco', s.snapshot.clients.filter((c) => c.id !== '900101').every((c) => c.balance === undefined));
  });
  await passo('ficha: só HTTPS vira clientProfileBaseUrl/profileUrl (sem consulta, âncora ou credencial)', async () => {
    const ok = await snap(body(), { env: { LILLY_CLIENT_PROFILE_BASE_URL: 'https://gestao.exemplo.test/app?x=1#a' } });
    conferir('base e link', ok.snapshot.clientProfileBaseUrl === 'https://gestao.exemplo.test/app' && ok.snapshot.clients.find((c) => c.id === '900101').profileUrl === 'https://gestao.exemplo.test/app?view=clientes&client=900101');
    for (const ruim of ['http://gestao.exemplo.test/app', 'https://user:senha@gestao.exemplo.test/', 'não é url', 'ftp://x.test']) {
      const x = await snap(body(), { env: { LILLY_CLIENT_PROFILE_BASE_URL: ruim } });
      conferir(`recusa ${ruim.slice(0, 22)}`, x.snapshot.clientProfileBaseUrl === undefined && x.snapshot.clients.every((c) => c.profileUrl === undefined));
    }
  });
  await passo('saldo que não pôde ser lido FICA AUSENTE (nunca 0) e o assunto clients fica incompleto', async () => {
    const x = await snap(body(), { trocas: { saldoDaCliente: async () => { throw new Error('saldo fora'); } } });
    const ana = x.snapshot.clients.find((c) => c.id === '900101');
    conferir('Ana sem balance', Boolean(ana) && ana.balance === undefined && 'balance' in ana === false);
    conferir('clients incompleto: complete:false', x.snapshot.complete === false && /saldo/.test(x.cobertura.resumo().clients));
  });
  await passo('links: o vínculo vigente E o conflito 1:1 (a mesma cliente em outra conversa, inativo) vão juntos', async () => {
    const l = s.snapshot.links;
    conferir('dois vínculos', l.length === 2);
    const a = l.find((v) => v.conversationId === 'chat-A'); const b = l.find((v) => v.conversationId === 'chat-B');
    conferir('vigente', a.clientId === '900101' && a.contactId === 'ct-A' && a.verified === true && a.active === true && a.firstContact === true && a.attribution.kind === 'ad');
    conferir('conflito visível (inativo)', b.active === false && b.clientId === '900101');
    conferir('conversation com a origem verificada', s.snapshot.conversation.id === 'chat-A' && s.snapshot.conversation.firstContact === true);
  });
  await passo('messages: só mensagens das últimas 48h da conversa; atividade, evento do site e mensagem velha ficam fora', async () => {
    const m = s.snapshot.messages;
    conferir('ids', m.map((x) => x.id).join() === 'umbler:E1,umbler:E2,umbler:E3,umbler:E4,umbler:E5');
    conferir('Nota da equipe é interna', m.find((x) => x.id === 'umbler:E2').internal === true && m.find((x) => x.id === 'umbler:E2').actor === 'staff');
    conferir('sistema automático vira bot', m.find((x) => x.id === 'umbler:E4').actor === 'bot');
    conferir('texto e intenção', m[0].text === 'texto umbler:E1' && m[0].intent === 'client_message' && m[0].clientId === '900101' && m[0].messageId === 'm-umbler:E1');
    conferir('áudio sem texto mantém text vazio e o tipo', m[4].text === '' && m[4].messageType === 'audio');
  });
  await passo('notices, consultationQuotes e scheduleNotes (sem o texto livre da nota)', async () => {
    const av = s.snapshot.notices[0];
    conferir('aviso com o tarólogo do agendamento', s.snapshot.notices.length === 1 && av.id === 'av1' && av.appointmentId === 'ag-1' && av.tarologistId === '9001' && av.sentAt === '2026-11-07T13:30:00.000Z');
    const q = s.snapshot.consultationQuotes[0];
    conferir('cotação em reais, atual', q.id === 'Q1' && q.amount === 88.8 && q.minutes === 30 && q.current === true && q.conversationId === 'chat-A');
    const n = s.snapshot.scheduleNotes[0];
    conferir('nota do horário sem texto', s.snapshot.scheduleNotes.length === 1 && n.id === 'nota-1' && n.status === 'waiting' && n.expectedAt === '2026-11-07T18:00:00.000Z' && !JSON.stringify(n).includes('MOTIVO'));
  });
  await passo('appointments: tarotId->tarologistId, agendaOutcome->status, posição, standby e fila geral `afila`', async () => {
    const a = Object.fromEntries(s.snapshot.appointments.map((x) => [x.id, x]));
    conferir('ag-1 aberta, hoje, posição 1, horário combinado', a['ag-1'].status === 'scheduled' && a['ag-1'].tarologistId === '9001' && a['ag-1'].date === '2026-11-07' && a['ag-1'].position === 1 && a['ag-1'].scheduledAt === '2026-11-07T15:30:00-03:00');
    conferir('plano de contato só com campos do contrato', a['ag-1'].contactPlan.who === 'tarologist' && a['ag-1'].contactPlan.segredo === undefined);
    conferir('ag-2 na fila geral, standby, sem date', a['ag-2'].tarologistId === 'afila' && a['ag-2'].standbyDate === '2026-11-07' && a['ag-2'].date === undefined);
    conferir('ag-3 concluída', a['ag-3'].status === 'completed' && a['ag-3'].consultationId === 'c-3');
    conferir('futura (amanhã) de cliente fora do foco e cancelada de ontem não entram', a['ag-4'] === undefined && a['ag-5'] === undefined);
    conferir('`afila` nunca é tarólogo', !s.snapshot.tarologists.some((t) => t.id === 'afila'));
  });
  await passo('tarologists: presença traduzida, horário de hoje e amanhã; conversationId/umblerContactId AUSENTES (sem vínculo de tarólogo)', async () => {
    const t = Object.fromEntries(s.snapshot.tarologists.map((x) => [x.id, x]));
    conferir('cadastro inativo não entra', t['9003'] === undefined && Object.keys(t).join() === '9001,9002');
    conferir('Mara disponível, turno 22h-02h', t['9001'].status === 'available' && t['9001'].scheduleId === '9001@2026-11-07#1' && t['9001'].startsAt === '2026-11-07T22:00:00-03:00' && t['9001'].endsAt === '2026-11-08T02:00:00-03:00');
    conferir('Mara trabalha amanhã', t['9001'].worksTomorrow === true && t['9001'].tomorrowDate === '2026-11-08');
    conferir('Luz em pausa, de folga hoje (sem horário)', t['9002'].status === 'paused' && t['9002'].startsAt === undefined);
    conferir('sem conversationId nem umblerContactId', Object.values(t).every((x) => x.conversationId === undefined && x.umblerContactId === undefined && x.aliases === undefined));
    conferir('presenceUpdatedAt ISO', /^\d{4}-\d{2}-\d{2}T/.test(t['9001'].presenceUpdatedAt));
  });
  await passo('schedules: uma linha por período e dia; folga é `off`; ids determinísticos', async () => {
    const sc = Object.fromEntries(s.snapshot.schedules.map((x) => [x.id, x]));
    conferir('Mara hoje e amanhã', sc['9001@2026-11-07#1'].status === 'active' && sc['9001@2026-11-08#1'].startsAt === '2026-11-08T14:00:00-03:00');
    conferir('Luz de folga estendida hoje', sc['9002@2026-11-07#0'].status === 'off' && sc['9002@2026-11-07#0'].startsAt === undefined);
    conferir('Luz amanhã pela semana', sc['9002@2026-11-08#1'].endsAt === '2026-11-08T14:00:00-03:00');
    conferir('sem observação (texto livre)', !JSON.stringify(s.snapshot.schedules).includes('FOLGA'));
  });
  await passo('payments: lançados no Postgres + legado conciliado (R5: 2 confirmado, 1 e 0 informado), sem contar o espelho duas vezes', async () => {
    legado.pagamentos.informed.push(
      { idPagtoInformado: 501, idUsuario: 900101, dtPagtoInformado: '2026-11-06 10:00:00', vlPagtoInformado: '50.00', idBanco: 1, idFormaPagto: 1, status: 'informado', id_status_pagto: 2, dt_criado: '2026-11-06 13:00:00' },
      { idPagtoInformado: 502, idUsuario: 900101, dtPagtoInformado: '2026-11-06 11:00:00', vlPagtoInformado: '148.00', idBanco: 1, idFormaPagto: 1, status: 'informado', id_status_pagto: 1, dt_criado: '2026-11-06 14:00:00' },
      { idPagtoInformado: 503, idUsuario: 900101, dtPagtoInformado: '2026-11-06 12:00:00', vlPagtoInformado: '20.00', idBanco: 1, idFormaPagto: 1, status: 'informado', id_status_pagto: 0, dt_criado: '2026-11-06 15:00:00' },
      { idPagtoInformado: 504, idUsuario: 900101, dtPagtoInformado: '2026-11-06 13:00:00', vlPagtoInformado: '30.00', idBanco: 1, idFormaPagto: 1, status: 'informado', id_status_pagto: 9, dt_criado: '2026-11-06 16:00:00' },
    );
    legado.pagamentos.confirmed.push({ idPagtoInformado: 601, idUsuario: 900101, dtPagtoInformado: '2026-11-05 09:00:00', vlPagtoInformado: '70.00', idBanco: 1, idFormaPagto: 1 });
    const x = await snap(body());
    const p = Object.fromEntries(x.snapshot.payments.map((y) => [y.id, y]));
    conferir('pg-1 confirmado, consulta c-1, 88,80', p['pg-1'].status === 'confirmed' && p['pg-1'].consultationId === 'c-1' && p['pg-1'].amount === 88.8);
    conferir('pg-2 cancelado', p['pg-2'].status === 'cancelled');
    conferir('pg-3 informado com as referências do provedor e a conversa do evento', p['pg-3'].status === 'informed' && p['pg-3'].reference === 'REF-1' && p['pg-3'].mpPaymentId === 'mp-1' && p['pg-3'].endToEndId === 'E2E-1' && p['pg-3'].conversationId === 'chat-A');
    conferir('legado 2 = confirmed', p['tbl_pagtoinformado:501'].status === 'confirmed' && p['tbl_pagtoinformado:501'].amount === 50);
    conferir('legado 0 (automático Mercado Pago) = informed', p['tbl_pagtoinformado:503'].status === 'informed');
    conferir('espelho do pg-3 (legado 502) não conta duas vezes', p['tbl_pagtoinformado:502'] === undefined);
    conferir('número fora da tabela R5 = pending (não conta como pago)', p['tbl_pagtoinformado:504'].status === 'pending');
    conferir('confirmado do legado', p['tbl_pagtoconfirmado:601'].status === 'confirmed');
    conferir('sem allocatedAmount (SEM FONTE)', x.snapshot.payments.every((y) => y.allocatedAmount === undefined));
    legado.pagamentos.informed.length = 0; legado.pagamentos.confirmed.length = 0;
  });
  await passo('payments: referência do evento traz o pagamento de OUTRA cliente (duplicidade) mesmo sem conversa vinculada', async () => {
    const x = await snap(body({ conversationId: 'chat-Z', data: { reference: 'REF-1' } }));
    conferir('pg-3 presente', x.snapshot.payments.some((y) => y.id === 'pg-3' && y.reference === 'REF-1'));
  });
  await passo('restrictions (só ativas) e divergences (status traduzido)', async () => {
    conferir('só rs-1, par cliente x tarólogo', s.snapshot.restrictions.length === 1 && s.snapshot.restrictions[0].id === 'rs-1' && s.snapshot.restrictions[0].tarologistId === '9002' && s.snapshot.restrictions[0].requestedBy === 'client' && s.snapshot.restrictions[0].active === true);
    conferir('divergência da consulta c-3 pendente', s.snapshot.divergences.length === 1 && s.snapshot.divergences[0].consultationId === 'c-3' && s.snapshot.divergences[0].status === 'pending');
  });
};
