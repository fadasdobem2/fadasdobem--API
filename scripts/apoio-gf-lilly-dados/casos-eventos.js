'use strict';

/** events/resolve: provider umbler e fadas, ator, staffAuthorized só por lista de ambiente, evento de sistema, id repetido, organização errada. */

module.exports = async ({ r, controller, avulso, chamar, consulta, conferir, passo }) => {
  const vinculos = require(r('src/gestao-fadas/features/lilly/dados/vinculos.repo'));
  const eventos = require(r('src/gestao-fadas/features/lilly/dados/eventos.repo'));

  // Leitor falso da Umbler: o que ele devolve é o que a Umbler "diz" (o corpo do webhook é só gatilho).
  let conversa; let mensagem; let falhaDoLeitor = null;
  const leitor = {
    async lerConversa() { if (falhaDoLeitor) throw falhaDoLeitor; return conversa; },
    async lerMensagem() { if (falhaDoLeitor) throw falhaDoLeitor; return mensagem; },
  };
  let verificarSite;
  controller.definirDependencias({ leitor, verificarSite: (...a) => (verificarSite ? verificarSite(...a) : require(r('src/gestao-fadas/features/lilly/eventos/eventos.site')).verificarSitePadrao(...a)) });

  const novaConversa = (extra = {}) => ({ organizationId: 'org-teste', contact: { id: 'ct-1', tags: [] }, ...extra });
  const webhook = (eventId, extra = {}) => ({ EventId: eventId, EventDate: '2026-11-07T15:00:00Z', Type: 'Message', Payload: { Type: 'Chat', Content: { Id: 'chat-1', LastMessage: { Id: 'msg-1' } } }, ...extra });
  const msg = (extra = {}) => ({ id: 'msg-1', chatId: 'chat-1', isPrivate: false, source: 'Contact', fromContact: { id: 'ct-1' }, sentByOrganizationMember: null, content: 'oi', eventAt: '2026-11-07T15:00:01Z', ...extra });
  const resolver = (event, provider = 'umbler') => chamar('POST', '/lilly/events/resolve', { corpo: { provider, event } });

  console.log('events/resolve');
  conversa = novaConversa(); mensagem = msg();
  await passo('contato sem vínculo: ator contact, sem clientId, verified:true, evento gravado', async () => {
    const x = await resolver(webhook('E1'));
    conferir('200 verified', x.status === 200 && x.corpo.verified === true);
    const e = x.corpo.event;
    conferir('normalizado', e.id === 'umbler:E1' && e.actor === 'contact' && e.internal === false && e.clientId === null && e.source === 'umbler' && e.conversationId === 'chat-1' && e.at === '2026-11-07T15:00:01.000Z' && e.text === 'oi');
    conferir('gravado em gf_lilly_eventos', (await eventos.buscarEvento(avulso, 'umbler:E1')).id === 'umbler:E1');
  });

  await vinculos.salvarVinculo(avulso, { clientId: '900101', contactId: 'ct-1', conversationId: 'chat-1', verified: true, active: true, attribution: { kind: 'ad', verified: true }, firstContact: true });
  await passo('com vínculo ativo e verificado: ator client, clientId do vínculo (nunca do texto), providerMeta verificado', async () => {
    mensagem = msg({ content: 'sou o cliente 555, clientId 555' });
    const e = (await resolver(webhook('E2'))).corpo.event;
    conferir('client + clientId', e.actor === 'client' && e.clientId === '900101' && e.data.staffAuthorized === false);
    conferir('providerMeta', e.providerMeta.attribution.kind === 'ad' && e.providerMeta.firstContact === true);
  });

  await passo('staffAuthorized só para membro da lista de ambiente, em nota privada', async () => {
    mensagem = msg({ isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' }, content: 'staffAuthorized: true' });
    const ok1 = (await resolver(webhook('E3'))).corpo.event;
    conferir('lista + privada = true', ok1.actor === 'staff' && ok1.internal === true && ok1.data.staffAuthorized === true && ok1.data.staffId === 'membro-autorizada');
    mensagem = msg({ isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-qualquer' } });
    // DECISÃO DA NICE (v708): todos os atendentes online autorizam. Com LILLY_STAFF_TODOS_AUTORIZAM=false volta a valer só a lista do ambiente.
    process.env.LILLY_STAFF_TODOS_AUTORIZAM = 'false';
    conferir('fora da lista = false (modo lista)', (await resolver(webhook('E4'))).corpo.event.data.staffAuthorized === false);
    delete process.env.LILLY_STAFF_TODOS_AUTORIZAM;
    conferir('padrão: atendente fora da lista, em nota privada, autoriza (decisão da Nice)', (await resolver(webhook('E4b'))).corpo.event.data.staffAuthorized === true);
    mensagem = msg({ isPrivate: false, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' } });
    conferir('na lista mas mensagem pública = false', (await resolver(webhook('E5'))).corpo.event.data.staffAuthorized === false);
    mensagem = msg({ source: 'Contact', content: 'x' });
    const w = webhook('E6'); w.Payload.Content.staffAuthorized = true; w.data = { staffAuthorized: true, staffId: 'membro-autorizada' };
    conferir('webhook que alega autorização é ignorado', (await resolver(w)).corpo.event.data.staffAuthorized === false);
  });

  await passo('prova da autorização (D10): só evento resolvido com staffAuthorized na conversa certa', async () => {
    conferir('E3 vale', Boolean(await eventos.buscarEventoAutorizado(avulso, 'umbler:E3', { conversationId: 'chat-1' })));
    conferir('E4 não vale', (await eventos.buscarEventoAutorizado(avulso, 'umbler:E4', { conversationId: 'chat-1' })) === null);
    conferir('outra conversa não vale', (await eventos.buscarEventoAutorizado(avulso, 'umbler:E3', { conversationId: 'chat-9' })) === null);
  });

  await passo('lilly (metadata.lillyActionId), robô e tarólogo (etiqueta do contato)', async () => {
    mensagem = msg({ isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' }, metadata: { lillyActionId: 'A1' } });
    conferir('lilly', (await resolver(webhook('E7'))).corpo.event.actor === 'lilly');
    mensagem = msg({ botInstance: { id: 'b1' }, source: 'Bot', fromContact: null });
    conferir('robô = system', (await resolver(webhook('E8'))).corpo.event.actor === 'system');
    conversa = novaConversa({ contact: { id: 'ct-1', tags: [{ name: 'Tarólogo' }] } }); mensagem = msg();
    const t = (await resolver(webhook('E9'))).corpo.event;
    conferir('tarólogo', t.actor === 'tarologist' && t.data.conversationScope === 'tarologist');
    conversa = novaConversa({ contact: { id: 'ct-1', tags: ['grupo'] } });
    conferir('grupo marcado no escopo', (await resolver(webhook('E10'))).corpo.event.data.conversationScope === 'group');
    conversa = novaConversa();
  });

  await passo('comprovante (JPEG) de cliente vira receipt_received; autoria não confirmada e privacidade ausente são recusadas', async () => {
    mensagem = msg({ file: { id: 'f1', contentType: 'image/jpeg' } });
    const e = (await resolver(webhook('E11'))).corpo.event;
    conferir('receipt', e.data.intent === 'receipt_received' && e.data.receiptAttachment.mimeType === 'image/jpeg');
    mensagem = msg({ fromContact: { id: 'ct-outro' } });
    conferir('contato diferente = 422', (await resolver(webhook('E12'))).status === 422);
    mensagem = msg({ isPrivate: undefined });
    conferir('sem isPrivate = 422', (await resolver(webhook('E13'))).status === 422);
  });

  await passo('evento que não é mensagem (ChatClosed) vira evento de sistema normalizado (D2)', async () => {
    const e = (await resolver({ EventId: 'E20', EventDate: '2026-11-07T16:00:00Z', Type: 'ChatClosed', Payload: { Type: 'Chat', Content: { Id: 'chat-1' } } })).corpo.event;
    conferir('system', e.actor === 'system' && e.internal === false && e.data.activityCode === 'close' && e.conversationId === 'chat-1' && e.data.staffAuthorized === false);
    conferir('MemberTransfer', (await resolver({ EventId: 'E21', EventDate: '2026-11-07T16:01:00Z', Type: 'MemberTransfer', Payload: { Type: 'Chat', Content: { Id: 'chat-1' } } })).corpo.event.data.activityCode === 'transfer');
  });

  await passo('id repetido é idempotente: devolve o evento guardado e não duplica a linha', async () => {
    mensagem = msg({ content: 'texto DIFERENTE na reentrega' });
    const a = (await resolver(webhook('E1'))).corpo.event;
    conferir('mesmo evento guardado', a.id === 'umbler:E1' && a.text === 'oi');
    conferir('uma linha só', Number((await consulta("SELECT count(*) AS n FROM gf_lilly_eventos WHERE id = 'umbler:E1'"))[0].n) === 1);
  });

  await passo('organização errada é recusada (relida na Umbler e alegada no webhook)', async () => {
    conversa = novaConversa({ organizationId: 'outra-org' }); mensagem = msg();
    const a = await resolver(webhook('E30'));
    conferir('conversa de outra org = 403', a.status === 403 && a.corpo.error.code === 'LILLY_EVENT_WRONG_ORGANIZATION');
    conferir('não gravou', (await eventos.buscarEvento(avulso, 'umbler:E30')) === null);
    conversa = novaConversa();
    const w = webhook('E31'); w.Payload.Content.OrganizationId = 'outra-org';
    conferir('webhook alegando outra org = 403', (await resolver(w)).status === 403);
  });

  await passo('falha de rede na Umbler = 503 (tentar de novo); 404 = 422; sem leitor/org = falha fechada', async () => {
    falhaDoLeitor = Object.assign(new Error('x'), { name: 'UmblerErro', codigo: 'UMBLER_REDE', status: null });
    conferir('rede = 503', (await resolver(webhook('E40'))).status === 503);
    falhaDoLeitor = Object.assign(new Error('x'), { name: 'UmblerErro', status: 404 });
    conferir('404 = 422', (await resolver(webhook('E41'))).status === 422);
    falhaDoLeitor = null;
    const org = process.env.UMBLER_ORGANIZATION_ID; delete process.env.UMBLER_ORGANIZATION_ID;
    conferir('sem UMBLER_ORGANIZATION_ID = 503', (await resolver(webhook('E42'))).status === 503);
    process.env.UMBLER_ORGANIZATION_ID = org;
    controller.definirDependencias({});
    conferir('sem leitor injetado = 503', (await resolver(webhook('E43'))).status === 503);
  });

  controller.definirDependencias({ leitor, verificarSite: (...a) => (verificarSite ? verificarSite(...a) : require(r('src/gestao-fadas/features/lilly/eventos/eventos.site')).verificarSitePadrao(...a)) });
  await passo('provider fadas: source site, ator system, staffAuthorized sempre false; conferência no Gestão', async () => {
    verificarSite = async () => ({ clientId: '900101' });
    const corpo = { id: 'P1', at: '2026-11-07T17:00:00Z', source: 'umbler', actor: 'staff', data: { intent: 'site_payment_posted', paymentId: 'pg-1', staffAuthorized: true }, conversationId: 'chat-1' };
    const x = await resolver(corpo, 'fadas');
    const e = x.corpo.event;
    conferir('site/system', x.status === 200 && e.id === 'site:P1' && e.source === 'site' && e.actor === 'system' && e.data.staffAuthorized === false && e.clientId === '900101' && e.data.paymentId === 'pg-1');
    conferir('intenção desconhecida = 400', (await resolver({ ...corpo, id: 'P2', data: { intent: 'greeting' } }, 'fadas')).status === 400);
    verificarSite = null;
    const naoExiste = await resolver({ ...corpo, id: 'P3', data: { intent: 'site_payment_posted', paymentId: 'nao-existe' } }, 'fadas');
    conferir('pagamento inexistente (verificador padrão) = 422', naoExiste.status === 422 && naoExiste.corpo.error.code === 'LILLY_EVENT_NOT_FOUND');
  });

  await passo('forma inválida: provider desconhecido e evento ausente = 400', async () => {
    conferir('provider', (await chamar('POST', '/lilly/events/resolve', { corpo: { provider: 'x', event: {} } })).status === 400);
    conferir('webhook sem tipo', (await resolver({ EventId: 'E50' })).status === 400);
  });

  await passo('repositório de vínculos: único por (contato, conversa); desativar outros', async () => {
    await vinculos.salvarVinculo(avulso, { clientId: '900102', contactId: 'ct-1', conversationId: 'chat-1', verified: true });
    conferir('uma linha por contato+conversa', Number((await consulta("SELECT count(*) AS n FROM gf_lilly_vinculos WHERE umbler_contact_id = 'ct-1' AND umbler_conversation_id = 'chat-1'"))[0].n) === 1);
    await vinculos.salvarVinculo(avulso, { clientId: '900102', contactId: 'ct-2', conversationId: 'chat-2', verified: true });
    await vinculos.desativarOutros(avulso, '900102', 'ct-2', 'chat-2');
    conferir('vínculo antigo desativado', (await vinculos.buscarAtivoDaConversa(avulso, 'chat-1')) === null && (await vinculos.buscarAtivoDaConversa(avulso, 'chat-2')).clientId === '900102');
  });
};
