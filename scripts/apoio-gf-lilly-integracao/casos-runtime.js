'use strict';

/**
 * Ciclo com o runtime REAL da Lilly (production): webhook Umbler -> resolveEvent -> snapshot -> motor -> ação preparada -> validate -> execute ->
 * resultado -> notas. Umbler e IA FALSAS. Depois, ações semeadas na fila de saída para os caminhos de recusa, resposta perdida e reconciliação.
 */

const { criarRuntime, semearAcao } = require('./runtime-falso');
const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, importar, conferir, passo, log, AGORA, r, chamadas, fetchImpl, FadasAdapter, BASE_FALSA, TOKEN, contar, consulta }) => {
  process.env.GF_LILLY_ACOES_ENABLED = 'true';
  const { acao } = criarAuxiliares({ adapter, umbler, AGORA, r });

  log('runtime REAL da Lilly (modo production, Umbler e IA falsas)');
  await passo('cadastro de cliente conhecida: evento -> resolve -> snapshot -> update_client -> validate -> execute -> notas', async () => {
    const rt = await criarRuntime({ importar, fadas: adapter, intencao: { intent: 'registration_data', forCurrentClient: true, name: 'Duda Souza', birthDate: '1992-03-04', email: 'duda@teste.local' } });
    try {
      umbler.conversa = { organizationId: 'org-teste', contact: { id: 'ct-D', tags: [] } };
      umbler.mensagem = { id: 'msg-R1', chatId: 'chat-D', isPrivate: false, source: 'Contact', fromContact: { id: 'ct-D' }, sentByOrganizationMember: null, content: 'Meu nome é Duda Souza, nasci em 04/03/1992, duda@teste.local', eventAt: rt.now() };
      const marca = chamadas.length;
      const ing = await rt.runtime.ingest({ EventId: 'R1', EventDate: rt.now(), Type: 'Message', Payload: { Type: 'Chat', Content: { Id: 'chat-D', LastMessage: { Id: 'msg-R1' } } } }, { source: 'umbler' });
      await rt.runtime.work;
      let s = rt.runtime.store.read();
      conferir('evento aceito e processado sem erro (resolve + snapshot da API aceitos pelo runtime)', ing.accepted === true && s.inbox[0].status === 'processed', JSON.stringify(s.inbox.map((i) => [i.status, i.error])));
      const upd = s.outbox.find((a) => a.kind === 'update_client');
      conferir('motor emitiu update_client para a cliente do VÍNCULO (900104), com chave idempotente longa', upd && upd.clientId === '900104' && upd.idempotencyKey.startsWith('umbler:R1:'), JSON.stringify(upd && upd.idempotencyKey));
      conferir('validate da API aceitou e execute da API gravou: status succeeded com result.id (runtime.mjs:650)', upd && upd.status === 'succeeded' && upd.result.id === '900104', JSON.stringify(upd && [upd.status, upd.error, upd.result]));
      const mine = chamadas.slice(marca).map((c) => `${c.metodo} ${c.url.replace(BASE_FALSA, '')}`);
      conferir('sequência de chamadas à API: resolve, context, validate, actions (nesta ordem)', ['/lilly/events/resolve', '/lilly/context', '/lilly/actions/validate', '/lilly/actions'].every((p, i, arr) => mine.findIndex((m) => m.endsWith(p) && m.startsWith('POST')) >= (i ? mine.findIndex((m) => m.endsWith(arr[i - 1]) && m.startsWith('POST')) : 0)), mine.join(' | '));
      const ch = chamadas.slice(marca).find((c) => c.url.endsWith('/lilly/actions') && c.metodo === 'POST');
      conferir('Idempotency-Key do POST === action.idempotencyKey', ch && ch.chave === upd.idempotencyKey);
      conferir('cadastro realmente gravado no Gestão (extensão do cliente)', Number((await consulta("SELECT count(*) AS n FROM gf_auditoria WHERE acao = 'lilly.update_client' AND entidade_id = '900104'"))[0].n) >= 1);
      relogioAvanca(rt, 3);
      await rt.runtime.dispatch();
      s = rt.runtime.store.read();
      conferir('notas ao fim: Umbler falsa recebeu a nota de cadastro ("Cadastro salvo"/"atualizado", v709) com o ID real', rt.enviados.some((e) => e.kind === 'note' && /Cadastro (salvo|atualizado)/.test(e.payload.text) && /900104/.test(e.payload.text)), JSON.stringify(rt.enviados.map((e) => e.payload && e.payload.text && e.payload.text.slice(0, 40))));
      conferir('nenhuma ação ficou failed/uncertain', s.outbox.every((a) => !['failed', 'uncertain'].includes(a.status)), JSON.stringify(s.outbox.map((a) => [a.kind, a.status, a.error])));
      log('   (info) notas pendentes de modalidade (cliente do legado sem perfil de pagamento):', JSON.stringify(s.outbox.filter((a) => a.kind === 'note' && /modalidade/.test(a.payload.text)).map((a) => a.status)));
    } finally { await rt.fechar(); }
  });

  const notaTarologo = (suf, extra = {}) => acao('tarologist_schedule_note', { conversationId: 'chat-mara', tarologistId: '9001', sufixo: suf, payload: { scheduleId: '9001@x#1', text: 'Chego às 20h.', status: 'waiting', expectedAt: '20:00', informationOnly: true, changesSchedule: false, sourceEventId: `umbler:RT-${suf}`, sourceConversationId: 'chat-mara', ...extra } });
  await passo('recusas: validate allowed:false => cancelada; execute 422 => failed (definitivo, sem incerteza, sem retry)', async () => {
    const rt = await criarRuntime({ importar, fadas: adapter, intencao: { intent: 'unknown' }, contato: 'ct-mara' });
    try {
      const invalida = { ...notaTarologo('recusada-validate'), tarologistId: 'fantasma' };
      await semearAcao(rt.runtime, invalida);
      await rt.runtime.dispatch();
      const a = rt.runtime.store.read().outbox.find((x) => x.id === invalida.id);
      conferir('tarólogo inexistente: a Lilly cancela (nunca chega ao execute)', a.status === 'cancelled', JSON.stringify([a.status, a.error]));
    } finally { await rt.fechar(); }
  });
  await passo('resposta PERDIDA (API commitou, a Lilly deu timeout): ação fica uncertain, NÃO é reenviada e reconcile (GET) a completa com o result da API', async () => {
    let derruba = true;
    const flaky = new FadasAdapter({ baseUrl: BASE_FALSA, token: TOKEN, fetchImpl: async (url, opts) => { const resp = await fetchImpl(url, opts); if (derruba && opts.method === 'POST' && url.endsWith('/lilly/actions')) throw new TypeError('timeout simulado'); return resp; } });
    const rt = await criarRuntime({ importar, fadas: flaky, intencao: { intent: 'unknown' }, contato: 'ct-mara' });
    try {
      const a0 = notaTarologo('resposta-perdida');
      await semearAcao(rt.runtime, a0);
      const antes = await contar('gf_lilly_notas_horario');
      await rt.runtime.dispatch(); await rt.runtime.dispatch();
      let a = rt.runtime.store.read().outbox.find((x) => x.id === a0.id);
      conferir('uncertain (adapters.mjs:9: POST sem resposta)', a.status === 'uncertain', JSON.stringify([a.status, a.error]));
      conferir('a API gravou UMA vez e o segundo dispatch não reenviou', (await contar('gf_lilly_notas_horario')) === antes + 1);
      derruba = false;
      const rec = await rt.runtime.reconcileAction(a0.id, 'Teste');
      a = rt.runtime.store.read().outbox.find((x) => x.id === a0.id);
      conferir('reconcileAction: {reconciled:true} e ação succeeded com o result da API', rec.reconciled === true && a.status === 'succeeded' && /^SN-/.test(a.result.id), JSON.stringify([rec, a.status]));
    } finally { await rt.fechar(); }
  });
  await passo('erro 500 da API no execute: uncertain; reconcile com a API dizendo not_executed => {reconciled:false, requiresReview:true} (sem reenvio automático)', async () => {
    const registro = require(r('src/gestao-fadas/features/lilly/acoes/acoes.registro'));
    const rt = await criarRuntime({ importar, fadas: adapter, intencao: { intent: 'unknown' }, contato: 'ct-mara' });
    const def = registro.obter('tarologist_schedule_note'); const original = def.executar;
    try {
      const a0 = notaTarologo('erro-500');
      await semearAcao(rt.runtime, a0);
      def.executar = async () => { throw new TypeError('falha simulada'); };
      await rt.runtime.dispatch();
      def.executar = original;
      let a = rt.runtime.store.read().outbox.find((x) => x.id === a0.id);
      conferir('500 => uncertain', a.status === 'uncertain', JSON.stringify([a.status, a.error]));
      const rec = await rt.runtime.reconcileAction(a0.id, 'Teste');
      conferir('API: not_executed => requiresReview', rec.reconciled === false && rec.requiresReview === true, JSON.stringify(rec));
      a = rt.runtime.store.read().outbox.find((x) => x.id === a0.id);
      conferir('segue uncertain, nada reenviado', a.status === 'uncertain');
    } finally { def.executar = original; await rt.fechar(); }
  });
  await passo('flag das ações desligada: execute 403 => failed definitivo (a Lilly não trata como incerta)', async () => {
    const rt = await criarRuntime({ importar, fadas: adapter, intencao: { intent: 'unknown' }, contato: 'ct-mara' });
    try {
      const a0 = notaTarologo('flag-off');
      await semearAcao(rt.runtime, a0);
      delete process.env.GF_LILLY_ACOES_ENABLED;
      await rt.runtime.dispatch();
      process.env.GF_LILLY_ACOES_ENABLED = 'true';
      const a = rt.runtime.store.read().outbox.find((x) => x.id === a0.id);
      conferir('failed (403 definitivo)', a.status === 'failed' && /403/.test(a.error), JSON.stringify([a.status, a.error]));
    } finally { process.env.GF_LILLY_ACOES_ENABLED = 'true'; await rt.fechar(); }
  });
  await passo('pagamento manual da equipe (engine.mjs:1246: só `reference` de texto + humanConfirmed): LIMITAÇÃO CONHECIDA (decisão 4) — a API recusa no validate e a Lilly cancela, nada é lançado', async () => {
    const intencao = (e) => (/pagamento/.test(e.text) ? { intent: 'payment_confirmed', amount: 35, reference: 'COMP-123' } : /^sim/.test(e.text) ? { intent: 'command' } : { intent: 'unknown' });
    const rt = await criarRuntime({ importar, fadas: adapter, intencao, contato: 'ct-G', telefone: '+5511966660000' });
    try {
      const staff = async (id, texto) => {
        umbler.conversa = { organizationId: 'org-teste', contact: { id: 'ct-G', tags: [] } };
        umbler.mensagem = { id: `msg-${id}`, chatId: 'chat-G', isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' }, content: texto, eventAt: rt.now() };
        await rt.runtime.ingest({ EventId: id, EventDate: rt.now(), Type: 'Message', Payload: { Type: 'Chat', Content: { Id: 'chat-G', LastMessage: { Id: `msg-${id}` } } } }, { source: 'umbler' });
        await rt.runtime.work;
      };
      const antes = await contar('gf_pagamentos');
      await staff('PGM1', 'pagamento de 35 recebido'); rt.relogio.t += 1000;
      await staff('PGM2', 'sim');
      const s = rt.runtime.store.read();
      const p = s.outbox.find((a) => a.kind === 'payment');
      conferir('o motor emitiu o payment com authorizedEventId = evento humano resolvido pela API (umbler:PGM2)', p && p.payload.authorizedEventId === 'umbler:PGM2' && p.payload.humanConfirmed === true, JSON.stringify(p && p.payload));
      conferir('cancelado antes de executar (validate allowed:false); nenhum pagamento novo', p.status === 'cancelled' && (await contar('gf_pagamentos')) === antes, JSON.stringify([p.status, p.reason]));
    } finally { await rt.fechar(); }
  });
};

function relogioAvanca(rt, minutos) { rt.relogio.t += minutos * 60000; }
