'use strict';

/** reorder_appointment: cotação da fila no contexto, revisão da fila, comando de ordem EXISTENTE, só a posição muda, recusas, idempotência e o código REAL da Lilly. */

module.exports = async (c) => {
  const { r, acao, exec, validar, conciliar, contexto, evento, consulta, contar, conferir, passo, chave, igual, lilly, vincular, criarNaFilaDe, presenca } = c;
  const v = require(r('src/gestao-fadas/features/lilly/v710/comum'));
  console.log('reorder_appointment');
  await vincular('900104', 'chat-2');
  await presenca('osiris', 'osiris');
  for (const [id, cliente] of [['ag-p1', '900104'], ['ag-p2', '900105'], ['ag-p3', '900106']]) {
    const x = await criarNaFilaDe(id, 'osiris', cliente); conferir(`${id} criado (200)`, x.status === 200, x.t);
  }
  await evento('ev-pos', { conversationId: 'chat-2', clientId: '900104', staff: true });
  const ler = async () => { const s = await contexto({ conversationId: 'chat-2', clientId: '900104' }); const row = s.appointments.find((x) => x.id === 'ag-p1'); const q = s.appointmentPositionQuotes.filter((x) => x.appointmentId === 'ag-p1'); return { s, row, q, revision: s.revision }; };
  const pedido = async (posicao, sobre = {}, extra = {}) => {
    const { row, q, revision } = await ler();
    return acao('reorder_appointment', { clientId: '900104', tarologistId: 'osiris', conversationId: 'chat-2', ...extra, payload: {
      appointmentId: 'ag-p1', position: posicao, expectedRevision: revision, expectedQueueRevision: q[0].revision, orderedAppointmentIds: q[0].orderedAppointmentIds, expectedAppointment: v.impressaoDaLinha(row),
      author: { id: 'membro-autorizada', name: 'Khloe' }, sourceEventId: 'ev-pos', sourceConversationId: 'chat-2', ...sobre } });
  };
  const outras = async () => JSON.stringify((await consulta("SELECT id, id_cliente, id_tarologo, data_operacional, agenda_outcome, item - 'positionOverrides' - 'orderCommand' AS item FROM gf_agenda ORDER BY id")));
  const efetiva = async () => (await ler()).row.effectivePosition;

  await passo('contexto: uma cotação de fila por agendamento aberto da cliente em foco (ids únicos, revisão queue-v1, expiração) e effectivePosition = lugar real na fila', async () => {
    const { s, row, q } = await ler();
    conferir('uma cotação, current, ids únicos da fila do tarólogo na ordem', q.length === 1 && q[0].current === true && new Set(q[0].orderedAppointmentIds).size === 3 && q[0].orderedAppointmentIds.includes('ag-p1') && q[0].tarologistId === 'osiris');
    conferir('revisão no formato queue-v1 e expiração futura', /^queue-v1:\d+:[0-9a-f]{32}$/.test(q[0].revision) && Date.parse(q[0].expiresAt) > Date.now());
    conferir('effectivePosition do agendamento = posição na lista', row.effectivePosition === q[0].orderedAppointmentIds.indexOf('ag-p1') + 1);
    conferir('outras clientes da fila não ganham cotação nem posição efetiva (só as em foco)', s.appointmentPositionQuotes.every((x) => x.clientId === '900104') && s.appointments.filter((x) => x.id !== 'ag-p1').every((x) => !('effectivePosition' in x)));
  });
  await passo('Lilly REAL: validateStaffAgendaAction aceita a ação montada com o contexto da API (revisão, fila e impressão)', async () => {
    const m = await lilly('staff-agenda-commands.mjs');
    if (!m) return conferir('clone da Lilly indisponível: pulado', true);
    const { s } = await ler();
    const a = await pedido(3, {}, { id: 'a1', staffAgendaEvidence: { kind: 'reorder_appointment', appointmentId: 'ag-p1', clientId: '900104', tarologistId: 'osiris', at: new Date().toISOString() } });
    const ok1 = m.validateStaffAgendaAction(a, { ...s, complete: true }, {}, s.now);
    conferir(`allowed (${ok1.allowed ? 'sim' : ok1.reason})`, ok1.allowed === true);
    const velha = m.validateStaffAgendaAction({ ...a, payload: { ...a.payload, expectedQueueRevision: 'queue-v1:0:x' } }, { ...s, complete: true }, {}, s.now);
    conferir('a Lilly recusa fila velha (sensível)', velha.allowed === false);
  });

  const antes = await efetiva(); const outrasAntes = await outras(); const k1 = chave('pos'); let a1; let x1;
  await passo('mover para a 3ª posição: validate permite; execute usa o comando de ordem; só positionOverrides/orderCommand mudam; a posição real passa a ser 3', async () => {
    a1 = await pedido(3);
    conferir('validate permite', (await validar(a1)).corpo.allowed === true);
    x1 = await exec(a1, k1);
    conferir('200 committed', x1.status === 200 && x1.corpo.committed === true, x1.t);
    conferir('posição devolvida = 3 e a efetiva do contexto = 3', x1.corpo.result.position === 3 && (await efetiva()) === 3 && antes !== 3);
    conferir('NADA além da posição mudou nos agendamentos (identidade, data, horário, cliente)', (await outras()) === outrasAntes);
    conferir('comando de ordem gravado (applied) e auditoria da Lilly', (await contar('gf_agenda_ordem_comandos', "status = 'applied'")) === 1 && (await contar('gf_auditoria', "acao = 'lilly.reorder_appointment'")) === 1);
    conferir('histórico do agendamento tem o autor (Khloe) no comando', (await consulta("SELECT item->'orderCommand'->>'actorName' AS n FROM gf_agenda WHERE id = 'ag-p1'"))[0].n === 'Khloe');
  });
  await passo('repetição: mesma chave devolve o mesmo e não grava de novo; GET committed; a posição já é a pedida (outra chave): 409', async () => {
    const comandos = await contar('gf_agenda_ordem_comandos');
    const rep = await exec(a1, k1);
    conferir('mesmo corpo, nenhum comando novo', rep.status === 200 && igual(rep.corpo, x1.corpo) && (await contar('gf_agenda_ordem_comandos')) === comandos);
    conferir('GET committed', (await conciliar(k1)).corpo.committed === true);
    const mesma = await exec(await pedido(3), chave('pos'));
    conferir('já está nessa posição: 409 LILLY_STATE_CHANGED', mesma.status === 409 && mesma.corpo.error.code === 'LILLY_STATE_CHANGED', mesma.t);
  });
  await passo('recusas 4xx definitivas, nada gravado: posição 0, acima do tamanho, não inteira, fila velha, lista adulterada, impressão velha, revisão velha, autoria não provada, tarólogo errado, sem origem', async () => {
    const comandos = await contar('gf_agenda_ordem_comandos'); const estado = await outras();
    const t = async (nome, a, status, code) => { const x = await exec(a, chave('pos')); conferir(`${nome}: ${status} ${code || ''}`, x.status === status && (!code || x.corpo.error.code === code), x.t); };
    await t('posição 0', await pedido(0), 422, 'INVALID_INPUT');
    await t('posição acima do tamanho', await pedido(4), 422, 'LILLY_POSITION_INVALID');
    await t('posição não inteira', await pedido(1.5), 422, 'INVALID_INPUT');
    await t('fila velha (revisão da fila)', await pedido(1, { expectedQueueRevision: 'queue-v1:1:00000000000000000000000000000000' }), 409, 'LILLY_QUEUE_CHANGED');
    await t('lista adulterada', await pedido(1, { orderedAppointmentIds: ['ag-p1', 'ag-p2'] }), 409, 'LILLY_QUEUE_CHANGED');
    await t('impressão do agendamento velha', await pedido(1, { expectedAppointment: 'x'.repeat(64) }), 409, 'LILLY_APPOINTMENT_CHANGED');
    await t('revisão do snapshot velha', await pedido(1, { expectedRevision: 1 }), 409, 'LILLY_REVISION_CHANGED');
    await t('autoria não provada (outro staffId)', await pedido(1, { author: { id: 'outra', name: 'Outra' } }), 422, 'LILLY_AUTHORIZATION_MISSING');
    await t('origem de outra conversa', await pedido(1, { sourceConversationId: 'chat-9' }), 422, 'INVALID_INPUT');
    await t('tarólogo errado', await pedido(1, {}, { tarologistId: 'nyx' }), 422);
    await t('cliente sem vínculo com a conversa', await pedido(1, {}, { clientId: '900105' }), 422);
    conferir('nada gravado', (await contar('gf_agenda_ordem_comandos')) === comandos && (await outras()) === estado);
    const k = chave('pos'); const a = await pedido(0); const d1 = await exec(a, k); const d2 = await exec(a, k);
    conferir('recusa definitiva repete igual com a mesma chave', d1.status === 422 && d2.status === 422 && igual(d1.corpo, d2.corpo));
  });
  await passo('voltar para a 1ª posição funciona (outra mudança de revisão) e a ordem fica a pedida', async () => {
    const x = await exec(await pedido(1), chave('pos'));
    conferir('200 e posição 1', x.status === 200 && x.corpo.result.position === 1 && (await efetiva()) === 1, x.t);
  });
};
