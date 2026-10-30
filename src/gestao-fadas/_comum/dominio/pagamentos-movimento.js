'use strict';

/**
 * Movimento financeiro do pagamento no servidor (Maturacao/42): porte de `recordPaymentMovement` (`finance/cash-ledger.ts`), a única função
 * que cria um movimento (devolução, contestação e seus desdobramentos, correção de crédito, reconciliação). As regras de valor do front
 * (devolução <= pago, crédito descontado <= valor para consultas, saídas <= valor no banco, contestação única...) são as frases `throw new Error`.
 * O instante `recordedAt` entra por parâmetro; `stampDemoRecord` é inócuo no modo real (calendário de demonstração desligado).
 */

const L = require('./pagamentos-livro');

const { erro, centavos, arredondar, bruto, liquido, soma, correcaoBruta, creditoDoRecibo, creditoDaDevolucao, estadoDaContestacao, contestacaoAtiva } = L;

/**
 * `recordPaymentMovement(payment, input, actor, id, recordedAt)`. `input`: `{ agendaItemId?, agendaTarotId?, agendaRefundRequestId?, kind, amount, bankMoved,
 * parentId?, creditAmount?, note, occurredAt, occurrenceId?, initiatedBy?, agreement? }` na MESMA ordem de chaves do navegador (a assinatura guarda a ordem).
 */
function registrarMovimento(p, entrada, ator, id, registradoEm) {
  const assinatura = L.assinatura(entrada, arredondar(entrada.amount), ator);
  const existente = (p.movements || []).find((m) => m.id === id);
  if (existente) { if (existente.operationSignature === assinatura) return p; erro('Esta operação já foi registrada. Abra o pagamento novamente.'); }
  if (p.status === 'Cancelado') erro('O pagamento está cancelado.');
  L.validarEscolha(entrada.kind, ['refund', 'dispute', 'dispute-debit', 'dispute-rejected', 'dispute-accepted', 'dispute-return', 'payment-missing', 'scheduled-unpaid', 'payment-reconciled'], 'Movimentação');
  L.validarNome(ator, 'Responsável');
  const nota = L.validarObservacao(String(entrada.note).trim() || L.NOTA_AUTOMATICA(entrada.bankMoved)[entrada.kind], 'Observação', true);
  if (typeof entrada.bankMoved !== 'boolean') erro('Informe se houve movimento no banco.');
  if (!Number.isFinite(new Date(entrada.occurredAt).getTime())) erro('Informe a data e hora da movimentação.');
  const movs = p.movements || [];
  if (!Number.isFinite(entrada.amount) || entrada.amount <= 0 || centavos(entrada.amount) > centavos(bruto(p))) erro('Informe um valor válido, até o total deste pagamento.');
  const valor = arredondar(entrada.amount);
  if (valor <= 0 || !Number.isSafeInteger(centavos(valor))) erro('Informe um valor válido em centavos.');
  let efeitoBanco = 0; let efeitoCredito = 0; let correcaoRecibo; let correcaoBrutaRecibo;
  const tipo = entrada.kind;
  if (tipo === 'payment-missing' || tipo === 'scheduled-unpaid') {
    if (entrada.bankMoved) erro('Pagamento não localizado não é uma saída bancária.');
    if (centavos(valor) > centavos(creditoDoRecibo(p))) erro('A correção ultrapassa o crédito ainda vinculado a este pagamento.');
    efeitoCredito = -valor;
    correcaoRecibo = -arredondar(valor * liquido(p) / p.amount);
    correcaoBrutaRecibo = -arredondar(valor * bruto(p) / p.amount);
  } else if (tipo === 'payment-reconciled') {
    if (entrada.bankMoved) erro('Reconcilie a entrada original sem criar um segundo recebimento.');
    const origem = movs.find((m) => m.id === entrada.parentId && (m.kind === 'payment-missing' || m.kind === 'scheduled-unpaid'));
    if (!origem) erro('Localize a correção de crédito de origem.');
    const filhos = movs.filter((m) => m.parentId === origem.id && m.kind === 'payment-reconciled');
    const restaurado = soma(filhos, (m) => centavos(m.creditEffect));
    if (centavos(valor) > -centavos(origem.creditEffect) - restaurado) erro('O valor ultrapassa o crédito ainda não reconciliado.');
    efeitoCredito = valor;
    const origemRecibo = origem.receiptCorrection !== undefined && origem.receiptCorrection !== null ? origem.receiptCorrection : arredondar(origem.creditEffect * liquido(p) / p.amount);
    const alvo = arredondar((-origemRecibo) * (restaurado + centavos(valor)) / -centavos(origem.creditEffect));
    const antes = soma(filhos, (m) => m.receiptCorrection || 0);
    correcaoRecibo = arredondar(alvo - antes);
    const alvoBruto = arredondar(-correcaoBruta(p, origem) * (restaurado + centavos(valor)) / -centavos(origem.creditEffect));
    correcaoBrutaRecibo = arredondar(alvoBruto - soma(filhos, (m) => correcaoBruta(p, m)));
  } else if (tipo === 'refund') {
    const devolvido = soma(movs.filter((m) => m.kind === 'refund'), (m) => centavos(m.amount));
    if (devolvido + centavos(valor) > centavos(bruto(p))) erro('As devoluções ultrapassam o valor pago.');
    const valorCredito = entrada.creditAmount === undefined || entrada.creditAmount === null ? valor : entrada.creditAmount;
    if (!Number.isFinite(valorCredito) || valorCredito < 0 || valorCredito > valor) erro('Revise o valor a descontar do saldo da cliente.');
    const descontado = -soma(movs.filter((m) => m.kind !== 'balance-transfer'), (m) => centavos(m.creditEffect));
    if (descontado + centavos(valorCredito) > centavos(p.amount)) erro('O desconto no crédito ultrapassa o valor para consultas deste pagamento.');
    efeitoBanco = -valor; efeitoCredito = -arredondar(valorCredito);
  } else if (tipo === 'dispute') {
    if (p.method !== 'PIX' && p.method !== 'Cartão de crédito') erro('Selecione um pagamento Pix ou cartão.');
    if (contestacaoAtiva(p)) erro('Este pagamento já tem contestação pendente. Abra o histórico para atualizar.');
    efeitoBanco = entrada.bankMoved ? -valor : 0;
  } else {
    const origem = movs.find((m) => m.id === entrada.parentId && m.kind === 'dispute');
    if (!origem) erro('Localize a contestação de origem.');
    const filhos = movs.filter((m) => m.parentId === origem.id);
    const rejeitada = filhos.some((m) => m.kind === 'dispute-rejected');
    const aceita = filhos.some((m) => m.kind === 'dispute-accepted');
    const debitado = -origem.bankEffect - filhos.filter((m) => m.kind === 'dispute-debit').reduce((s, m) => s + m.bankEffect, 0);
    const devolvido = filhos.reduce((s, m) => s + Math.max(0, m.bankEffect), 0);
    if (tipo === 'dispute-debit') {
      if (rejeitada || centavos(debitado + valor) > centavos(origem.amount)) erro('A retirada ultrapassa a contestação ou ela não foi aceita pelo banco.');
      efeitoBanco = -valor;
    } else if (tipo === 'dispute-rejected' || tipo === 'dispute-accepted') {
      if (rejeitada || aceita) erro('Esta contestação já tem resultado registrado.');
      if (tipo === 'dispute-rejected' && entrada.bankMoved) {
        if (centavos(valor) > centavos(debitado - devolvido)) erro('A entrada precisa corresponder a dinheiro retirado e ainda não devolvido.');
        efeitoBanco = valor;
      }
    } else if (tipo === 'dispute-return') {
      if (centavos(valor) > centavos(debitado - devolvido)) erro('O valor ultrapassa o dinheiro retirado e ainda não devolvido pelo banco.');
      efeitoBanco = valor;
    }
  }
  if (efeitoBanco < 0) {
    const retirado = -soma(movs, (m) => centavos(m.bankEffect) + centavos(correcaoBruta(p, m)));
    if (retirado + centavos(-efeitoBanco) > centavos(bruto(p))) erro('As saídas ultrapassam o valor deste pagamento ainda disponível no banco.');
    if (tipo !== 'refund') {
      const contestacoes = movs.filter((m) => m.kind.startsWith('dispute'));
      const bancoDebitado = -soma(contestacoes, (m) => centavos(m.bankEffect));
      const alvo = Math.round((bancoDebitado + centavos(-efeitoBanco)) * centavos(p.amount) / centavos(bruto(p)));
      const alvoAnterior = Math.round(bancoDebitado * centavos(p.amount) / centavos(bruto(p)));
      efeitoCredito = -Math.max(0, Math.min(centavos(creditoDoRecibo(p)), alvo - alvoAnterior)) / 100;
    }
  } else if (efeitoBanco > 0) {
    const contestacao = movs.filter((m) => m.id === entrada.parentId || m.parentId === entrada.parentId);
    const debitado = -contestacao.reduce((s, m) => s + Math.min(0, centavos(m.bankEffect)), 0);
    const devolvido = contestacao.reduce((s, m) => s + Math.max(0, centavos(m.bankEffect)), 0);
    const creditoDebitado = -contestacao.reduce((s, m) => s + Math.min(0, centavos(m.creditEffect)), 0);
    const creditoDevolvido = contestacao.reduce((s, m) => s + Math.max(0, centavos(m.creditEffect)), 0);
    const alvo = debitado ? Math.round(creditoDebitado * (devolvido + centavos(efeitoBanco)) / debitado) : 0;
    efeitoCredito = Math.max(0, Math.min(creditoDebitado - creditoDevolvido, alvo - creditoDevolvido)) / 100;
  }
  const movimento = {
    id, ...(tipo === 'refund' ? { agendaItemId: entrada.agendaItemId, agendaTarotId: entrada.agendaTarotId, agendaRefundRequestId: entrada.agendaRefundRequestId } : {}),
    kind: tipo, parentId: entrada.parentId, amount: valor, bankEffect: efeitoBanco, creditEffect: efeitoCredito,
    ...(correcaoRecibo !== undefined ? { receiptCorrection: correcaoRecibo, receiptGrossCorrection: correcaoBrutaRecibo } : {}),
    occurrenceId: entrada.occurrenceId, initiatedBy: entrada.initiatedBy, agreement: entrada.agreement, operationSignature: assinatura, ruleVersion: 1, actor: ator,
    occurredAt: entrada.occurredAt, recordedAt: registradoEm, note: nota,
  };
  return { ...p, movements: [...movs, movimento], updatedAt: registradoEm, updatedBy: ator };
}

module.exports = { registrarMovimento, creditoDaDevolucao, estadoDaContestacao };
