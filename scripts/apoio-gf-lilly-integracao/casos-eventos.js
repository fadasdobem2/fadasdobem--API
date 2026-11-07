'use strict';

/**
 * resolveEvent: `FadasAdapter.resolveEvent(raw, source)` -> `POST /lilly/events/resolve`. A Lilly lê `verified` e `event` (runtime.mjs:354-356) e o
 * evento entra em excludedUmblerChat / normalizeInterpretation / processEvent. Umbler do lado da API: leitor injetado.
 */

module.exports = async ({ adapter, importar, umbler, conferir, passo, log, IntegrationError, AGORA, consulta }) => {
  const escopo = await importar('umbler-conversation-scope.mjs');
  const interp = await importar('interpreter.mjs');
  const webhook = (eventId, extra = {}) => ({ EventId: eventId, EventDate: AGORA.toISOString(), Type: 'Message', Payload: { Type: 'Chat', Content: { Id: 'chat-A', LastMessage: { Id: `msg-${eventId}` } } }, ...extra });
  const conversa = (extra = {}) => ({ organizationId: 'org-teste', contact: { id: 'ct-A', tags: [] }, ...extra });
  const mensagem = (eventId, extra = {}) => ({ id: `msg-${eventId}`, chatId: 'chat-A', isPrivate: false, source: 'Contact', fromContact: { id: 'ct-A' }, sentByOrganizationMember: null, content: 'oi, sou eu', eventAt: new Date(AGORA.getTime() + 1000).toISOString(), ...extra });

  log('resolveEvent (FadasAdapter.resolveEvent -> POST /lilly/events/resolve)');
  await passo('webhook Umbler de cliente vinculada: {verified:true, event} com os campos que o runtime/motor leem', async () => {
    umbler.conversa = conversa(); umbler.mensagem = mensagem('I1');
    const x = await adapter.resolveEvent(webhook('I1'), 'umbler');
    const e = x.event;
    conferir('verified === true (runtime.mjs:356)', x.verified === true);
    conferir('id prefixado, type message, source umbler, actor client, internal false', e.id === 'umbler:I1' && e.type === 'message' && e.source === 'umbler' && e.actor === 'client' && e.internal === false);
    conferir('clientId vem do vínculo (não do texto), conversationId, at ISO', e.clientId === '900101' && e.conversationId === 'chat-A' && !Number.isNaN(Date.parse(e.at)) && e.text === 'oi, sou eu');
    conferir('data é objeto e staffAuthorized false (engine.mjs: command exige true)', e.data && typeof e.data === 'object' && e.data.staffAuthorized === false);
    conferir('evento não é grupo/equipe para a Lilly (excludedUmblerChat, runtime.mjs:358)', escopo.excludedUmblerChat(e) === false);
    const n = interp.normalizeInterpretation(e, { intent: 'greeting', confidence: 0.99 }, { complete: true, clients: [], contact: { phone: '5511998887777' } });
    conferir('normalizeInterpretation (interpreter.mjs) aceita o evento', n && n.actor === 'client' && n.clientId === '900101' && n.data.intent === 'greeting');
  });
  await passo('nota privada de membro autorizado: actor staff, internal true, staffAuthorized true + staffId (base da autorização de pagamento)', async () => {
    umbler.mensagem = mensagem('I2', { isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' }, content: 'sim, pode lançar' });
    const e = (await adapter.resolveEvent(webhook('I2'), 'umbler')).event;
    conferir('staff autorizada', e.actor === 'staff' && e.internal === true && e.data.staffAuthorized === true && e.data.staffId === 'membro-autorizada');
  });
  await passo('mensagem da própria Lilly (metadata.lillyActionId) volta como actor lilly: o runtime a ignora (runtime.mjs:~379)', async () => {
    umbler.mensagem = mensagem('I3', { isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' }, metadata: { lillyActionId: 'A1' } });
    const e = (await adapter.resolveEvent(webhook('I3'), 'umbler')).event;
    conferir('actor lilly', e.actor === 'lilly');
  });
  await passo('reentrega do mesmo EventId devolve o evento guardado (primeiro vence)', async () => {
    umbler.mensagem = mensagem('I1', { content: 'texto diferente na reentrega' });
    const e = (await adapter.resolveEvent(webhook('I1'), 'umbler')).event;
    conferir('texto original', e.text === 'oi, sou eu');
  });
  await passo('evento do site (source trusted + source:site) vai como provider fadas e vira system/site', async () => {
    const raw = { id: 'SI1', source: 'site', actor: 'system', conversationId: 'chat-A', clientId: '900102', tarologistId: '9001', at: AGORA.toISOString(), data: { intent: 'site_consultation_ended', consultationId: 'c-3' } };
    const x = await adapter.resolveEvent(raw, 'trusted');
    const e = x.event;
    conferir('verified + id site:', x.verified === true && e.id === 'site:SI1' && e.source === 'site');
    conferir('actor system, internal false, consultationId e endedAt do banco (README Lilly: devolve endedAt)', e.actor === 'system' && e.internal === false && e.data.consultationId === 'c-3' && e.data.intent === 'site_consultation_ended' && !Number.isNaN(Date.parse(e.data.endedAt)));
    const falso = await adapter.resolveEvent({ ...raw, id: 'SI2' }, 'umbler').then(() => 'aceitou', (err) => err);
    conferir('mensagem Umbler alegando source:site NÃO troca de provedor (adapters.mjs:19): vai como webhook e é recusada com 4xx', falso instanceof IntegrationError && falso.status >= 400 && falso.status < 500 && falso.uncertain === false, String(falso && falso.status));
  });
  await passo('recusas definitivas viram IntegrationError 4xx (uncertain:false): autoria não confirmada e consulta inexistente', async () => {
    umbler.mensagem = mensagem('I4', { fromContact: { id: 'ct-outro' } });
    const a = await adapter.resolveEvent(webhook('I4'), 'umbler').catch((e) => e);
    conferir('contato diferente = 422', a instanceof IntegrationError && a.status === 422 && a.uncertain === false);
    const b = await adapter.resolveEvent({ id: 'SI3', source: 'site', at: AGORA.toISOString(), data: { intent: 'site_consultation_ended', consultationId: 'nao-existe' } }, 'trusted').catch((e) => e);
    conferir('consulta inexistente = 422', b instanceof IntegrationError && b.status === 422 && b.uncertain === false);
    const n = Number((await consulta("SELECT count(*) AS n FROM gf_lilly_eventos WHERE id IN ('umbler:I4','site:SI3')"))[0].n);
    conferir('nada gravado nas recusas', n === 0);
  });
  await passo('Umbler fora do ar na leitura da API: 503 em POST => a Lilly marca uncertain (retenta o evento, runtime.mjs:~385 finishInbox failed)', async () => {
    umbler.falha = Object.assign(new Error('x'), { name: 'UmblerErro', codigo: 'UMBLER_REDE', status: null });
    const e = await adapter.resolveEvent(webhook('I5'), 'umbler').catch((x) => x);
    umbler.falha = null;
    conferir('503 e uncertain:true', e instanceof IntegrationError && e.status === 503 && e.uncertain === true);
  });
};
