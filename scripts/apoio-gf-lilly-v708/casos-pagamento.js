'use strict';

/**
 * payment v708: Pix conferido no Mercado Pago lançado automaticamente (`authorizedBy lilly:mercado_pago`) em cliente que pagou sem dados; pagador separado
 * do nome da cliente; unicidade GLOBAL da referência (app + banco); estornado/anulado nunca é relançado; resposta incerta se concilia pelo GET.
 */

module.exports = async (c) => {
  const { r, acao, exec, validar, conciliar, consulta, contar, conferir, passo, chave, igual, evento, IDS, vincular, snap, linha } = c;
  const auto = (n, extra = {}, sobre = {}) => acao('payment', {
    clientId: IDS.aprovada, conversationId: 'chat-n4',
    payload: {
      amount: 67 + n, reference: `5000000${n}`, mpPaymentId: `5000000${n}`, sourceEventId: `mp-auto-post:k${n}`, providerConfirmed: true, confirmation: 'Confirmado', method: 'PIX', bank: 'Mercado Pago',
      payerName: 'Maria de Souza', endToEndId: `E1234567820261107123${n}`, authorization: `E1234567820261107123${n}`, paidAt: '2026-11-07T12:34:56.000Z', date: '2026-11-07T12:34:56.000Z',
      proposalId: `mp-auto-post:k${n}`, authorizedBy: 'lilly:mercado_pago', authorizedEventId: 'umbler:REC1', ...extra,
    },
    ...sobre,
  });
  const pagamentos = () => contar('gf_pagamentos');
  const item = async (id) => { const l = (await consulta('SELECT item FROM gf_pagamentos WHERE id = :id', { id }))[0].item; return typeof l === 'string' ? JSON.parse(l) : l; };

  await evento('umbler:REC1', { conversationId: 'chat-n4', contactId: 'ct-n4', actor: 'client', extra: { intent: 'receipt_received' } });
  await vincular('900102', 'chat-p2', 'ct-p2');
  await evento('umbler:REC2', { conversationId: 'chat-p2', contactId: 'ct-p2', actor: 'client' });

  console.log('payment automático (Pix conferido no Mercado Pago)');
  const k1 = chave('pag'); const a1 = auto(1);
  let r1;
  await passo('cliente que pagou SEM dados (nomes vazios): lança sem atendente, guarda valor/pagador/autenticação/data e devolve o ID do lançamento', async () => {
    const v = await validar(a1);
    conferir('validate permite (providerConfirmed + evento do comprovante na conversa)', v.status === 200 && v.corpo.allowed === true);
    r1 = await exec(a1, k1);
    conferir('200 committed com o ID do lançamento e a cliente', r1.status === 200 && r1.corpo.committed === true && /^PG-/.test(r1.corpo.result.id) && r1.corpo.result.clientId === IDS.aprovada);
    const p = (await consulta('SELECT id_cliente, valor_centavos, metodo, status FROM gf_pagamentos WHERE id = :id', { id: r1.corpo.result.id }))[0];
    conferir('R$ 68,00 PIX da cliente certa', p && Number(p.valor_centavos) === 6800 && p.metodo === 'PIX' && p.id_cliente === IDS.aprovada);
    const it = await item(r1.corpo.result.id);
    conferir('pagador SEPARADO: "Maria de Souza"; autenticação = endToEndId; banco Mercado Pago', it.payerName === 'Maria de Souza' && it.authorization === 'E12345678202611071231' && it.bank === 'Mercado Pago');
    conferir('data/hora do recebimento do provedor (não a do lançamento)', typeof it.paidAt === 'string' && it.paidAt.startsWith('2026-11-07'));
    conferir('rótulo da cliente no lançamento é "ID <n>" (cadastro sem nome não bloqueia o Pix)', it.client === `ID ${IDS.aprovada}`);
    const l = await linha(IDS.aprovada);
    conferir('o nome do pagador NÃO foi para os nomes da cliente (continuam vazios)', l.nome === '' && l.nome_id === '' && l.nome2 === '');
    const ref = (await consulta('SELECT * FROM gf_lilly_pagamento_refs WHERE payment_id = :id', { id: r1.corpo.result.id }))[0];
    conferir('referências, evidência do provedor e autoria guardadas', ref.mp_payment_id === '50000001' && ref.reference === '50000001' && ref.end_to_end_id === 'E12345678202611071231' && ref.provider_confirmed === true && ref.authorized_by === 'lilly:mercado_pago' && ref.authorized_event_id === 'umbler:REC1');
    conferir('auditoria da Lilly', (await contar('gf_auditoria', "acao = 'lilly.payment' AND entidade_id = :id", { id: r1.corpo.result.id })) === 1);
  });
  await passo('contexto devolve o lançamento como confirmado, com pagador, autenticação, data e referências (a Lilly relê antes de confirmar à cliente)', async () => {
    const p = (await snap('chat-n4')).payments.find((x) => x.id === r1.corpo.result.id);
    conferir('status confirmed + providerConfirmed + confirmation', p && p.status === 'confirmed' && p.providerConfirmed === true && p.confirmation === 'Confirmado' && p.clientId === IDS.aprovada && p.amount === 68);
    conferir('pagador, autenticação, método, banco, data', p && p.payerName === 'Maria de Souza' && p.authorization === 'E12345678202611071231' && p.method === 'PIX' && p.bank === 'Mercado Pago' && String(p.paidAt).startsWith('2026-11-07'));
    conferir('referências (mpPaymentId, reference, endToEndId)', p && p.mpPaymentId === '50000001' && p.reference === '50000001' && p.endToEndId === 'E12345678202611071231');
  });
  await passo('resposta incerta: repetição com a mesma chave devolve o MESMO lançamento; GET concilia; corpo diferente 409; nenhum segundo pagamento', async () => {
    const rep = await exec(a1, k1);
    conferir('mesmo resultado', rep.status === 200 && igual(rep.corpo, r1.corpo));
    const g = await conciliar(k1);
    conferir('GET: committed com o result', g.status === 200 && g.corpo.committed === true && g.corpo.result.id === r1.corpo.result.id);
    conferir('corpo diferente: 409', (await exec(auto(1, { amount: 99 }), k1)).status === 409);
    conferir('um pagamento e uma referência', (await pagamentos()) === 1 && (await contar('gf_lilly_pagamento_refs', "mp_payment_id = '50000001'")) === 1);
  });

  console.log('payment: o mesmo pagamento nunca é lançado duas vezes');
  await passo('outra chave com o MESMO mpPaymentId / reference / endToEndId (caixa diferente também): 409 e nada lançado', async () => {
    const mesmoMp = await exec(auto(2, { mpPaymentId: '50000001', reference: '50000001' }), chave('pag'));
    conferir('mesmo ID do Mercado Pago: 409 LILLY_PAYMENT_ALREADY_RECORDED', mesmoMp.status === 409 && mesmoMp.corpo.error.code === 'LILLY_PAYMENT_ALREADY_RECORDED');
    const mesmoE2E = await exec(auto(3, { endToEndId: 'e12345678202611071231', authorization: 'e12345678202611071231' }), chave('pag'));
    conferir('mesmo endToEndId (outra caixa): 409', mesmoE2E.status === 409 && mesmoE2E.corpo.error.code === 'LILLY_PAYMENT_ALREADY_RECORDED');
    const mesmaRef = await exec(auto(4, { reference: '50000001', mpPaymentId: '50000001' }), chave('pag'));
    conferir('mesma referência: 409', mesmaRef.status === 409);
    const validarRep = await validar(auto(2, { mpPaymentId: '50000001', reference: '50000001' }));
    conferir('validate já recusa (allowed:false)', validarRep.corpo.allowed === false && /já foi lançad/.test(validarRep.corpo.reason));
    conferir('nenhum pagamento a mais', (await pagamentos()) === 1);
  });
  await passo('mesmo pagamento em OUTRO cadastro: 409 LILLY_PAYMENT_REFERENCE_OTHER_CLIENT (exige revisão), nunca lança de novo', async () => {
    const outra = auto(5, { mpPaymentId: '50000001', reference: '50000001', authorizedEventId: 'umbler:REC2' }, { clientId: '900102', conversationId: 'chat-p2' });
    const x = await exec(outra, chave('pag'));
    conferir('409 em outro cadastro', x.status === 409 && x.corpo.error.code === 'LILLY_PAYMENT_REFERENCE_OTHER_CLIENT');
    conferir('nenhum pagamento a mais', (await pagamentos()) === 1);
  });
  await passo('DEFESA NO BANCO: mesmo que a checagem da aplicação falhasse, os índices únicos barram a referência repetida (mutante da checagem refutado)', async () => {
    const refs = require(r('src/gestao-fadas/features/lilly/dados/pagamento-refs.repo'));
    const { avulso } = c;
    let erro = null;
    try { await refs.gravarRefs(avulso, { paymentId: 'PG-intruso', mpPaymentId: '50000001', reference: 'outra', endToEndId: 'E-novo-1' }); } catch (e) { erro = e; }
    conferir('gravarRefs com ID do provedor já usado => conflito 409 (a linha não ficou)', erro && erro.status === 409 && erro.code === 'LILLY_PAYMENT_ALREADY_RECORDED');
    conferir('nada gravado para o pagamento intruso', (await contar('gf_lilly_pagamento_refs', "payment_id = 'PG-intruso'")) === 0);
  });
  await passo('estornado/anulado NÃO é relançado: o mesmo pagamento cancelado responde LILLY_PAYMENT_REVERSED', async () => {
    await consulta("UPDATE gf_pagamentos SET status = 'Cancelado' WHERE id = :id", { id: r1.corpo.result.id });
    const x = await exec(auto(6, { mpPaymentId: '50000001', reference: '50000001' }), chave('pag'));
    conferir('409 LILLY_PAYMENT_REVERSED', x.status === 409 && x.corpo.error.code === 'LILLY_PAYMENT_REVERSED');
    const v = await validar(auto(6, { mpPaymentId: '50000001', reference: '50000001' }));
    conferir('validate recusa mencionando estorno/anulação', v.corpo.allowed === false && /estornado ou anulado/.test(v.corpo.reason));
    conferir('contexto mostra cancelled', (await snap('chat-n4')).payments.find((p) => p.id === r1.corpo.result.id).status === 'cancelled');
    await consulta("UPDATE gf_pagamentos SET status = 'Informado' WHERE id = :id", { id: r1.corpo.result.id });
  });

  console.log('payment: campos do contrato v708 validados');
  await passo('recusas 422: paidAt x date diferentes, sem paidAt (automático), paidAt não canônico, futuro, método errado, autenticação errada, reference x mpPaymentId, sem providerConfirmed, evento de outra conversa', async () => {
    const casos = [
      ['paidAt e date diferentes', { date: '2026-11-07T12:35:56.000Z' }],
      ['automático sem paidAt', { paidAt: undefined, date: undefined }],
      ['paidAt fora da forma canônica UTC', { paidAt: '2026-11-07T09:34:56-03:00', date: '2026-11-07T09:34:56-03:00' }],
      ['paidAt no futuro', { paidAt: '2999-01-01T00:00:00.000Z', date: '2999-01-01T00:00:00.000Z' }],
      ['method diferente de PIX', { method: 'Cartão de crédito' }],
      ['bank diferente de Mercado Pago', { bank: 'Itaú' }],
      ['confirmation diferente de Confirmado', { confirmation: 'A confirmar' }],
      ['authorization que não é o endToEndId', { authorization: 'qualquer-coisa' }],
      ['reference diferente de mpPaymentId', { reference: '123' }],
      ['mpPaymentId não numérico no automático', { mpPaymentId: 'MP-x', reference: 'MP-x' }],
      ['automático sem providerConfirmed', { providerConfirmed: undefined }],
      ['payerName grande demais', { payerName: 'x'.repeat(201) }],
    ];
    let n = 20;
    for (const [nome, extra] of casos) {
      n += 1;
      const a = auto(n, extra);
      const x = await exec(a, chave('pag'));
      conferir(`${nome}: 4xx e nada lançado`, x.status >= 400 && x.status < 500 && (await pagamentos()) === 1, JSON.stringify(x.corpo));
    }
    const semEvento = await exec(auto(40, { authorizedEventId: 'umbler:REC2' }), chave('pag'));
    conferir('evento do comprovante de OUTRA conversa: 422', semEvento.status === 422);
    const inexistente = await exec(auto(41, { authorizedEventId: 'umbler:NUNCA' }), chave('pag'));
    conferir('evento inexistente: 422', inexistente.status === 422);
  });
  await passo('payerName null (pagador não identificado no comprovante) é aceito; vira o rótulo da cliente, sem inventar nome', async () => {
    const x = await exec(auto(50, { payerName: null }), chave('pag'));
    conferir('committed', x.status === 200 && x.corpo.committed === true);
    const it = await item(x.corpo.result.id);
    conferir('pagador cai no rótulo "ID n" (nunca em branco), nome da cliente intacto', it.payerName === `ID ${IDS.aprovada}` && (await linha(IDS.aprovada)).nome === '');
  });
  await passo('pagamento de cliente do LEGADO (900102), mesmo fluxo automático, outro cadastro: lança uma vez', async () => {
    const a = auto(60, { authorizedEventId: 'umbler:REC2' }, { clientId: '900102', conversationId: 'chat-p2' });
    const x = await exec(a, chave('pag'));
    conferir('committed para a cliente do legado', x.status === 200 && x.corpo.result.clientId === '900102');
    IDS.pagLegado = x.corpo.result.id;
  });
  await passo('fluxo humano continua exigindo atendente (nada do automático vaza): authorizedBy "staff" sem evento de equipe é recusado', async () => {
    const x = await exec(auto(70, { authorizedBy: 'staff', authorizedEventId: 'umbler:REC1', proposalId: 'p-h-70' }), chave('pag'));
    conferir('422 sem autorização da equipe', x.status === 422 && x.corpo.error.code === 'LILLY_AUTHORIZATION_MISSING');
  });
};
