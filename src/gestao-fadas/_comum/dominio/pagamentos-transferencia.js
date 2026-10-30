'use strict';

/**
 * Transferência de saldo entre clientes no servidor (Maturacao/42, item 3): porte de `transferableBalance` e `transferClientBalance`
 * (`features/finance/balance-transfer-model.ts`). Só saldo de compra REGULAR comprovado (bônus e saldo de abertura sem preço ficam de fora);
 * um estado, duas pontas: nenhum recebimento bancário novo e nenhum crédito duplicado. O saldo vem de `tarifaDeCredito`/`contaDaCliente`
 * (`financeiro-saldo.js`, ouro financeiro) com o contexto REAL das clientes.
 */

const L = require('./pagamentos-livro');
const saldo = require('./financeiro-saldo');

const { erro, centavos } = L;

/** `transferableBalance(clientId, state, profile, regularMinuteValue, at)`. */
function saldoTransferivel(clientId, estado, perfil, valorRegular, em) {
  const credito = saldo.tarifaDeCredito(clientId, em, undefined, estado.consultations, estado.payments, perfil);
  const lotes = credito.availableLots.filter((lote) => {
    const p = estado.payments.find((x) => x.id === lote.paymentId);
    return p && L.recebimentoConfirmado(p) && lote.minutesKnown && lote.kind !== 'opening' && lote.unitValue > 0
      && ((p.purchase && p.purchase.table === 'regular') || (!p.purchase && Boolean(p.cashUnitValue) && Math.abs(lote.unitValue - valorRegular) < 0.000001));
  });
  return { amount: lotes.reduce((s, x) => s + x.cents, 0) / 100, lots: lotes };
}

function fatias(lotes, cents) {
  let restante = cents;
  return lotes.flatMap((lote) => {
    if (restante <= 0) return [];
    const tomado = Math.min(restante, lote.cents); restante -= tomado;
    return [{ ...lote, cents: tomado, minutes: tomado === lote.cents ? lote.minutes : tomado / 100 / lote.unitValue }];
  });
}

/**
 * `transferClientBalance(state, input, context)`. `entrada`: `{ id, sourceClientId, targetClientId, amount, note, reversalOf? }`;
 * `contexto`: `{ profiles, names, regularMinuteValue, actor, role, at }`.
 */
function transferirSaldo(estado, entrada, contexto) {
  if (contexto.role !== 'administradora' && contexto.role !== 'assistente') erro('A transferência de saldo está disponível para administradora e assistente.');
  const origem = String(entrada.sourceClientId).trim(); const destino = String(entrada.targetClientId).trim();
  const ator = L.validarNome(contexto.actor, 'Responsável'); const nota = L.validarObservacao(entrada.note, 'Pedido do titular', true);
  if (!contexto.names[origem] || !contexto.names[destino]) erro('Localize os dois cadastros antes de transferir o saldo.');
  if (origem === destino) erro('Escolha outra cliente para receber o saldo.');
  if (!entrada.id || !Number.isFinite(Date.parse(contexto.at))) erro('Não foi possível identificar esta transferência. Abra novamente.');
  const valor = centavos(entrada.amount);
  if (!Number.isSafeInteger(valor) || valor <= 0 || Math.abs(entrada.amount * 100 - valor) > 0.000001) erro('Informe um valor positivo com até duas casas decimais.');
  const assinatura = JSON.stringify({ source: origem, target: destino, amount: valor, note: nota, actor: ator, reversalOf: entrada.reversalOf });
  const existentes = estado.payments.flatMap((p) => p.movements || []).filter((m) => m.balanceTransfer && m.balanceTransfer.operationId === entrada.id);
  if (existentes.length) {
    if (existentes.every((m) => m.operationSignature === assinatura) && existentes.reduce((s, m) => s + centavos(m.amount), 0) === valor) return estado;
    erro('Esta operação já foi registrada com outros dados. Abra novamente.');
  }
  const disponivel = saldoTransferivel(origem, estado, contexto.profiles[origem], contexto.regularMinuteValue, contexto.at);
  if (entrada.reversalOf) {
    const originais = estado.payments.flatMap((p) => p.movements || []).filter((m) => m.balanceTransfer && m.balanceTransfer.operationId === entrada.reversalOf);
    if (!originais.length || originais.some((m) => m.balanceTransfer.sourceClientId !== destino || m.balanceTransfer.targetClientId !== origem || m.balanceTransfer.reversalOf) || originais.reduce((s, m) => s + centavos(m.amount), 0) !== valor) erro('Localize a transferência original para reverter o mesmo valor entre os dois cadastros.');
    if (estado.payments.some((p) => (p.movements || []).some((m) => m.balanceTransfer && m.balanceTransfer.reversalOf === entrada.reversalOf))) erro('Esta transferência já foi revertida.');
    const idsOriginais = new Set(originais.map((m) => m.id));
    disponivel.lots = disponivel.lots.filter((l) => l.transferId && idsOriginais.has(l.transferId));
    disponivel.amount = disponivel.lots.reduce((s, l) => s + l.cents, 0) / 100;
    if (centavos(disponivel.amount) < valor) erro('O saldo recebido já foi utilizado, reservado ou transferido. Esta operação não pode ser revertida integralmente.');
  }
  if (valor > centavos(disponivel.amount)) erro('O valor ultrapassa o saldo comprado regular disponível. O saldo utilizado ou reservado não pode ser transferido.');
  const saldoOrigem = saldo.contaDaCliente(origem, estado.payments, estado.consultations, (contexto.profiles[origem] && contexto.profiles[origem].credit) || 0).balance;
  if (valor > centavos(saldoOrigem)) erro('O saldo atual não permite esta transferência.');
  const escolhidos = fatias(disponivel.lots, valor);
  const eventos = escolhidos.map((lote, indice) => {
    const p = estado.payments.find((x) => x.id === lote.paymentId);
    const v = lote.cents / 100;
    const movimento = {
      id: `${entrada.id}:${indice + 1}`, kind: 'balance-transfer', amount: v, bankEffect: 0, creditEffect: p.clientId === origem ? -v : p.clientId === destino ? v : 0, occurredAt: contexto.at, recordedAt: contexto.at, actor: ator, note: nota,
      operationSignature: assinatura, ruleVersion: 1, balanceTransfer: { operationId: entrada.id, sourceClientId: origem, sourceClient: contexto.names[origem], targetClientId: destino, targetClient: contexto.names[destino], lot: lote, ...(entrada.reversalOf ? { reversalOf: entrada.reversalOf } : {}) },
    };
    return { paymentId: p.id, movement: movimento };
  });
  return { ...estado, payments: estado.payments.map((p) => {
    const novos = eventos.filter((e) => e.paymentId === p.id).map((e) => e.movement);
    return novos.length ? { ...p, movements: [...(p.movements || []), ...novos], updatedAt: contexto.at, updatedBy: ator } : p;
  }) };
}

module.exports = { saldoTransferivel, transferirSaldo };
