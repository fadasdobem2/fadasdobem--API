'use strict';

/** request_more_time: registra sem minutos, sem cobrança e sem encerrar; webhook repetido não duplica; pedido posterior abre outro ciclo. */

module.exports = async (c) => {
  const { acao, exec, validar, conciliar, consulta, contar, conferir, passo, chave, igual, sequelize } = c;
  const CONS = 'C-MT-1';
  await sequelize.query(
    `INSERT INTO gf_consultas_ext (id, id_tarologo, id_cliente, status, comissao_percentual, aguardando_inicio, iniciada_em, tarologo_iniciou_em, duracao_segundos, item, criado_por, operation_key)
     VALUES (:id, 'osiris', '900101', 'Em curso', 40, FALSE, now() - interval '20 minutes', now() - interval '19 minutes', 0, '{"expectedMinutes":30}'::jsonb, 'teste', 'k-mt-1'),
            ('C-MT-2', 'osiris', '900102', 'Concluída', 40, FALSE, now() - interval '3 hours', now() - interval '3 hours', 1800, '{}'::jsonb, 'teste', 'k-mt-2')`,
    { replacements: { id: CONS }, logging: false },
  );
  const instante = (minutosAtras) => new Date(Date.now() - minutosAtras * 60000).toISOString();
  const pedido = (extra = {}, sobre = {}) => acao('request_more_time', {
    clientId: '900101', tarologistId: 'osiris', conversationId: 'chat-t1',
    payload: { consultationId: CONS, clientId: '900101', tarologistId: 'osiris', requestedAt: instante(5), sourceEventId: 'umbler:MT1', sourceConversationId: 'chat-t1', label: 'Pediu mais tempo', changesDuration: false, closeConsultation: false, ...extra },
    ...sobre,
  });
  const consultaAntes = async () => JSON.stringify((await consulta('SELECT status, duracao_segundos, encerrada_em, item, version FROM gf_consultas_ext WHERE id = :id', { id: CONS }))[0]);

  console.log('request_more_time');
  const k1 = chave('mt'); let r1; const p1 = pedido();
  const antes = await consultaAntes(); const pagAntes = await contar('gf_pagamentos');
  await passo('consulta em curso, cliente e profissional conferem: registra o pedido (ciclo 1) SEM mexer em minutos, cobrança ou encerramento', async () => {
    const v = await validar(p1);
    conferir('validate permite', v.status === 200 && v.corpo.allowed === true);
    r1 = await exec(p1, k1);
    conferir('200 committed: ciclo 1, rótulo, sem efeito', r1.status === 200 && r1.corpo.committed === true && r1.corpo.result.cycle === 1 && r1.corpo.result.label === 'Pediu mais tempo' && r1.corpo.result.changesDuration === false && r1.corpo.result.closeConsultation === false);
    const l = (await consulta('SELECT * FROM gf_lilly_mais_tempo WHERE consulta_id = :c', { c: CONS }))[0];
    conferir('registro: cliente, profissional, evento, conversa, sem alterar duração nem encerrar', l && l.id_cliente === '900101' && l.id_tarologo === 'osiris' && l.source_event_id === 'umbler:MT1' && l.source_conversation_id === 'chat-t1' && l.altera_duracao === false && l.encerra_consulta === false);
    conferir('a consulta NÃO mudou (status, duração, encerramento, versão)', (await consultaAntes()) === antes);
    conferir('nenhum pagamento/cobrança criado', (await contar('gf_pagamentos')) === pagAntes);
    conferir('auditoria', (await contar('gf_auditoria', "acao = 'lilly.request_more_time' AND entidade_id = :c", { c: CONS })) === 1);
  });
  await passo('webhook repetido NÃO duplica: mesma chave devolve o mesmo; outra chave com o MESMO evento devolve o mesmo ciclo (duplicate)', async () => {
    const rep = await exec(p1, k1);
    conferir('mesma chave: mesmo resultado', rep.status === 200 && igual(rep.corpo, r1.corpo));
    const outra = await exec(pedido(), chave('mt'));
    conferir('mesmo evento, outra chave: mesmo ciclo 1 e mesmo ID, marcado duplicate', outra.status === 200 && outra.corpo.result.id === r1.corpo.result.id && outra.corpo.result.cycle === 1 && outra.corpo.result.duplicate === true);
    conferir('um registro só', (await contar('gf_lilly_mais_tempo', 'consulta_id = :c', { c: CONS })) === 1);
    conferir('GET concilia', (await conciliar(k1)).corpo.committed === true);
  });
  await passo('pedido POSTERIOR na mesma consulta abre OUTRO ciclo e preserva o anterior; um mais antigo não reabre nada', async () => {
    const novoCiclo = await exec(pedido({ requestedAt: instante(1), sourceEventId: 'umbler:MT2' }), chave('mt'));
    conferir('ciclo 2', novoCiclo.status === 200 && novoCiclo.corpo.result.cycle === 2 && novoCiclo.corpo.result.id !== r1.corpo.result.id);
    const fora = await exec(pedido({ requestedAt: instante(30), sourceEventId: 'umbler:MT0' }), chave('mt'));
    conferir('fora de ordem (mais antigo que o último): sem novo ciclo', fora.status === 200 && fora.corpo.result.cycle === 2 && fora.corpo.result.duplicate === true);
    const ciclos = await consulta('SELECT ciclo, source_event_id FROM gf_lilly_mais_tempo WHERE consulta_id = :c ORDER BY ciclo', { c: CONS });
    conferir('ciclos 1 e 2 preservados', ciclos.length === 2 && ciclos[0].source_event_id === 'umbler:MT1' && ciclos[1].source_event_id === 'umbler:MT2');
    conferir('a consulta segue intacta', (await consultaAntes()) === antes && (await contar('gf_pagamentos')) === pagAntes);
  });
  await passo('contrato: changesDuration/closeConsultation precisam ser false; cliente/profissional/consulta errados; consulta fora de curso; profissional inativo', async () => {
    const recusas = [
      ['changesDuration true', pedido({ changesDuration: true, sourceEventId: 'umbler:X1' })],
      ['closeConsultation true', pedido({ closeConsultation: true, sourceEventId: 'umbler:X2' })],
      ['closeConsultation ausente', pedido({ closeConsultation: undefined, sourceEventId: 'umbler:X3' })],
      ['sem sourceEventId', pedido({ sourceEventId: undefined })],
      ['requestedAt inválido', pedido({ requestedAt: 'ontem', sourceEventId: 'umbler:X4' })],
      ['requestedAt no futuro', pedido({ requestedAt: new Date(Date.now() + 3600000).toISOString(), sourceEventId: 'umbler:X5' })],
      ['consulta de OUTRA cliente', pedido({ consultationId: 'C-MT-1', clientId: '900102', sourceEventId: 'umbler:X6' }, { clientId: '900102' })],
      ['consulta de outro profissional', pedido({ tarologistId: 'nyx', sourceEventId: 'umbler:X7' }, { tarologistId: 'nyx' })],
      ['consulta já concluída', pedido({ consultationId: 'C-MT-2', clientId: '900102', sourceEventId: 'umbler:X8' }, { clientId: '900102' })],
      ['consulta inexistente', pedido({ consultationId: 'C-NADA', sourceEventId: 'umbler:X9' })],
      ['profissional inativo', pedido({ tarologistId: 'estrela', sourceEventId: 'umbler:X10' }, { tarologistId: 'estrela' })],
      ['conversa de origem diferente da ação', pedido({ sourceConversationId: 'outra', sourceEventId: 'umbler:X11' })],
    ];
    for (const [nome, a] of recusas) {
      const v = await validar(a); const x = await exec(a, chave('mt'));
      conferir(`${nome}: validate recusa e execução 4xx`, v.corpo.allowed === false && x.status >= 400 && x.status < 500);
    }
    conferir('nenhum registro a mais', (await contar('gf_lilly_mais_tempo', 'consulta_id = :c', { c: CONS })) === 2);
  });
  await passo('conversa vinculada a OUTRA cliente recusa (a conversa do profissional não tem vínculo e passa)', async () => {
    await c.vincular('900102', 'chat-t9', 'ct-t9');
    const x = await exec(pedido({ sourceEventId: 'umbler:Y1', requestedAt: instante(0.5), sourceConversationId: 'chat-t9' }, { conversationId: 'chat-t9' }), chave('mt'));
    conferir('4xx', x.status === 422);
  });
};
