'use strict';

/** Contexto v710: `revision` inteira (muda com o estado), agendamento com `revision`/`queueReservation`, consulta com `billing.funding`, pagamento com `purchase` e `continuationCredit`. */

module.exports = async (c) => {
  const { sequelize, conferir, passo, contexto, vincular, criarNaFila, criarNaFilaDe, gate, como, presenca, n } = c;
  console.log('Contexto v710 (revisão e linhas)');
  await vincular('900101', 'chat-1');
  await presenca('livre', 'livre');
  await sequelize.query("INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, nome, cadastro_ativo, perfil, revisao, atualizado_por) VALUES ('livre', NULL, 'Livre', true, '{}', 1, 'teste') ON CONFLICT DO NOTHING", { logging: false });
  const f1 = await criarNaFila('ag-v1', '900101');
  await passo('fila geral criada pelo gate (versão 1)', () => conferir('200', f1.status === 200, f1.t));

  let revisao1;
  await passo('revision é um INTEIRO seguro e estável sem mudança; o snapshot traz o agendamento com revision e SEM reserva', async () => {
    const a = await contexto({ conversationId: 'chat-1', clientId: '900101' });
    const b = await contexto({ conversationId: 'chat-1', clientId: '900101' });
    revisao1 = a.revision;
    conferir('inteiro seguro', Number.isSafeInteger(a.revision));
    conferir('estável entre duas leituras iguais e igual para outro escopo (conversa diferente)', a.revision === b.revision && (await contexto({ conversationId: 'chat-sem-nada' })).revision === a.revision);
    const ag = a.appointments.find((x) => x.id === 'ag-v1');
    conferir('agendamento com revision (versão da linha) e sem queueReservation', ag && ag.revision === 1 && !('queueReservation' in ag));
    conferir('arrays novos presentes (cotações vazias sem consulta)', Array.isArray(a.consultationClosingQuotes) && Array.isArray(a.appointmentPositionQuotes));
  });
  await passo('qualquer mudança no estado operacional muda a revision (outra cliente entrando na fila)', async () => {
    await criarNaFilaDe('ag-v-outra', 'nyx', '900102');
    const depois = await contexto({ conversationId: 'chat-1', clientId: '900101' });
    conferir('revision diferente', depois.revision !== revisao1);
  });
  await passo('reserva VIGENTE aparece em queueReservation (tarotId/tarologistId/at/by); fora de vigência (liberada) não aparece', async () => {
    const ag = (await contexto({ conversationId: 'chat-1', clientId: '900101' })).appointments.find((x) => x.id === 'ag-v1');
    const v = (await gate('GET', '/agenda')).j.versions['ag-v1'];
    como('atendente');
    const x = await gate('POST', '/agenda/ag-v1/route-general', { operationKey: n(), expectedVersion: v, tarotId: 'livre', mode: 'reserve' });
    conferir('reserva pelo serviço da Fila Geral (200)', x.status === 200, x.t);
    const com = (await contexto({ conversationId: 'chat-1', clientId: '900101' })).appointments.find((y) => y.id === 'ag-v1');
    conferir('queueReservation vigente', com.queueReservation && com.queueReservation.tarotId === 'livre' && com.queueReservation.tarologistId === 'livre' && com.queueReservation.by === 'Khloe' && com.revision === 2);
    const l = await gate('POST', '/agenda/ag-v1/reservation/release', { operationKey: n(), expectedVersion: 2 });
    conferir('liberada (200)', l.status === 200, l.t);
    const livre = (await contexto({ conversationId: 'chat-1', clientId: '900101' })).appointments.find((y) => y.id === 'ag-v1');
    conferir('sem queueReservation depois de liberar', !('queueReservation' in livre));
    void ag;
  });
  await passo('pagamento: purchase.minutes e continuationCredit só quando GRAVADOS no lançamento (nada calculado pela tarifa); consulta: billing.funding só com paymentId e minutos', async () => {
    await sequelize.query(`INSERT INTO gf_pagamentos (id, id_cliente, valor_centavos, metodo, status, confirmacao, informado_em, item, criado_por, operation_key)
      VALUES ('pg-v1', '900101', 5920, 'PIX', 'Informado', 'Confirmado', now(), :item::jsonb, 'teste', 'k-pg-v1'), ('pg-v2', '900101', 3000, 'PIX', 'Informado', 'Confirmado', now(), '{}'::jsonb, 'teste', 'k-pg-v2')`,
    { replacements: { item: JSON.stringify({ purchase: { amount: 59.2, minutes: 20 }, continuationCredit: { consultationId: 'C-X', minutesBefore: 10, addedMinutes: 20, minutesAfter: 30 } }) }, logging: false }).catch((e) => { throw new Error(`insert gf_pagamentos: ${e.message}`); });
    const snap = await contexto({ conversationId: 'chat-1', clientId: '900101' });
    const p1 = snap.payments.find((x) => x.id === 'pg-v1'); const p2 = snap.payments.find((x) => x.id === 'pg-v2');
    conferir('pg-v1 traz purchase {amount, minutes} e continuationCredit {consultationId, minutesBefore, addedMinutes, minutesAfter}', p1 && p1.purchase.minutes === 20 && p1.purchase.amount === 59.2 && p1.continuationCredit.addedMinutes === 20 && p1.continuationCredit.minutesAfter === 30);
    conferir('pg-v2 sem os campos (nenhum minuto inventado pela tarifa)', p2 && !('purchase' in p2) && !('continuationCredit' in p2));
  });
};
