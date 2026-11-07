'use strict';

/** start_consultation (serviço da equipe, relógio do servidor, repetição sem reiniciar) e tarologist_schedule_note (sem tocar escala). */

module.exports = async ({ igual, r, acao, exec, validar, vincular, chamar, consulta, contar, conferir, passo, chave, HOJE }) => {
  const ciclo = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const { traduzirStatusConsulta } = require(r('src/gestao-fadas/features/lilly/consultas/status'));
  const equipe = { user: { id: process.env.LILLY_SERVICE_USER_ID, nome: 'Khloe', role: 'ATENDENTE' }, accessContext: { roleIds: [] }, params: {} };
  let seq = 0;
  /** Consulta lançada pela equipe (preparada, aguardando o início do tarólogo): é o que a Lilly vê em `consultations[]`. */
  const preparar = async (id, clientId, tarotId) => {
    await ciclo.lancar({ ...equipe, body: { operationKey: `prep-${id}-${(seq += 1)}-abcdef`, record: { id, clientId, client: `Cliente ${clientId}`, tarotId, tarot: tarotId, paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', observation: 'x', expectedMinutes: 30 } } });
  };
  const linha = async (id) => (await consulta('SELECT status, version, item, id_cliente FROM gf_consultas_ext WHERE id = :id', { id }))[0];
  const item = async (id) => { const l = await linha(id); return typeof l.item === 'string' ? JSON.parse(l.item) : l.item; };
  const inicio = (id, quem, extra = {}) => acao('start_consultation', {
    clientId: quem.clientId, conversationId: quem.conv, tarologistId: quem.tarot,
    payload: { consultationId: id, clientId: quem.clientId, tarologistId: quem.tarot, startedAt: new Date().toISOString(), sourceEventId: `evt-${id}`, sourceConversationId: quem.conv, expectedStatus: 'prepared', minutes: 30, channel: 'WhatsApp', ddd: '11', ...extra },
  });

  console.log('start_consultation');
  const qA = { clientId: '900121', conv: 'chat-s', tarot: 'osiris' };
  await vincular('900121', 'chat-s');
  await preparar('con-l1', '900121', 'osiris');
  await passo('a consulta lançada pela equipe está PREPARADA para a Lilly (tradução de status)', async () => {
    const i = await item('con-l1');
    conferir('prepared', traduzirStatusConsulta({ status: i.status, awaitingTarologistStart: i.awaitingTarologistStart }) === 'prepared');
  });
  await passo('recusas sem efeito: consulta inexistente, cliente/tarólogo trocados, status/versão esperados errados, mensagem anterior à preparação', async () => {
    const v0 = (await linha('con-l1')).version;
    conferir('inexistente', (await exec(inicio('con-nao-existe', qA), chave('ini'))).status === 404);
    conferir('tarólogo trocado', (await exec({ ...inicio('con-l1', qA), tarologistId: 'nyx', payload: { ...inicio('con-l1', qA).payload, tarologistId: 'nyx' } }, chave('ini'))).status === 422);
    const vv = await validar(inicio('con-l1', qA, { expectedStatus: 'in_progress' }));
    conferir('validate: só preparada', vv.status === 200 && vv.corpo.allowed === false);
    conferir('versão esperada errada: 409', (await exec(inicio('con-l1', qA, { expectedVersion: 99 }), chave('ini'))).corpo.error.code === 'LILLY_VERSION_CHANGED');
    conferir('mensagem anterior à preparação: 409', (await exec(inicio('con-l1', qA, { startedAt: '2001-01-01T00:00:00.000Z' }), chave('ini'))).status === 409);
    conferir('nada mudou', Number((await linha('con-l1')).version) === Number(v0) && (await item('con-l1')).awaitingTarologistStart === true);
  });
  const k = chave('ini');
  let r1; let a1;
  await passo('inicia: {id, startedAt} só depois do commit; relógio do SERVIDOR (não o da mensagem); auditoria com a hora da mensagem', async () => {
    const mensagem = new Date(Date.now() - 1).toISOString();
    const a = a1 = inicio('con-l1', qA, { startedAt: mensagem, expectedVersion: Number((await linha('con-l1')).version) });
    const v = await validar(a);
    conferir('validate permite', v.corpo.allowed === true, JSON.stringify(v.corpo));
    r1 = await exec(a, k);
    const res = r1.corpo.result;
    conferir('200 {id, startedAt}', r1.status === 200 && r1.corpo.committed === true && r1.corpo.committed === true && res.id === 'con-l1' && res.consultationId === 'con-l1' && res.status === 'in_progress', JSON.stringify(r1.corpo));
    const i = await item('con-l1');
    conferir('startedAt = o do servidor gravado, em ISO', res.startedAt === new Date(i.tarologistStartedAt).toISOString() && Date.parse(res.startedAt) >= Date.parse(mensagem) && !i.awaitingTarologistStart);
    conferir('persistido (commit feito antes da resposta)', Number((await linha('con-l1')).version) === res.version && traduzirStatusConsulta({ status: i.status, awaitingTarologistStart: i.awaitingTarologistStart }) === 'in_progress');
    conferir('auditoria com a hora da mensagem', (await contar('gf_auditoria', "acao = 'lilly.start_consultation' AND entidade_id = 'con-l1'")) === 1);
  });
  await passo('repetição (mesma chave) devolve o MESMO startedAt sem reiniciar o relógio; chave nova depois de iniciada: 409 com o início real', async () => {
    await new Promise((f) => setTimeout(f, 30));
    const rep = await exec(a1, k);
    conferir('repetição: mesmo resultado, 200', rep.status === 200 && igual(rep.corpo.result, r1.corpo.result));
    const dif = await exec({ ...a1, payload: { ...a1.payload, startedAt: new Date().toISOString() } }, k);
    conferir('mesma chave com outra hora de mensagem (corpo diferente): 409 OPERATION_KEY_CONFLICT', dif.status === 409 && dif.corpo.error.code === 'OPERATION_KEY_CONFLICT');
    const rep2 = await chamar('GET', `/lilly/actions/${encodeURIComponent(k)}`);
    conferir('conciliação: confirmada com o mesmo startedAt', rep2.corpo.committed === true && rep2.corpo.result.startedAt === r1.corpo.result.startedAt);
    const nova = await exec(inicio('con-l1', qA), chave('ini'));
    conferir('chave nova: 409 LILLY_STATE_CHANGED com o início real', nova.status === 409 && nova.corpo.error.code === 'LILLY_STATE_CHANGED' && nova.corpo.error.message.includes(new Date(r1.corpo.result.startedAt).toISOString().slice(0, 16)));
    conferir('relógio intacto', new Date((await item('con-l1')).tarologistStartedAt).toISOString() === r1.corpo.result.startedAt);
  });
  await passo('NÃO cria consulta nem lança pagamento: contagens iguais', async () => {
    conferir('1 consulta e nenhum pagamento novo desta ação', (await contar('gf_consultas_ext')) === 1);
  });

  console.log('tarologist_schedule_note');
  const antesEscala = async () => [await contar('gf_escalas_semanais'), await contar('gf_horarios_excecoes'), await contar('gf_horarios_periodos'), await contar('gf_agenda')];
  const nota = (extra = {}, payload = {}) => acao('tarologist_schedule_note', {
    clientId: undefined, conversationId: 'chat-t', tarologistId: 'osiris',
    payload: { scheduleId: `S-osiris-${HOJE}-1`, text: 'Chegada confirmada às 10:00.', status: 'arrived', informationOnly: true, changesSchedule: false, sourceEventId: 'evt-nota-1', sourceConversationId: 'chat-t', ...payload }, ...extra,
  });
  const kn = chave('nota');
  let rn;
  await passo('chegada: grava a nota, lê pelo GET /lilly/schedule-notes e NÃO mexe em escala, exceções, períodos nem agenda', async () => {
    const antes = await antesEscala();
    const v = await validar(nota());
    conferir('validate permite', v.corpo.allowed === true);
    rn = await exec(nota(), kn);
    conferir('200 com a nota', rn.status === 200 && rn.corpo.result.status === 'arrived' && rn.corpo.result.tarologistId === 'osiris' && rn.corpo.result.date === HOJE);
    const g = await chamar('GET', `/lilly/schedule-notes?tarologistId=osiris&date=${HOJE}`);
    conferir('GET devolve a nota', g.status === 200 && g.corpo.notes.length === 1 && g.corpo.notes[0].id === rn.corpo.result.id && g.corpo.notes[0].status === 'arrived');
    conferir('escala/agenda intactas', JSON.stringify(await antesEscala()) === JSON.stringify(antes));
    conferir('auditada', (await contar('gf_auditoria', "acao = 'lilly.tarologist_schedule_note'")) === 1);
  });
  await passo('repetição idempotente (mesma chave e outro evento igual): uma nota só; corpo diferente 409', async () => {
    const rep = await exec(nota(), kn);
    conferir('mesma resposta', rep.status === 200 && rep.corpo.result.id === rn.corpo.result.id);
    const mesmoEvento = await exec(nota(), chave('nota'));
    conferir('mesmo evento de origem com chave nova: mesma nota', mesmoEvento.status === 200 && mesmoEvento.corpo.result.id === rn.corpo.result.id && mesmoEvento.corpo.result.repeated === true);
    conferir('1 nota', (await contar('gf_lilly_notas_horario')) === 1);
    conferir('409', (await exec(nota({}, { text: 'Outro texto' }), kn)).status === 409);
  });
  await passo('recado com horário esperado (HH:mm): vira instante do fuso de São Paulo; só informativa; tarólogo precisa existir', async () => {
    const r2 = await exec(nota({}, { status: 'waiting', text: 'Chega às 14:30.', expectedAt: '14:30', date: HOJE, sourceAt: new Date().toISOString(), sourceEventId: 'evt-nota-2' }), chave('nota'));
    conferir('200 waiting', r2.status === 200 && r2.corpo.result.status === 'waiting');
    const l = (await consulta('SELECT expected_at FROM gf_lilly_notas_horario WHERE id = :id', { id: r2.corpo.result.id }))[0];
    conferir('14:30 de São Paulo = 17:30Z', new Date(l.expected_at).toISOString() === `${HOJE}T17:30:00.000Z`);
    conferir('informationOnly:false recusa', (await exec(nota({}, { informationOnly: false, sourceEventId: 'evt-nota-3' }), chave('nota'))).status === 422);
    conferir('changesSchedule:true recusa', (await exec(nota({}, { changesSchedule: true, sourceEventId: 'evt-nota-4' }), chave('nota'))).status === 422);
    conferir('horário inválido', (await exec(nota({}, { expectedAt: '25:99', sourceEventId: 'evt-nota-5' }), chave('nota'))).status === 422);
    conferir('tarólogo inexistente (validate)', (await validar(nota({ tarologistId: 'fantasma' }))).corpo.allowed === false);
  });
};
