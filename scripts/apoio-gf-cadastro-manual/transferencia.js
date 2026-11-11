'use strict';

/** Transferência com o frontend REAL, gate HTTP e PostgreSQL descartável.
 * Toda criação, confirmação, transferência e releitura usa HTTP. SQL só confere eventos/auditoria.
 * GF_FINANCEIRO_FRONT=/pasta/do/painel (também aceita GF_RETORNO_FRONT do roteiro integrado).
 */
const assert = require('assert');
const { dados } = require('./ambiente');
const { abrir } = require('../apoio-gf-regras-b/front');

module.exports = async (a, { passo, status, montar, contas }) => {
  const path = process.env.GF_FINANCEIRO_FRONT || process.env.GF_RETORNO_FRONT;
  if (!path) return;
  const front = await abrir(path), originalFetch = globalThis.fetch;
  const oldConsulta = process.env.GF_FATIA_CONSULTA;
  process.env.GF_FATIA_CONSULTA = 'true';
  const transported = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input, a.origem);
    assert.equal(url.origin, a.origem, 'este teste só transporta pedidos ao gate descartável');
    if (typeof input === 'string' && input.startsWith('/api/')) {
      assert.equal(init.credentials, 'same-origin'); assert.equal(init.cache, 'no-store');
      transported.push({ path: url.pathname + url.search, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : undefined });
    }
    const headers = new Headers(init.headers);
    if (init.method && init.method !== 'GET') headers.set('origin', a.origem);
    return originalFetch(url, { ...init, headers });
  };
  let sourceId; let targetId; let paymentId; let snapshot; let prepared; let operationId; let command; let written;
  const audit = async () => {
    const [row] = await a.sql("SELECT (SELECT COUNT(*) FROM gf_pagamentos_eventos WHERE id_pagamento = ?) AS events, (SELECT COUNT(*) FROM gf_auditoria WHERE entidade_id = ? AND acao = 'pagamentos.revisar') AS audits", [paymentId, paymentId]);
    return { events: Number(row.events), audits: Number(row.audits) };
  };
  try {
    const { transferClientBalance } = await front.carregar('/features/finance/balance-transfer-model.ts');
    const api = await front.carregar('/features/integration/clients/real-client-transfer-api.ts');
    const { sendPaymentChange } = await front.carregar('/features/integration/pagamentos/real-payments-api.ts');
    await passo('transferência prepara duas clientes novas e crédito regular confirmado exclusivamente por HTTP', async () => {
      const source = await a.criar(dados({ name: 'Origem Transferência', fullName: 'Cliente Origem Transferência' })); status(source, 200); sourceId = source.j.clientId;
      const target = await a.criar(dados({ name: 'Destino Transferência', fullName: 'Cliente Destino Transferência' })); status(target, 200); targetId = target.j.clientId;
      assert.notEqual(sourceId, targetId); assert.ok(Number(sourceId) >= 1000000000 && Number(targetId) >= 1000000000);
      const registration = montar(sourceId, 'Origem Transferência', 88.8);
      assert.equal(registration.purchase.table, 'regular'); assert.equal(registration.purchase.minutes, 30); paymentId = registration.id;
      const payment = await sendPaymentChange({ kind: 'create', item: registration }); assert.equal(payment.kind, 'ok', JSON.stringify(payment));
      const now = new Date().toISOString(), item = payment.items[0];
      const confirmed = { ...item, confirmation: 'Confirmado', status: 'Informado', updatedAt: now, updatedBy: 'Equipe teste manual',
        audit: [...item.audit, { id: a.chave(), action: 'Recebimento confirmado', detail: 'recebimento: Informado → Confirmado', actor: 'Equipe teste manual', createdAt: now }] };
      const saved = await sendPaymentChange({ kind: 'update', item: confirmed, version: payment.versions[paymentId] }); assert.equal(saved.kind, 'ok', JSON.stringify(saved));
      snapshot = await api.loadRealTransferSnapshot(sourceId, targetId);
      assert.equal(snapshot.accounts[sourceId].balanceCents, 8880); assert.equal(snapshot.accounts[targetId].balanceCents, 0);
      assert.equal(snapshot.payments.versions[paymentId], 2); assert.equal(a.chamadas.escritas, 0);
    });
    let counts;
    await passo('payload real transfere R$44,40 entre clientes novas, persiste versão e confirma saldo das duas contas', async () => {
      assert.ok(snapshot);
      const beforeLegacy = a.chamadas.leituras;
      const profiles = Object.fromEntries([sourceId, targetId].map((id) => [id, api.confirmedTransferProfile(id, snapshot)]));
      const names = Object.fromEntries([sourceId, targetId].map((id) => [id, snapshot.accounts[id].name]));
      operationId = `transferencia-${a.chave()}`;
      const input = { id: operationId, sourceClientId: sourceId, targetClientId: targetId, amount: 44.4, note: '',
        authorization: { version: 1, text: 'Autorização fictícia para transferir R$ 44,40 à cliente destinatária.', images: [], internalNote: 'Roteiro descartável de integração.' } };
      const state = { payments: snapshot.payments.items, consultations: snapshot.consultations };
      prepared = api.prepareRealTransferChange(state, snapshot, (current) => transferClientBalance(current, input, { profiles, names, regularMinuteValue: 2.96, actor: 'Equipe teste manual', role: 'administradora', at: new Date().toISOString() }));
      assert.equal(prepared.expected.length, 1); assert.equal(prepared.expected[0].id, paymentId);
      counts = await audit();
      const result = await sendPaymentChange({ kind: 'update', item: prepared.expected[0], version: snapshot.payments.versions[paymentId] }); assert.equal(result.kind, 'ok', JSON.stringify(result));
      written = result; assert.equal(result.versions[paymentId], 3);
      command = transported.find((call) => call.body?.record?.movements?.some((movement) => movement.balanceTransfer?.operationId === operationId));
      assert.ok(command); assert.equal(command.body.expectedVersion, 2); assert.ok(command.body.operationKey);
      await api.confirmRealTransferPersistence(operationId, prepared.expected);
      const after = await api.loadRealTransferSnapshot(sourceId, targetId);
      assert.equal(after.accounts[sourceId].balanceCents, 4440); assert.equal(after.accounts[targetId].balanceCents, 4440);
      assert.equal(after.accounts[sourceId].receivedCents, 8880); assert.equal(after.accounts[targetId].receivedCents, 0);
      assert.equal(after.accounts[sourceId].adjustmentsCents, -4440); assert.equal(after.accounts[targetId].adjustmentsCents, 4440);
      assert.equal(after.accounts[sourceId].availableMinutes, 15); assert.equal(after.accounts[targetId].availableMinutes, 15);
      assert.equal(after.payments.items.length, snapshot.payments.items.length, 'transferência não cria outro recebimento');
      const legs = after.payments.items.flatMap((p) => p.movements || []).filter((m) => m.balanceTransfer?.operationId === operationId);
      assert.equal(legs.length, 1); assert.equal(legs[0].bankEffect, 0); assert.equal(legs[0].amount, 44.4);
      assert.equal(legs[0].balanceTransfer.sourceClientId, sourceId); assert.equal(legs[0].balanceTransfer.targetClientId, targetId);
      assert.deepEqual(legs[0].balanceTransfer.authorization, input.authorization);
      assert.deepEqual(await audit(), { events: counts.events + 1, audits: counts.audits + 1 });
      assert.equal(a.chamadas.leituras, beforeLegacy, 'transferência entre IDs novos não consulta o MySQL'); assert.equal(a.chamadas.escritas, 0);
    });
    await passo('repetir exatamente a transferência HTTP não duplica movimento, saldo, versão, evento ou auditoria', async () => {
      assert.ok(command && written);
      const before = await audit(), beforeLegacy = a.chamadas.leituras;
      const replay = await a.chamar('POST', command.path.replace(/^\/api/, ''), command.body); status(replay, 200);
      assert.deepEqual(replay.j.items, written.items); assert.deepEqual(replay.j.versions, written.versions);
      assert.deepEqual(await audit(), before);
      await api.confirmRealTransferPersistence(operationId, prepared.expected);
      const accounts = await contas([sourceId, targetId]); status(accounts, 200);
      assert.equal(accounts.j.accounts[sourceId].balanceCents, 4440); assert.equal(accounts.j.accounts[targetId].balanceCents, 4440);
      const read = await a.chamar('GET', '/payments'); status(read, 200); assert.equal(read.j.versions[paymentId], 3);
      assert.equal(read.j.items.flatMap((p) => p.movements || []).filter((m) => m.balanceTransfer?.operationId === operationId).length, 1);
      assert.equal(a.chamadas.leituras, beforeLegacy); assert.equal(a.chamadas.escritas, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (oldConsulta === undefined) delete process.env.GF_FATIA_CONSULTA; else process.env.GF_FATIA_CONSULTA = oldConsulta;
    await front.fechar();
  }
};
