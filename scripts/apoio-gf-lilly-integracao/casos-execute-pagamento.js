'use strict';

/**
 * execute de payment com os payloads que o motor REALMENTE emite (engine.mjs:630-690 e payment-receipt-flow.mjs:276: valor NUMÉRICO, o ID do
 * Mercado Pago em `reference`, nunca `mpPaymentId`), a prova de autorização pelo caminho real (resolveEvent) e o schedule `paid_intake`.
 */

const { criarAuxiliares } = require('./auxiliares');

module.exports = async ({ adapter, umbler, conferir, passo, log, AGORA, r, contar, IntegrationError, importar }) => {
  const { acao, autorizar, tentar } = criarAuxiliares({ adapter, umbler, AGORA, r });
  const posting = await importar('payment-posting.mjs');
  const base = { conversationId: 'chat-G', clientId: '900107' };
  const pagar = (payload, extra = {}) => acao('payment', { ...base, ...extra, payload });
  const snap = () => adapter.snapshot({ id: `umbler:P${Math.random()}`, type: 'message', actor: 'client', conversationId: 'chat-G', clientId: '900107', at: new Date().toISOString(), data: {} });

  log('execute: payment');
  let a1; let p1;
  await passo('comprovante conferido no Mercado Pago (providerConfirmed, valor numérico, ID MP em `reference`): lança e devolve {id, clientId}', async () => {
    const prova = await autorizar('chat-G', 'ct-G');
    a1 = pagar({ amount: 67.5, reference: 'MP-1001', endToEndId: 'E2E-1001', sourceEventId: 'mp-before-registration:r1', providerConfirmed: true, ...prova });
    const v = await adapter.validate(a1, { id: 'chat-G', contact: { id: 'ct-G' } });
    conferir('validate permite', v.allowed === true, JSON.stringify(v));
    const x = await adapter.execute(a1);
    p1 = x.result;
    conferir('committed e result.id (OBR p/ fluxo pago, engine.mjs:~947) + clientId', x.committed === true && /^PG-/.test(p1.id) && p1.clientId === '900107', JSON.stringify(x));
    const s = await snap();
    const linha = s.payments.find((p) => p.id === p1.id);
    conferir('snapshot traz o pagamento com a referência (existingPost, payment-posting.mjs:20) => a Lilly vê "recorded"', linha && posting.existingPost(s, '900107', { reference: 'MP-1001' }) === 'recorded', JSON.stringify(linha));
    conferir('o mesmo comprovante em OUTRA cliente aparece como "other" (bloqueio da Lilly)', posting.existingPost(s, '900102', { reference: 'MP-1001' }) === 'other');
  });
  await passo('SÓ `reference` + providerConfirmed (comprovante achado pelo ID do pagamento, sem endToEndId): aceito', async () => {
    const prova = await autorizar('chat-G', 'ct-G');
    const a = pagar({ amount: 30, reference: 'MP-SO-REF-1', sourceEventId: 'mp-before-registration:r2', providerConfirmed: true, distinctAmountConfirmed: true, ...prova });
    const { valor, erro } = await tentar(adapter.execute(a));
    conferir('committed (a Lilly nunca manda mpPaymentId: payment-receipt-flow.mjs:276)', valor && valor.committed === true, String(erro && `${erro.status} ${erro.message}`));
  });
  await passo('repetição idempotente (mesma chave): mesmo id, 1 pagamento só; corpo diferente na mesma chave: 409 definitivo', async () => {
    const antes = await contar('gf_pagamentos');
    const rep = await adapter.execute(a1);
    conferir('mesmo id e nenhum pagamento novo', rep.result.id === p1.id && (await contar('gf_pagamentos')) === antes);
    const { erro } = await tentar(adapter.execute({ ...a1, payload: { ...a1.payload, amount: 99 } }));
    conferir('409', erro instanceof IntegrationError && erro.status === 409 && erro.uncertain === false);
  });
  await passo('mesma referência com chave nova (nova proposta/autorização): 409 definitivo, sem segundo lançamento', async () => {
    const prova = await autorizar('chat-G', 'ct-G');
    const antes = await contar('gf_pagamentos');
    const { erro } = await tentar(adapter.execute(pagar({ amount: 67.5, reference: 'MP-1001', sourceEventId: 'mp-before-registration:r3', providerConfirmed: true, ...prova })));
    conferir('409 e uncertain:false', erro instanceof IntegrationError && erro.status === 409 && erro.uncertain === false);
    conferir('nada novo', (await contar('gf_pagamentos')) === antes);
  });
  await passo('SEM autorização: 422 definitivo; autorização de evento de CLIENTE (não staff) idem; validate também recusa', async () => {
    const sem = pagar({ amount: 12, reference: 'MP-SEM-AUT', endToEndId: 'E2E-SEM', sourceEventId: 'mp-before-registration:r4', providerConfirmed: true, proposalId: 'p-x', authorizedBy: 'staff' });
    const a = await tentar(adapter.execute(sem));
    conferir('sem authorizedEventId: 422 LILLY_AUTHORIZATION_MISSING', a.erro instanceof IntegrationError && a.erro.status === 422 && a.erro.uncertain === false);
    const doCliente = pagar({ amount: 12, reference: 'MP-CLI', endToEndId: 'E2E-CLI', sourceEventId: 'mp-before-registration:r5', providerConfirmed: true, proposalId: 'p-y', authorizedBy: 'staff', authorizedEventId: 'umbler:I1' }, { conversationId: 'chat-A', clientId: '900101' });
    const b = await tentar(adapter.execute(doCliente));
    conferir('evento de cliente não autoriza (staffAuthorized false)', b.erro instanceof IntegrationError && b.erro.status === 422 && b.erro.uncertain === false);
    conferir('validate recusa sem prova', (await adapter.validate(sem)).allowed === false);
  });
  await passo('caminho da equipe com `reference` só de texto + humanConfirmed (engine.mjs:1246): RECUSADO por decisão pendente (4xx definitivo, não 5xx)', async () => {
    const prova = await autorizar('chat-G', 'ct-G');
    const a = pagar({ amount: 20, reference: 'COMPROVANTE-DO-WHATS', date: undefined, sourceEventId: 'umbler:EQ1', humanConfirmed: true, reconciliationRequired: false, ...prova });
    const { erro } = await tentar(adapter.execute(a));
    log('   (info) pagamento humanConfirmed sem ID MP/Pix:', erro && `${erro.status} (${erro.uncertain ? 'incerto' : 'definitivo'})`);
    conferir('422 LILLY_PAYMENT_REFERENCE_REQUIRED, uncertain:false', erro instanceof IntegrationError && erro.status === 422 && erro.uncertain === false);
  });
  await passo('schedule paid_intake com o pagamento lançado (payload de consultation-intake.mjs:150): usa o paymentId; 1 pagamento = 1 agendamento', async () => {
    const intake = (extra = {}) => acao('schedule', { conversationId: 'chat-G', clientId: '900107', tarologistId: '9002', payload: { intakeId: 'umbler:IN7', paymentId: p1.id, scope: 'tarologist', channel: 'WhatsApp', minutes: 30, date: AGORA.toISOString().slice(0, 10), position: 'last', confirmed: true, reason: 'paid_intake', ...extra } });
    const dia = (await snap()).operationalDate;
    const x = await tentar(adapter.execute(intake({ date: dia })));
    conferir('committed com id/position', x.valor && x.valor.committed === true && /^AG-/.test(x.valor.result.id) && Number.isInteger(x.valor.result.position), String(x.erro && `${x.erro.status} ${x.erro.message}`));
    const s = await snap();
    conferir('o pagamento usado aparece vinculado/consumido no snapshot ou o agendamento existe (engine.mjs:~150)', s.appointments.some((a) => a.clientId === '900107'));
  });
};
