'use strict';

/**
 * Correção de movimento financeiro no servidor (Maturacao/42, item 1 do plano): porte de `correctPaymentMovement`
 * (`features/finance/payment-movement-correction.ts`), que o front usa em "Editar movimento" (`payment-movement-editor.tsx`) e na planilha
 * (`correctSpreadsheetPayment` com `movementId`). Refaz o replay dos movimentos seguintes na ordem de registro (nunca por data), com as mesmas
 * recusas e a mesma frase. O contexto de crédito (`payments`, `consultations`, `profile`) é o REAL da cliente, lido do banco.
 */

const L = require('./pagamentos-livro');
const { registrarMovimento, creditoDaDevolucao } = require('./pagamentos-movimento');
const { creditoRestante, retratoDoCredito } = require('./pagamentos-credito');

const { erro, centavos, arredondar, bruto, soma } = L;
const MS = (v) => Date.parse(v);

/** `correctPaymentMovement(payment, id, { amount, occurredAt, note }, actor, now, creditContext)`. */
function corrigirMovimento(p, id, entrada, ator, agora, contextoCredito) {
  if (p.status === 'Cancelado') erro('O pagamento está cancelado.');
  L.validarNome(ator, 'Responsável');
  const todos = p.movements || [];
  const indice = todos.findIndex((m) => m.id === id);
  if (indice < 0) erro('Movimento não localizado. Abra o registro novamente.');
  const velho = todos[indice];
  if (velho.kind === 'balance-transfer') erro('A transferência de saldo tem dois cadastros vinculados e não pode ser alterada como um movimento bancário.');
  const valorMudou = velho.amount !== arredondar(entrada.amount) || MS(velho.occurredAt) !== MS(entrada.occurredAt);
  if (todos.slice(indice + 1).some((m) => m.kind === 'balance-transfer') && valorMudou) erro('Há transferência de saldo posterior a este movimento. Preserve o valor e a data; a observação pode ser corrigida.');
  if (velho.occurrenceId && valorMudou) erro('Este movimento pertence a uma ocorrência financeira. Abra a ocorrência para registrar a decisão ou reconciliação, preservando a origem.');
  if (!Number.isFinite(entrada.amount) || !Number.isSafeInteger(centavos(entrada.amount)) || centavos(entrada.amount) <= 0 || centavos(entrada.amount) > centavos(bruto(p))) erro('Informe um valor válido, até o total deste pagamento.');
  if (!Number.isFinite(new Date(entrada.occurredAt).getTime())) erro('Informe a data e hora do movimento.');
  const nota = L.validarObservacao(entrada.note, 'Observação', false);
  if (velho.creditSnapshot && new Date(entrada.occurredAt).getTime() !== new Date(velho.occurredAt).getTime()) erro('Este estorno registra o saldo em minutos naquela data. Confira a cronologia dos movimentos antes de alterar sua data; valor e observação podem ser corrigidos aqui.');
  const editado = { ...velho, amount: arredondar(entrada.amount), occurredAt: entrada.occurredAt, note: nota };
  if (velho.amount === editado.amount && new Date(velho.occurredAt).getTime() === new Date(editado.occurredAt).getTime() && velho.note === nota) return p;
  let movimentos = todos.map((m) => (m.id === id ? editado : m));
  if (velho.amount !== editado.amount) {
    if (todos.some((m) => m.creditSnapshot) && todos.some((m, pos) => pos > 0 && MS(m.occurredAt) < MS(todos[pos - 1].occurredAt))) erro('Há movimentos retroativos fora de ordem neste pagamento. Confira a cronologia antes de corrigir valores; a observação pode ser editada.');
    // Replay do sufixo dependente na ordem de registro, nunca na ordem de data.
    let resultado = { ...p, movements: todos.slice(0, indice) };
    let ajusteValor = 0; let ajusteMinutos = 0;
    for (let pos = indice; pos < todos.length; pos += 1) {
      const original = todos[pos];
      const atual = pos === indice ? editado : original;
      const prefixoOriginal = { ...p, movements: todos.slice(0, pos) };
      const comoEntrada = (m, valorCredito) => ({ agendaItemId: m.agendaItemId, agendaTarotId: m.agendaTarotId, agendaRefundRequestId: m.agendaRefundRequestId, kind: m.kind, amount: m.amount, bankMoved: m.bankEffect !== 0, parentId: m.parentId, creditAmount: valorCredito, note: m.note, occurredAt: m.occurredAt });
      let valorCredito = original.kind === 'refund' ? -original.creditEffect : undefined;
      if (original.creditSnapshot) valorCredito = pos === indice ? arredondar(-original.creditEffect * atual.amount / original.amount) : -original.creditEffect;
      if (!original.creditSnapshot && pos === indice && original.kind === 'refund' && centavos(creditoDaDevolucao(prefixoOriginal, original.amount)) === centavos(-original.creditEffect)) valorCredito = creditoDaDevolucao(resultado, atual.amount);
      const base = registrarMovimento(prefixoOriginal, comoEntrada(original, original.kind === 'refund' ? -original.creditEffect : undefined), original.actor, original.id, original.recordedAt || original.occurredAt).movements.at(-1);
      if (original.creditEffect !== 0 && centavos(base.creditEffect) !== centavos(original.creditEffect)) erro('Este movimento tem um ajuste de crédito anterior. Corrija a data ou a observação; o valor exige conferir esse ajuste.');
      const refeito = registrarMovimento(resultado, comoEntrada(atual, valorCredito), original.actor, original.id, original.recordedAt || original.occurredAt);
      let proximo = refeito.movements.at(-1);
      // Movimento só-banco importado não cria crédito/débito novo para a cliente.
      if (original.creditEffect === 0 && base.creditEffect !== 0) proximo = { ...proximo, creditEffect: 0 };
      proximo = { ...original, ...proximo, demoDate: atual.demoDate, recordedAt: original.recordedAt, note: atual.note };
      if (original.creditSnapshot) {
        const antes = { amount: arredondar(original.creditSnapshot.before.amount + ajusteValor), minutes: original.creditSnapshot.before.minutes + ajusteMinutos };
        proximo.creditSnapshot = retratoDoCredito(antes, -proximo.creditEffect, original.creditSnapshot.unitValue);
        ajusteMinutos += proximo.creditSnapshot.minutesEffect - original.creditSnapshot.minutesEffect;
      }
      ajusteValor += proximo.creditEffect - original.creditEffect;
      resultado = { ...resultado, movements: [...resultado.movements, proximo] };
    }
    movimentos = resultado.movements;
    if (todos.some((m) => m.creditSnapshot)) {
      if (!contextoCredito) erro('Abra o movimento na conta da cliente para conferir o crédito antes de corrigir o valor.');
      const debitoExtra = centavos(soma(todos, (m) => m.creditEffect) - soma(movimentos, (m) => m.creditEffect));
      if (debitoExtra > centavos(creditoRestante(p, contextoCredito, agora).amount)) erro('A correção retiraria crédito já utilizado ou reservado. Confira as consultas vinculadas.');
    }
  }
  const mudancas = [`Movimento ${id}.`];
  if (velho.amount !== editado.amount) mudancas.push(`Valor: ${L.numero2(velho.amount)} → ${L.numero2(editado.amount)}.`);
  if (new Date(velho.occurredAt).getTime() !== new Date(editado.occurredAt).getTime()) mudancas.push(`Data: ${velho.occurredAt} → ${editado.occurredAt}.`);
  if (velho.note !== nota) mudancas.push(`Observação: ${velho.note || '—'} → ${nota || '—'}.`);
  movimentos.forEach((m, i) => { if (m.bankEffect !== todos[i].bankEffect || m.creditEffect !== todos[i].creditEffect) mudancas.push(`${m.id}: banco ${L.numero2(todos[i].bankEffect)} → ${L.numero2(m.bankEffect)}; saldo ${L.numero2(todos[i].creditEffect)} → ${L.numero2(m.creditEffect)}.`); });
  movimentos.forEach((m, i) => { if (m.creditSnapshot && m.creditSnapshot.minutesEffect !== (todos[i].creditSnapshot ? todos[i].creditSnapshot.minutesEffect : undefined)) mudancas.push(`${m.id}: minutos retirados ${-((todos[i].creditSnapshot && todos[i].creditSnapshot.minutesEffect) || 0)} → ${-m.creditSnapshot.minutesEffect}.`); });
  return { ...p, movements: movimentos, updatedAt: agora, updatedBy: ator, audit: [...L.trilhaDeAuditoria(p), L.eventoDeAuditoria('Movimentação corrigida', mudancas.join(' '), ator, agora)] };
}

module.exports = { corrigirMovimento };
