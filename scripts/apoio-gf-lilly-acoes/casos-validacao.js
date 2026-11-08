'use strict';

/** Registro dos 15 kinds (13 + request_more_time e team_reply da Lilly v708), flag desligada (403 sem efeito) e os kinds só-Umbler (só validate; sem vínculo = allowed:false com motivo, HTTP 200). */

module.exports = async ({ r, acao, exec, validar, vincular, contar, conferir, passo, chave }) => {
  const registro = require(r('src/gestao-fadas/features/lilly/acoes/acoes.registro'));

  console.log('Executores: registro e flag');
  await passo('os 15 kinds estão registrados; só-Umbler sem executar()', async () => {
    const k = registro.kindsRegistrados();
    conferir('15 kinds', k.length === 15 && [...registro.KINDS_GESTAO, ...registro.KINDS_SO_UMBLER].every((x) => k.includes(x)));
    conferir('só-Umbler sem executar', registro.KINDS_SO_UMBLER.every((x) => registro.obter(x).soUmbler === true && !registro.obter(x).executar));
  });
  await passo('flag GF_LILLY_ACOES_ENABLED desligada: 403 e NENHUM efeito (agenda, pagamento, linha de ação)', async () => {
    const x = await exec(acao('schedule', { clientId: '900111', conversationId: 'chat-a', tarologistId: 'afila', payload: { scope: 'general', position: 'last' } }), chave('off'));
    conferir('403', x.status === 403 && x.corpo.error.code === 'LILLY_ACTIONS_DISABLED');
    const y = await exec(acao('payment', { payload: { amount: '10.00' } }), chave('off'));
    conferir('403 pagamento', y.status === 403);
    conferir('nada gravado', (await contar('gf_agenda')) === 0 && (await contar('gf_pagamentos')) === 0 && (await contar('gf_lilly_acoes')) === 0);
  });
  process.env.GF_LILLY_ACOES_ENABLED = 'true';

  console.log('Kinds só-Umbler: só validate');
  await vincular('900101', 'chat-1', 'ct-1');
  await passo('note/public_reply/mark_attention com vínculo: allowed:true com context; knowledge_proposal valida a forma', async () => {
    for (const [kind, payload] of [['note', { text: 'Nota' }], ['public_reply', { text: 'Olá' }], ['mark_attention', { unread: true, waiting: true }]]) {
      const v = await validar(acao(kind, { payload }));
      conferir(`${kind} permitido`, v.status === 200 && v.corpo.allowed === true && v.corpo.context && v.corpo.context.complete === false);
    }
    const kp = await validar(acao('knowledge_proposal', { clientId: undefined, payload: { question: 'q?', answer: 'a' } }));
    conferir('knowledge_proposal permitido', kp.corpo.allowed === true);
    const kpRuim = await validar(acao('knowledge_proposal', { clientId: undefined, payload: { question: 'q?' } }));
    conferir('knowledge_proposal sem resposta: allowed:false + motivo', kpRuim.status === 200 && kpRuim.corpo.allowed === false && /pergunta e resposta/.test(kpRuim.corpo.reason));
  });
  await passo('cliente SEM vínculo com a conversa: allowed:false com motivo, HTTP 200 (nunca 5xx)', async () => {
    const v = await validar(acao('note', { clientId: '900102', conversationId: 'chat-sem-vinculo', payload: { text: 'x' } }));
    conferir('200 e recusa', v.status === 200 && v.corpo.allowed === false && /vinculada/.test(v.corpo.reason));
    const w = await validar(acao('note', { clientId: '900101', conversationId: 'chat-de-outro', payload: { text: 'x' } }));
    conferir('vínculo de outra conversa', w.corpo.allowed === false);
    const z = await validar(acao('note', { clientId: '999999', payload: { text: 'x' } }));
    conferir('cliente inexistente', z.corpo.allowed === false && /não encontrado/.test(z.corpo.reason));
    const t = await validar(acao('note', { tarologistId: 'fantasma', payload: { text: 'x' } }));
    conferir('tarólogo inexistente', t.corpo.allowed === false && /Tarólogo não encontrado/.test(t.corpo.reason));
    const i = await validar(acao('note', { tarologistId: 'estrela', payload: { text: 'x' } }));
    conferir('tarólogo inativo', i.corpo.allowed === false && /inativo/.test(i.corpo.reason));
  });
  await passo('update_contact devolve o contactId do vínculo; sem vínculo recusa; sem nome recusa', async () => {
    const v = await validar(acao('update_contact', { payload: { name: '900101 - Cliente (Pré-pago)' } }));
    conferir('contactId do vínculo', v.corpo.allowed === true && v.corpo.contactId === 'ct-1');
    const doContato = await validar(acao('update_contact', { payload: { name: 'x' } }), { conversation: { contact: { id: 'outro' } } });
    conferir('vínculo vence a leitura da conversa', doContato.corpo.contactId === 'ct-1');
    const sem = await validar(acao('update_contact', { clientId: '900102', conversationId: 'chat-zz', payload: { name: 'x' } }));
    conferir('sem vínculo', sem.corpo.allowed === false);
    const semNome = await validar(acao('update_contact', { payload: {} }));
    conferir('sem nome', semNome.corpo.allowed === false);
  });
  await passo('só-Umbler em POST /lilly/actions: 422 e nenhum efeito', async () => {
    const x = await exec(acao('note', { payload: { text: 'x' } }), chave('umb'));
    conferir('422 não habilitada', x.status === 422 && x.corpo.error.code === 'LILLY_ACTION_UNSUPPORTED');
    conferir('nenhuma linha guardada', (await contar('gf_lilly_acoes')) === 0);
  });
};
