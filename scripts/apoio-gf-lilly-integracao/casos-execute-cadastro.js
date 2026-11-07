'use strict';

/**
 * execute do cadastro: register_client / update_client com o payload de `prepareRegistrationPayload` (phone-identity.mjs:~52) e o `result` que o
 * motor lê (engine.mjs:~914: id, name, paymentType/postpaid -> update_contact). ID inexistente = 4xx.
 */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, contar, consulta, IntegrationError, importar }) => {
  const { acao, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  const fone = await importar('phone-identity.mjs');
  const dados = { name: 'Duda Souza', birthDate: '1992-03-04', phone: '+5511998776666', channel: 'WhatsApp', ddd: '11', minutes: 30 };
  const payloadCadastro = (known) => fone.prepareRegistrationPayload(dados, known);
  const extensao = async (id) => (await consulta('SELECT perfil_pagamento, dados FROM gf_clientes_ext WHERE id_cliente = :id', { id }))[0];

  log('execute: cadastro');
  await passo('update_client (cliente conhecida pelo telefone): payload REAL do motor, result com id/name/paymentType/postpaid', async () => {
    const s = await adapter.snapshot({ id: 'umbler:RG0', type: 'message', actor: 'client', conversationId: 'chat-D', clientId: '900104', at: AGORA.toISOString(), data: {} });
    const known = s.clients.find((c) => c.id === '900104');
    const a = acao('update_client', { conversationId: 'chat-D', clientId: '900104', payload: payloadCadastro(known), sufixo: 'registration-1' });
    const validado = await adapter.validate(a);
    conferir('validate permite', validado.allowed === true, JSON.stringify(validado));
    const x = await adapter.execute(a);
    conferir('committed + result.id === clientId da ação (engine.mjs:~910 recusa se diferente)', x.committed === true && x.result.id === '900104', JSON.stringify(x));
    log('   (info) update_client de cadastro conhecido devolve só {id, changed}; sem paymentType/postpaid no result a Lilly depende do cliente do snapshot (engine.mjs:929) e, sem regime, escreve a Nota "confirme a modalidade" em vez de update_contact:', JSON.stringify(x.result));
    conferir('nome gravado na extensão do cadastro', (await extensao('900104')).dados.name === 'Duda' || JSON.stringify((await extensao('900104')).dados).includes('Duda'));
    const rep = await adapter.execute(a);
    conferir('repetição idempotente: mesmo result, 1 auditoria', JSON.stringify(rep.result) === JSON.stringify(x.result) && (await contar('gf_auditoria', "acao = 'lilly.update_client' AND entidade_id = '900104'")) <= 1);
    const { erro } = await tentar(adapter.execute({ ...a, payload: { ...a.payload, name: 'Outro Nome' } }));
    conferir('mesma chave com corpo diferente: 409 definitivo', erro instanceof IntegrationError && erro.status === 409 && erro.uncertain === false);
  });
  await passo('register_client com ID existente completa o cadastro; ID INEXISTENTE = 4xx definitivo (e nada criado)', async () => {
    const ok = acao('register_client', { conversationId: 'chat-F', clientId: '900106', payload: { ...payloadCadastro(null), clientId: '900106', name: 'Flavia Lima', phone: '+5531977771234' } });
    const x = await adapter.execute(ok);
    conferir('committed e id', x.committed === true && x.result.id === '900106', JSON.stringify(x));
    const antes = await contar('gf_clientes_ext');
    const { erro } = await tentar(adapter.execute(acao('register_client', { conversationId: 'chat-F', clientId: '999999', payload: { ...payloadCadastro(null), clientId: '999999' } })));
    conferir('ID inexistente: 4xx (404/422) e uncertain:false => a Lilly cancela, não reenvia', erro instanceof IntegrationError && erro.status >= 400 && erro.status < 500 && erro.uncertain === false, String(erro && erro.status));
    conferir('nada criado', (await contar('gf_clientes_ext')) === antes);
  });
  await passo('register_client SEM ID (lead novo, caso comum do motor): 422 definitivo "depende de decisão" e validate allowed:false com motivo', async () => {
    const a = acao('register_client', { conversationId: 'chat-N', clientId: '', payload: payloadCadastro(null) });
    const v = await adapter.validate(a);
    conferir('validate recusa com motivo', v.allowed === false && typeof v.reason === 'string' && v.reason.length > 0);
    const { erro } = await tentar(adapter.execute(a));
    conferir('execute 422 definitivo', erro instanceof IntegrationError && erro.status === 422 && erro.uncertain === false);
  });
  await passo('update_client de tratar-por (preferred-name, engine.mjs:1320): onlyIfEmpty + sourceMessageIds; result.id', async () => {
    const a = acao('update_client', { conversationId: 'chat-I', clientId: '900109', payload: { clientId: '900109', treatAs: 'Ivy', onlyIfEmpty: true, sourceMessageIds: ['umbler:PN1'], preservePreferences: true }, sufixo: 'preferred-name' });
    const x = await adapter.execute(a);
    conferir('committed, id e treatAs', x.committed === true && x.result.id === '900109' && x.result.treatAs === 'Ivy', JSON.stringify(x));
  });
};
