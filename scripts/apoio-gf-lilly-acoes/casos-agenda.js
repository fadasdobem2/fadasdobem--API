'use strict';

/** schedule (fila geral e por tarólogo, posição real, duplicada, restrição, paid_intake), remove_appointment e reschedule. */

module.exports = async ({ igual, acao, exec, validar, vincular, autorizar, consulta, contar, conferir, passo, chave, HOJE, sequelize }) => {
  const soma = (d, k) => new Date(Date.parse(`${d}T12:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
  const cli = { A: ['900111', 'chat-a'], B: ['900112', 'chat-b'], C: ['900113', 'chat-c'], D: ['900114', 'chat-d'], R: ['900115', 'chat-r'], E: ['900116', 'chat-e'] };
  for (const [c, conv] of Object.values(cli)) await vincular(c, conv);
  const sched = (quem, tarologistId, payload = {}) => acao('schedule', {
    clientId: cli[quem][0], conversationId: cli[quem][1], tarologistId, payload: { scope: tarologistId === 'afila' ? 'general' : 'tarologist', channel: 'WhatsApp', minutes: 30, position: 'last', confirmed: true, ...payload },
  });
  const linhaDe = async (id) => (await consulta('SELECT item, version, id_tarologo, agenda_outcome FROM gf_agenda WHERE id = :id', { id }))[0];

  console.log('schedule');
  const kA = chave('sch');
  let rA;
  await passo('fila geral: cria no Gestão, devolve {id, position:1, clientId, tarologistId:"afila"}, guarda minutos e canal', async () => {
    const a = sched('A', 'afila');
    const v = await validar(a);
    conferir('validate permite', v.status === 200 && v.corpo.allowed === true);
    rA = await exec(a, kA);
    conferir('200 committed', rA.status === 200 && rA.corpo.committed === true, JSON.stringify(rA.corpo));
    const res = rA.corpo.result;
    conferir('result do contrato', /^AG-/.test(res.id) && res.position === 1 && res.clientId === '900111' && res.tarologistId === 'afila');
    const l = await linhaDe(res.id); const item = typeof l.item === 'string' ? JSON.parse(l.item) : l.item;
    conferir('item na agenda: dia operacional do servidor, canal, requestedMinutes', item.tarotId === 'afila' && item.date === HOJE && item.channel === 'WhatsApp' && item.requestedMinutes === 30 && item.clientId === '900111');
    conferir('auditoria da Lilly', (await contar('gf_auditoria', "acao = 'lilly.schedule' AND entidade_id = :id", { id: res.id })) === 1);
  });
  await passo('segunda cliente na fila geral: posição REAL 2 (a posição vem da fila, não é fixa)', async () => {
    const x = await exec(sched('B', 'afila'), chave('sch'));
    conferir('posição 2', x.status === 200 && x.corpo.result.position === 2 && x.corpo.result.tarologistId === 'afila', JSON.stringify(x.corpo));
  });
  await passo('fila de tarólogo: osiris 1 e 2; a fila dele é independente da geral', async () => {
    const c = await exec(sched('C', 'osiris'), chave('sch'));
    const d = await exec(sched('D', 'osiris'), chave('sch'));
    conferir('osiris posição 1', c.status === 200 && c.corpo.result.position === 1 && c.corpo.result.tarologistId === 'osiris', JSON.stringify(c.corpo));
    conferir('osiris posição 2', d.status === 200 && d.corpo.result.position === 2);
  });
  await passo('repetição (mesma chave e corpo): MESMO id e posição, sem segundo agendamento; corpo diferente: 409', async () => {
    const antes = await contar('gf_agenda');
    const rep = await exec(sched('A', 'afila'), kA);
    conferir('mesmo resultado', rep.status === 200 && igual(rep.corpo.result, rA.corpo.result));
    conferir('nenhuma linha nova', (await contar('gf_agenda')) === antes);
    const dif = await exec(sched('A', 'afila', { minutes: 60 }), kA);
    conferir('409', dif.status === 409 && dif.corpo.error.code === 'OPERATION_KEY_CONFLICT');
  });
  await passo('cliente que já tem agendamento em aberto (qualquer fila): 409 LILLY_APPOINTMENT_EXISTS com o id; validate recusa', async () => {
    const antes = await contar('gf_agenda');
    const dup = sched('A', 'osiris');
    const v = await validar(dup);
    conferir('validate recusa', v.corpo.allowed === false && /já tem um agendamento/.test(v.corpo.reason));
    const x = await exec(dup, chave('sch'));
    conferir('409 com o id existente', x.status === 409 && x.corpo.error.code === 'LILLY_APPOINTMENT_EXISTS' && x.corpo.error.message.includes(rA.corpo.result.id));
    conferir('nada novo', (await contar('gf_agenda')) === antes);
  });
  await passo('restrição cliente x tarólogo: recusa (validate e execução); outro tarólogo segue livre', async () => {
    await sequelize.query("INSERT INTO gf_restricoes (id, id_cliente, id_tarologo, solicitante, ativa, item, criado_por, operation_key) VALUES ('rs-l1', '900115', 'osiris', 'tarologist', true, '{}', 'teste', 'op-rs-l1')");
    const a = sched('R', 'osiris');
    conferir('validate recusa', (await validar(a)).corpo.allowed === false);
    const x = await exec(a, chave('sch'));
    conferir('execução 422', x.status === 422 && !/AG-/.test(JSON.stringify(x.corpo)));
    const nyx = await exec(sched('R', 'nyx'), chave('sch'));
    conferir('outro tarólogo ok', nyx.status === 200 && nyx.corpo.result.position === 1);
  });
  await passo('recusas: dia no passado (LILLY_DATE_STALE), escopo incoerente, tarólogo inativo/inexistente, cliente sem vínculo', async () => {
    const velho = await exec(sched('E', 'nyx', { date: soma(HOJE, -1) }), chave('sch'));
    conferir('data velha', velho.status === 422 && velho.corpo.error.code === 'LILLY_DATE_STALE');
    conferir('escopo incoerente', (await exec(sched('E', 'nyx', { scope: 'general' }), chave('sch'))).status === 422);
    conferir('tarólogo inativo (validate)', (await validar(sched('E', 'estrela'))).corpo.allowed === false);
    conferir('tarólogo inexistente (execução)', (await exec(sched('E', 'fantasma'), chave('sch'))).status === 422);
    conferir('cliente sem vínculo', (await exec(acao('schedule', { clientId: '900116', conversationId: 'chat-sem', tarologistId: 'nyx', payload: { position: 'last' } }), chave('sch'))).status === 422);
    conferir('posição que não é "last"', (await exec(sched('E', 'nyx', { position: 1 }), chave('sch'))).status === 422);
    conferir('nenhum agendamento da cliente E', (await contar('gf_agenda', "id_cliente = '900116'")) === 0);
  });
  await passo('amanhã (data futura) é aceita; paid_intake exige pagamento da cliente e confirmado, e 1 pagamento = 1 agendamento', async () => {
    const futuro = await exec(sched('E', 'nyx', { date: soma(HOJE, 1) }), chave('sch'));
    conferir('data futura', futuro.status === 200 && (await linhaDe(futuro.corpo.result.id)).item.date === soma(HOJE, 1));
    const cancelar = (id) => sequelize.query(`UPDATE gf_agenda SET agenda_outcome = 'Cancelada', item = jsonb_set(item, '{agendaOutcome}', '"Cancelada"') WHERE id = :id`, { replacements: { id } });
    await cancelar(futuro.corpo.result.id);
    const pgOutra = (await consulta("SELECT id FROM gf_pagamentos WHERE id_cliente = '900101' LIMIT 1"))[0].id;
    await autorizar('aut-e-1', { conversationId: 'chat-e', clientId: '900116' });
    const pagar = await exec(acao('payment', { clientId: '900116', conversationId: 'chat-e', payload: { amount: '80.00', mpPaymentId: 'MP-E-1', sourceEventId: 'src-e-1', providerConfirmed: true, proposalId: 'prop-e-1', authorizedBy: 'staff', authorizedEventId: 'aut-e-1' } }), chave('pag'));
    const pgE = pagar.corpo.result.id;
    const pago = (payload = {}) => sched('E', 'nyx', { reason: 'paid_intake', intakeId: 'in-1', paymentId: pgE, ...payload });
    conferir('pagamento de OUTRA cliente: 409', (await exec(pago({ paymentId: pgOutra }), chave('sch'))).status === 409);
    conferir('pagamento inexistente: 409', (await exec(pago({ paymentId: 'PG-nao-existe' }), chave('sch'))).status === 409);
    conferir('sem paymentId: 422', (await exec(sched('E', 'nyx', { reason: 'paid_intake', intakeId: 'in-1' }), chave('sch'))).status === 422);
    const ok = await exec(pago(), chave('sch'));
    conferir('paid_intake com o pagamento da cliente: 200', ok.status === 200 && ok.corpo.result.position === 2, JSON.stringify(ok.corpo));
    conferir('pagamento ligado na auditoria', (await contar('gf_auditoria', "acao = 'lilly.schedule' AND motivo = :m", { m: `payment:${pgE}` })) === 1);
    await cancelar(ok.corpo.result.id);
    const reuso = await exec(pago(), chave('sch'));
    conferir('o mesmo pagamento em OUTRO agendamento: 409 LILLY_PAYMENT_NOT_USABLE', reuso.status === 409 && reuso.corpo.error.code === 'LILLY_PAYMENT_NOT_USABLE');
  });

  console.log('remove_appointment e reschedule');
  const prova = async (n, quem) => { await autorizar(`aut-ag-${n}`, { conversationId: cli[quem][1], clientId: cli[quem][0] }); return { proposalId: `prop-ag-${n}`, authorizedBy: 'staff', authorizedEventId: `aut-ag-${n}` }; };
  await passo('reschedule: muda o dia pelo PATCH da agenda, preserva histórico e devolve {date, position}; repetição idempotente', async () => {
    const bId = (await consulta("SELECT id FROM gf_agenda WHERE id_cliente = '900112' AND agenda_outcome IS NULL"))[0].id;
    const amanha = soma(HOJE, 1);
    const a = acao('reschedule', { clientId: '900112', conversationId: 'chat-b', tarologistId: 'afila', payload: { appointmentId: bId, date: amanha, preserveHistory: true, ...(await prova(1, 'B')) } });
    const k = chave('rem'); const x = await exec(a, k);
    conferir('200 com date e position', x.status === 200 && x.corpo.result.date === amanha && x.corpo.result.position === 1, JSON.stringify(x.corpo));
    const l = await linhaDe(bId); const item = typeof l.item === 'string' ? JSON.parse(l.item) : l.item;
    conferir('dia novo, versão 2, histórico', item.date === amanha && Number(l.version) === 2 && item.scheduleHistory.length === 1 && item.scheduleHistory[0].before.date !== amanha);
    const rep = await exec(a, k);
    conferir('repetição igual, versão intacta', rep.status === 200 && igual(rep.corpo, x.corpo) && Number((await linhaDe(bId)).version) === 2);
    conferir('data passada = 422', (await exec({ ...a, payload: { ...a.payload, date: soma(HOJE, -2), authorizedEventId: (await prova(2, 'B')).authorizedEventId } }, chave('rem'))).status === 422);
  });
  await passo('remove_appointment: cancela preservando o histórico; sem autorização, outra cliente ou já encerrado = recusa', async () => {
    const cId = (await consulta("SELECT id FROM gf_agenda WHERE id_cliente = '900113' AND agenda_outcome IS NULL"))[0].id;
    const base = { clientId: '900113', conversationId: 'chat-c', tarologistId: 'osiris' };
    const semAut = await exec(acao('remove_appointment', { ...base, payload: { appointmentId: cId, preserveHistory: true } }), chave('rem'));
    conferir('sem autorização: 422', semAut.status === 422 && semAut.corpo.error.code === 'LILLY_AUTHORIZATION_MISSING');
    const de_outra = await exec(acao('remove_appointment', { ...base, clientId: '900114', conversationId: 'chat-d', payload: { appointmentId: cId, preserveHistory: true, ...(await prova(3, 'D')) } }), chave('rem'));
    conferir('agendamento de outra cliente: 422', de_outra.status === 422);
    const sem = await exec(acao('remove_appointment', { ...base, payload: { appointmentId: cId, ...(await prova(4, 'C')) } }), chave('rem'));
    conferir('sem preserveHistory: 422', sem.status === 422);
    const a = acao('remove_appointment', { ...base, payload: { appointmentId: cId, preserveHistory: true, ...(await prova(5, 'C')) } });
    const k = chave('rem'); const x = await exec(a, k);
    conferir('200 removido', x.status === 200 && x.corpo.result.id === cId && x.corpo.result.removed === true, JSON.stringify(x.corpo));
    const l = await linhaDe(cId); const item = typeof l.item === 'string' ? JSON.parse(l.item) : l.item;
    conferir('Cancelada, fora da fila, histórico preservado (saída gravada)', l.agenda_outcome === 'Cancelada' && item.agendaOutcome === 'Cancelada' && item.departures.length === 1 && item.departures[0].action === 'cancel');
    conferir('repetição idempotente', igual((await exec(a, k)).corpo, x.corpo) && (await linhaDe(cId)).version === l.version);
    const de_novo = await exec(acao('remove_appointment', { ...base, payload: { appointmentId: cId, preserveHistory: true, ...(await prova(6, 'C')) } }), chave('rem'));
    conferir('já encerrado: 409', de_novo.status === 409);
    conferir('o agendamento da cliente D continua', (await contar('gf_agenda', "id_cliente = '900114' AND agenda_outcome IS NULL")) === 1);
  });
};
