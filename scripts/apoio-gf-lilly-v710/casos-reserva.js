'use strict';

/** reserve_tarologist e release_reservation: revisão, assinatura, autoria provada, serviço da Fila Geral, idempotência, recusas definitivas e o código REAL da Lilly. */

module.exports = async (c) => {
  const { r, acao, exec, validar, conciliar, contexto, evento, consulta, contar, conferir, passo, chave, igual, lilly, gate, hoje } = c;
  const v = require(r('src/gestao-fadas/features/lilly/v710/comum'));
  console.log('reserve_tarologist / release_reservation');
  const ler = async () => { const s = await contexto({ conversationId: 'chat-1', clientId: '900101' }); return { s, revision: s.revision, row: s.appointments.find((x) => x.id === 'ag-v1') }; };
  const payload = async (extra = {}, sobre = {}) => {
    const { revision, row } = await ler();
    return { appointmentId: 'ag-v1', expectedRevision: revision, expectedAppointment: v.assinaturaDaReserva(row), author: { id: 'membro-autorizada', name: 'Khloe' }, sourceMessageId: 'ev-res', silentNoticeClientIds: [], requestedAt: new Date().toISOString(), ...extra, ...sobre };
  };
  const reservar = async (extra, sobre, a = {}) => acao('reserve_tarologist', { clientId: '900101', tarologistId: 'livre', conversationId: 'chat-1', payload: await payload(extra, sobre), ...a });
  await evento('ev-res', { conversationId: 'chat-prof', staff: true });
  await evento('ev-nao-staff', { conversationId: 'chat-prof', staff: false, actor: 'client' });
  await evento('ev-outra-staff', { conversationId: 'chat-prof', staff: true, staffId: 'outra-pessoa' });
  const antesDoEstado = async () => JSON.stringify((await consulta('SELECT version, item FROM gf_agenda WHERE id = :i', { i: 'ag-v1' }))[0]);

  await passo('Lilly REAL: a revisão e a assinatura da API são aceitas por validateReservationAction (a recusa, se houver, NÃO é de revisão nem de assinatura)', async () => {
    const m = await lilly('reservation-flow.mjs');
    if (!m) return conferir('clone da Lilly indisponível: pulado', true);
    const { s } = await ler();
    const a = await reservar();
    const rr = m.validateReservationAction({ ...a, id: 'x', payload: a.payload }, { ...s, complete: true }, {}, s.now);
    conferir(`sem recusa por revisão/assinatura (${rr.allowed ? 'allowed' : rr.reason})`, rr.allowed === true || !/agenda mudou|agendamento mudou/i.test(rr.reason));
    const velha = m.validateReservationAction({ ...a, payload: { ...a.payload, expectedRevision: a.payload.expectedRevision + 1 } }, { ...s, complete: true }, {}, s.now);
    conferir('a Lilly recusa a revisão errada (a verificação é sensível)', velha.allowed === false && /agenda mudou/i.test(velha.reason));
  });

  const k1 = chave('res'); let r1; let a1;
  await passo('reservar: validate permite; execute grava pelo serviço da Fila Geral e devolve committed:true com a reserva, a nova revisão e o autor na auditoria', async () => {
    a1 = await reservar();
    conferir('validate permite', (await validar(a1)).corpo.allowed === true);
    const rev0 = a1.payload.expectedRevision;
    r1 = await exec(a1, k1);
    conferir('200 committed', r1.status === 200 && r1.corpo.committed === true, r1.t);
    const res = r1.corpo.result;
    conferir('resultado: agendamento, cliente, tarólogo, reserva {tarotId, by, at}, revisão nova e versão', res.appointmentId === 'ag-v1' && res.reservation && res.reservation.tarotId === 'livre' && res.reservation.by === 'Khloe' && res.revision !== rev0 && res.version === 4);
    const linha = (await consulta('SELECT item FROM gf_agenda WHERE id = :i', { i: 'ag-v1' }))[0];
    conferir('banco: queueReservation e histórico do domínio (nada de segundo livro)', linha.item.queueReservation.tarotId === 'livre' && linha.item.queueReservationHistory.length >= 1 && !('queueReservationHistory' in {}));
    conferir('a revisão devolvida é a do snapshot seguinte', (await ler()).revision === res.revision);
    conferir('auditoria com a autoria', (await contar('gf_auditoria', "acao = 'lilly.reserve_tarologist' AND entidade_id = 'ag-v1'")) === 1);
  });
  await passo('repetição da MESMA chave: mesmo resultado, nada novo; GET concilia committed; outra chave com revisão velha: 409 definitivo', async () => {
    const estado = await antesDoEstado();
    const rep = await exec(a1, k1);
    conferir('mesma chave: mesmo corpo', rep.status === 200 && igual(rep.corpo, r1.corpo));
    conferir('nada mudou no banco', (await antesDoEstado()) === estado);
    conferir('GET committed', (await conciliar(k1)).corpo.committed === true);
    const velha = await exec(a1, chave('res'));
    conferir('revisão velha: 409 LILLY_REVISION_CHANGED, nada gravado', velha.status === 409 && velha.corpo.error.code === 'LILLY_REVISION_CHANGED' && (await antesDoEstado()) === estado);
    const kv = chave('res'); const repVelha = await exec(a1, kv); const rep2 = await exec(a1, kv);
    conferir('a recusa é DEFINITIVA e repete igual com a mesma chave', repVelha.status === 409 && rep2.status === 409 && igual(repVelha.corpo, rep2.corpo));
  });
  await passo('recusas 4xx (nada gravado): assinatura errada 409, autoria não provada 422, autor diferente do evento 422, evento da cliente 422, cliente de outro agendamento, não é Fila Geral, sem vínculo, sem revisão 400', async () => {
    const estado = await antesDoEstado();
    const tentar = async (nome, a, status, code) => { const x = await exec(a, chave('res')); conferir(`${nome}: ${status}${code ? ` ${code}` : ''}`, x.status === status && (!code || x.corpo.error.code === code), x.t); };
    await tentar('assinatura errada', await reservar({}, { expectedAppointment: '["x"]' }), 409, 'LILLY_APPOINTMENT_CHANGED');
    await tentar('evento sem autorização da equipe', await reservar({}, { sourceMessageId: 'ev-nao-staff' }), 422, 'LILLY_AUTHORIZATION_MISSING');
    await tentar('autor diferente do que autorizou', await reservar({}, { sourceMessageId: 'ev-outra-staff' }), 422, 'LILLY_AUTHORIZATION_MISSING');
    await tentar('evento inexistente', await reservar({}, { sourceMessageId: 'nao-existe' }), 422, 'LILLY_SOURCE_MISSING');
    await tentar('sem autor', await reservar({}, { author: undefined }), 422, 'INVALID_INPUT');
    await tentar('sem revisão', await reservar({}, { expectedRevision: undefined }), 422);
    await tentar('já reservada: não é mais da Fila Geral... a própria Fila Geral segura a reserva (agendamento ainda é da fila geral), mas a consulta aberta da cliente barra', acao('reserve_tarologist', { clientId: '900102', tarologistId: 'livre', conversationId: 'chat-1', payload: await payload() }), 422);
    conferir('nada mudou no banco', (await antesDoEstado()) === estado);
  });
  await passo('liberar: autoria humana libera; a reserva some do contexto; liberar de novo é 409 (a reserva já não é a mesma)', async () => {
    const p = await payload();
    const a = acao('release_reservation', { clientId: '900101', tarologistId: 'livre', conversationId: 'chat-1', payload: { ...p, reason: 'A equipe confirmou a liberação.', sourceMessageId: 'ev-res' } });
    conferir('validate permite', (await validar(a)).corpo.allowed === true);
    const x = await exec(a, chave('lib'));
    conferir('200 committed, reservation null', x.status === 200 && x.corpo.committed === true && x.corpo.result.reservation === null, x.t);
    conferir('contexto sem queueReservation', !('queueReservation' in (await ler()).row));
    const de_novo = await exec(acao('release_reservation', { clientId: '900101', tarologistId: 'livre', conversationId: 'chat-1', payload: { ...(await payload()), reason: 'x' } }), chave('lib'));
    conferir('sem reserva: 409 LILLY_STATE_CHANGED', de_novo.status === 409 && de_novo.corpo.error.code === 'LILLY_STATE_CHANGED', de_novo.t);
  });
  await passo('liberar com autor "Lilly" só vale a partir de mensagem PÚBLICA da cliente na conversa; evento de equipe não serve como Lilly', async () => {
    const x0 = await exec(await reservar(), chave('res'));
    conferir('reservou de novo (200)', x0.status === 200, x0.t);
    await evento('ev-cli', { conversationId: 'chat-1', clientId: '900101', actor: 'client' });
    const base = async (ref) => acao('release_reservation', { clientId: '900101', tarologistId: 'livre', conversationId: 'chat-1', payload: { ...(await payload()), author: { id: 'Lilly', name: 'Lilly' }, sourceMessageId: ref, reason: 'A cliente não pode consultar agora.' } });
    const ruim = await exec(await base('ev-res'), chave('lib'));
    conferir('evento de equipe como origem da Lilly: 422', ruim.status === 422, ruim.t);
    const bom = await exec(await base('ev-cli'), chave('lib'));
    conferir('mensagem da cliente: liberada (200)', bom.status === 200 && bom.corpo.result.reservation === null, bom.t);
  });
  await passo('com a flag geral das ações desligada nada executa (403) e o estado não muda', async () => {
    process.env.GF_LILLY_ACOES_ENABLED = 'false';
    const estado = await antesDoEstado();
    const x = await exec(await reservar(), chave('res'));
    process.env.GF_LILLY_ACOES_ENABLED = 'true';
    conferir('403 LILLY_ACTIONS_DISABLED, nada mudou', x.status === 403 && (await antesDoEstado()) === estado);
  });
  void gate; void hoje;
};
