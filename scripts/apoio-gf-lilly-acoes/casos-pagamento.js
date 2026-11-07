'use strict';

/** payment: autorização humana provada, unicidade (referência cruzando tipos, proposta, autorização), idempotência e recusas. */

module.exports = async ({ acao, exec, validar, vincular, autorizar, consulta, contar, conferir, passo, chave }) => {
  await vincular('900101', 'chat-1', 'ct-1');
  await vincular('900102', 'chat-2', 'ct-chat-2');
  let n = 0;
  const pagamento = (extra = {}, aut = {}) => {
    n += 1;
    return acao('payment', {
      payload: { amount: '67.50', mpPaymentId: `MP-${n}`, sourceEventId: `src-${n}`, providerConfirmed: true, proposalId: `prop-${n}`, authorizedBy: 'staff', authorizedEventId: `aut-${n}`, ...extra },
      ...aut,
    });
  };
  const preparar = async (a) => autorizar(a.payload.authorizedEventId, { conversationId: a.conversationId, clientId: a.clientId });
  const refs = async () => contar('gf_lilly_pagamento_refs');

  console.log('payment: caminho feliz e idempotência');
  const a1 = pagamento({ amount: '67.50', mpPaymentId: 'MP-ABC-1', endToEndId: 'E2E-ABC-1', reference: 'REF-1' });
  const k1 = chave('pag');
  let r1;
  await passo('com evento humano da MESMA conversa e cliente: lança, grava as referências, devolve {id} e audita', async () => {
    await preparar(a1);
    const v = await validar(a1);
    conferir('validate permite', v.status === 200 && v.corpo.allowed === true);
    r1 = await exec(a1, k1);
    conferir('200 committed com id', r1.status === 200 && r1.corpo.committed === true && /^PG-/.test(r1.corpo.result.id) && r1.corpo.result.clientId === '900101');
    const p = (await consulta('SELECT id_cliente, valor_centavos, metodo, status FROM gf_pagamentos WHERE id = :id', { id: r1.corpo.result.id }))[0];
    conferir('gf_pagamentos: PIX, R$ 67,50, Informado', p && Number(p.valor_centavos) === 6750 && p.metodo === 'PIX' && p.status === 'Informado' && p.id_cliente === '900101');
    const item = (await consulta('SELECT item FROM gf_pagamentos WHERE id = :id', { id: r1.corpo.result.id }))[0].item;
    const reg = typeof item === 'string' ? JSON.parse(item) : item;
    conferir('banco Mercado Pago, pagador cai no nome da cliente, autorização é a referência, nota da Lilly', reg.bank === 'Mercado Pago' && reg.payerName === 'Cliente 900101' && /Lançado pela Lilly/.test(reg.note));
    const ref = (await consulta('SELECT * FROM gf_lilly_pagamento_refs WHERE payment_id = :id', { id: r1.corpo.result.id }))[0];
    conferir('refs gravadas', ref && ref.mp_payment_id === 'MP-ABC-1' && ref.end_to_end_id === 'E2E-ABC-1' && ref.reference === 'REF-1' && ref.proposal_id === a1.payload.proposalId && ref.authorized_event_id === a1.payload.authorizedEventId);
    conferir('auditoria da Lilly e do serviço', (await contar('gf_auditoria', "acao = 'lilly.payment'")) === 1 && (await contar('gf_auditoria', "acao = 'pagamentos.lancar'")) === 1);
  });
  await passo('repetição (mesma chave e corpo): mesmo id, SEM segundo pagamento; corpo diferente: 409', async () => {
    const rep = await exec(a1, k1);
    conferir('mesmo resultado', rep.status === 200 && rep.corpo.result.id === r1.corpo.result.id);
    conferir('um pagamento e uma ref', (await contar('gf_pagamentos')) === 1 && (await refs()) === 1);
    const dif = await exec({ ...a1, payload: { ...a1.payload, amount: '99.00' } }, k1);
    conferir('409', dif.status === 409 && dif.corpo.error.code === 'OPERATION_KEY_CONFLICT');
  });

  console.log('payment: autorização e forma');
  await passo('sem authorizedEventId/proposalId/authorizedBy: 422 LILLY_AUTHORIZATION_MISSING, validate allowed:false', async () => {
    const a = pagamento({ authorizedEventId: undefined });
    const v = await validar(a);
    conferir('validate recusa', v.status === 200 && v.corpo.allowed === false && /autorização/.test(v.corpo.reason));
    const x = await exec(a, chave('pag'));
    conferir('422', x.status === 422 && x.corpo.error.code === 'LILLY_AUTHORIZATION_MISSING');
    conferir('sem humanConfirmed nem providerConfirmed', (await exec(pagamento({ providerConfirmed: undefined }), chave('pag'))).status === 422);
  });
  await passo('evento que NÃO existe, de OUTRA conversa, de OUTRA cliente ou sem staffAuthorized: 422 e nada lançado', async () => {
    const antes = await contar('gf_pagamentos');
    const inexistente = await exec(pagamento({ authorizedEventId: 'nunca-existiu' }), chave('pag'));
    const outraConversa = pagamento(); await autorizar(outraConversa.payload.authorizedEventId, { conversationId: 'chat-2', clientId: '900101' });
    const outraCliente = pagamento(); await autorizar(outraCliente.payload.authorizedEventId, { conversationId: 'chat-1', clientId: '900102' });
    const semStaff = pagamento(); await autorizar(semStaff.payload.authorizedEventId, { staff: false });
    for (const [nome, a] of [['inexistente', null], ['outra conversa', outraConversa], ['outra cliente', outraCliente], ['sem staffAuthorized', semStaff]]) {
      const x = a ? await exec(a, chave('pag')) : inexistente;
      conferir(`${nome}: 422 LILLY_AUTHORIZATION_MISSING`, x.status === 422 && x.corpo.error.code === 'LILLY_AUTHORIZATION_MISSING');
    }
    conferir('nenhum pagamento novo', (await contar('gf_pagamentos')) === antes);
  });
  await passo('evento com proposta/valor diferentes do pedido: 422', async () => {
    const a = pagamento({ amount: '30.00' }); await autorizar(a.payload.authorizedEventId, { extra: { proposalId: 'outra-proposta' } });
    conferir('proposta diferente', (await exec(a, chave('pag'))).status === 422);
    const b = pagamento({ amount: '30.00' }); await autorizar(b.payload.authorizedEventId, { extra: { amount: '31.00' } });
    conferir('valor diferente', (await exec(b, chave('pag'))).status === 422);
  });
  await passo('valor inválido, sem referência do Mercado Pago/Pix, cliente sem vínculo ou inexistente: recusa', async () => {
    for (const amount of ['0', '-5', '10.999', 'abc', '1234567890123']) conferir(`valor ${amount}`, (await exec(pagamento({ amount }), chave('pag'))).status === 422);
    const semRef = pagamento({ mpPaymentId: undefined }); await preparar(semRef);
    const v = await validar(semRef);
    conferir('sem referência: validate recusa', v.corpo.allowed === false && /depende de decisão/.test(v.corpo.reason));
    const x = await exec(semRef, chave('pag'));
    conferir('sem referência: 422 REFERENCE_REQUIRED', x.status === 422 && x.corpo.error.code === 'LILLY_PAYMENT_REFERENCE_REQUIRED');
    const semVinculo = pagamento({}, { conversationId: 'chat-9' }); await preparar(semVinculo);
    conferir('sem vínculo', (await exec(semVinculo, chave('pag'))).status === 422);
    const fantasma = pagamento({}, { clientId: '999999' }); await autorizar(fantasma.payload.authorizedEventId, { clientId: '999999' });
    conferir('cliente inexistente', (await validar(fantasma)).corpo.allowed === false);
  });

  console.log('payment: unicidade');
  await passo('referência repetida com chave nova: 409 ALREADY_RECORDED com o id; cruzando tipos (endToEnd = mpPaymentId antigo) também', async () => {
    const igual = pagamento({ amount: '12.00', mpPaymentId: 'mp-abc-1' }); await preparar(igual); // caixa diferente
    const x = await exec(igual, chave('pag'));
    conferir('mesma referência', x.status === 409 && x.corpo.error.code === 'LILLY_PAYMENT_ALREADY_RECORDED' && x.corpo.error.message.includes(r1.corpo.result.id));
    const cruzada = pagamento({ amount: '13.00', mpPaymentId: undefined, endToEndId: 'MP-ABC-1' }); await preparar(cruzada);
    const y = await exec(cruzada, chave('pag'));
    conferir('endToEndId igual ao mpPaymentId já gravado', y.status === 409 && y.corpo.error.code === 'LILLY_PAYMENT_ALREADY_RECORDED');
    const evento = pagamento({ amount: '14.00', sourceEventId: a1.payload.sourceEventId }); await preparar(evento);
    conferir('mesmo sourceEventId', (await exec(evento, chave('pag'))).status === 409);
    const v = await validar(igual);
    conferir('validate também recusa', v.corpo.allowed === false && /já foi lançada/.test(v.corpo.reason));
    conferir('segue 1 pagamento', (await contar('gf_pagamentos')) === 1);
  });
  await passo('referência já usada por OUTRA cliente: 409 LILLY_PAYMENT_REFERENCE_OTHER_CLIENT', async () => {
    const a = pagamento({ mpPaymentId: 'MP-ABC-1' }, { clientId: '900102', conversationId: 'chat-2' }); await preparar(a);
    const x = await exec(a, chave('pag'));
    conferir('outro cadastro', x.status === 409 && x.corpo.error.code === 'LILLY_PAYMENT_REFERENCE_OTHER_CLIENT');
  });
  await passo('mesma proposta (referência nova) e mesma autorização (proposta nova): 409 e nada lançado', async () => {
    const p = pagamento({ amount: '15.00', proposalId: a1.payload.proposalId }); await preparar(p);
    const x = await exec(p, chave('pag'));
    conferir('proposta repetida', x.status === 409 && x.corpo.error.code === 'LILLY_PROPOSAL_ALREADY_EXECUTED');
    const q = pagamento({ amount: '16.00', authorizedEventId: a1.payload.authorizedEventId });
    const y = await exec(q, chave('pag'));
    conferir('autorização repetida', y.status === 409 && y.corpo.error.code === 'LILLY_AUTHORIZATION_ALREADY_USED');
    conferir('segue 1 pagamento', (await contar('gf_pagamentos')) === 1);
  });
  await passo('mesmo valor em 15 minutos: 409 sem distinctAmountConfirmed; com ele lança e deixa "Duplicidade conferida" no histórico', async () => {
    const d = pagamento({ amount: '67.50' }); await preparar(d);
    const x = await exec(d, chave('pag'));
    conferir('duplicidade', x.status === 409 && x.corpo.error.code === 'LILLY_PAYMENT_DUPLICATE');
    const ok = pagamento({ amount: '67.50', distinctAmountConfirmed: true }); await preparar(ok);
    const y = await exec(ok, chave('pag'));
    conferir('lançado', y.status === 200 && (await contar('gf_pagamentos')) === 2);
    const item = (await consulta('SELECT item FROM gf_pagamentos WHERE id = :id', { id: y.corpo.result.id }))[0].item;
    conferir('evento Duplicidade conferida', JSON.stringify(item).includes('Duplicidade conferida'));
  });
};
