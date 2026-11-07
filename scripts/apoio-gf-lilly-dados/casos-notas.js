'use strict';

/** Notas do horário (GET /lilly/schedule-notes) e repositórios de pagamento-refs, cotações e avisos. */

module.exports = async ({ r, avulso, chamar, conferir, passo }) => {
  const registro = require(r('src/gestao-fadas/features/lilly/acoes/acoes.registro'));
  const { gravarNotaHorario } = require(r('src/gestao-fadas/features/lilly/notas/notas-horario.servico'));
  const refs = require(r('src/gestao-fadas/features/lilly/dados/pagamento-refs.repo'));
  const cotacoes = require(r('src/gestao-fadas/features/lilly/dados/cotacoes.repo'));
  const avisos = require(r('src/gestao-fadas/features/lilly/dados/avisos.repo'));

  console.log('Notas do horário e repositórios');
  registro.registrar('tarologist_schedule_note', {
    validar: async () => ({ allowed: true }),
    executar: (acao, { executor }) => gravarNotaHorario(executor, { ...acao.payload, conversationId: acao.conversationId }),
  });
  const nota = { id: 'nota-1', tarologistId: '9001', date: '2026-11-07', status: 'waiting', text: 'Chega às 15h', at: '2026-11-07T14:00:00Z', expectedAt: '2026-11-07T15:00:00Z' };

  await passo('ação tarologist_schedule_note grava a nota (idempotente) e o GET devolve no formato do contrato', async () => {
    const x = await chamar('POST', '/lilly/actions', { corpo: { action: { kind: 'tarologist_schedule_note', conversationId: 'chat-t', tarologistId: '9001', payload: nota } }, chave: 'evt-n1:nota:chat-t' });
    conferir('committed', x.status === 200 && x.corpo.result.id === 'nota-1' && x.corpo.result.status === 'waiting');
    await chamar('POST', '/lilly/actions', { corpo: { action: { kind: 'tarologist_schedule_note', conversationId: 'chat-t', tarologistId: '9001', payload: { ...nota, text: 'outro texto' } } }, chave: 'evt-n2:nota:chat-t' });
    const g = await chamar('GET', '/lilly/schedule-notes?tarologistId=9001&date=2026-11-07');
    conferir('1 nota (id repetido não duplica; a primeira vence)', g.status === 200 && g.corpo.notes.length === 1 && g.corpo.notes[0].text === 'Chega às 15h');
    const n = g.corpo.notes[0];
    conferir('campos do contrato', n.id === 'nota-1' && n.tarologistId === '9001' && n.date === '2026-11-07' && n.status === 'waiting' && n.at === '2026-11-07T14:00:00.000Z');
  });
  await passo('GET filtra por tarólogo e dia; resposta sem notas é lista vazia', async () => {
    conferir('outro dia', (await chamar('GET', '/lilly/schedule-notes?tarologistId=9001&date=2026-11-08')).corpo.notes.length === 0);
    conferir('outro tarólogo', (await chamar('GET', '/lilly/schedule-notes?tarologistId=9002&date=2026-11-07')).corpo.notes.length === 0);
  });
  await passo('nota inválida (estado, data, texto) é recusada em 422 e não grava', async () => {
    const tentar = async (payload, chave) => chamar('POST', '/lilly/actions', { corpo: { action: { kind: 'tarologist_schedule_note', conversationId: 'chat-t', payload } }, chave });
    conferir('estado', (await tentar({ ...nota, id: 'n2', status: 'qualquer' }, 'evt-n3:nota:chat-t')).status === 422);
    conferir('data', (await tentar({ ...nota, id: 'n3', date: '07/11/2026' }, 'evt-n4:nota:chat-t')).status === 422);
    conferir('texto', (await tentar({ ...nota, id: 'n4', text: '  ' }, 'evt-n5:nota:chat-t')).status === 422);
    conferir('nada gravado', (await chamar('GET', '/lilly/schedule-notes?tarologistId=9001&date=2026-11-07')).corpo.notes.length === 1);
  });

  await passo('repositórios: referências de pagamento (único por payment_id), cotações (uma atual), avisos', async () => {
    const a = await refs.gravarRefs(avulso, { paymentId: 'pg-1', reference: 'REF-1', mpPaymentId: 'mp-1', sourceEventId: 'e1', authorizedEventId: 'umbler:E3' });
    const b = await refs.gravarRefs(avulso, { paymentId: 'pg-1', reference: 'OUTRA' });
    conferir('refs: repetido guarda o primeiro', a.repetida === false && b.repetida === true && b.ref.reference === 'REF-1');
    conferir('busca por referência', (await refs.buscarPorReferencias(avulso, { reference: 'REF-1' })).length === 1 && (await refs.buscarPorReferencias(avulso, { mpPaymentId: 'nada' })).length === 0);
    await cotacoes.gravarCotacao(avulso, { id: 'c1', conversationId: 'chat-1', createdAt: '2026-11-07T10:00:00Z', amountCentavos: 8880, minutes: 30 });
    await cotacoes.gravarCotacao(avulso, { id: 'c2', conversationId: 'chat-1', clientId: '900101', createdAt: '2026-11-07T11:00:00Z', amountCentavos: 14800, minutes: 50 });
    const cs = await cotacoes.listarPorConversa(avulso, 'chat-1');
    conferir('cotações: só a última é atual', cs.length === 2 && cs[0].current === false && cs[1].current === true && cs[1].amountCentavos === 14800);
    await avisos.gravarAviso(avulso, { id: 'av1', conversationId: 'chat-1', clientId: '900101', appointmentId: 'ag-1', messageId: 'm9', sentAt: '2026-11-07T12:00:00Z', autor: 'Lilly' });
    await avisos.gravarAviso(avulso, { id: 'av1', conversationId: 'chat-1', sentAt: '2026-11-07T13:00:00Z' });
    conferir('avisos: idempotente por id', (await avisos.listarPorConversa(avulso, 'chat-1')).length === 1 && (await avisos.listarPorAgendamento(avulso, 'ag-1'))[0].messageId === 'm9');
  });
};
