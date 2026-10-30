'use strict';

/**
 * Pagamento que sustenta complemento ou bônus no servidor (Maturacao/42): porte de `validatePaymentComplementChanges`
 * (`domain/consultation-billing.ts`), que a planilha chama depois de corrigir um recebimento. Recusa a correção que muda o valor do minuto
 * da origem de um complemento, o complemento já concedido ou a capacidade de um bônus concedido. Usa o acerto da consulta (`financeiro-cobranca.js`).
 */

const b = require('./financeiro-base');
const c = require('./financeiro-cobranca');
const { capacidadeDoBonus } = require('./consulta-vinculos');
const { erro } = require('./pagamentos-livro');

/** `validatePaymentComplementChanges(before, after, consultations)`. */
function validarComplementoDoPagamento(antes, depois, consultas) {
  const origens = new Set(consultas.filter((i) => i.coverage && i.coverage.kind === 'Complemento' && b.consomeCobertura(i)).map((i) => i.coverage.sourceConsultationId));
  for (const origem of consultas.filter((i) => origens.has(i.id))) {
    const anterior = c.acerto(origem, antes); const proximo = c.acerto(origem, depois);
    if (Math.abs(anterior.unitValue - proximo.unitValue) > 0.000001 || proximo.complementMinutes + proximo.creditCompletionMinutes < anterior.complementMinutes + anterior.creditCompletionMinutes) {
      erro('Este pagamento já financia um complemento. Confira o complemento antes de alterar o valor, o vínculo ou o recebimento.');
    }
  }
  for (const origem of consultas.filter((i) => i.bonusGrant && i.bonusGrant.minutes)) {
    if (origem.bonusGrant.unitValue && Math.abs(origem.bonusGrant.unitValue - c.valorDoMinutoDaConsulta(origem, depois)) > 0.000001) erro('Este pagamento sustenta um bônus concedido. Preserve o valor do minuto da origem.');
    if (consultas.some((i) => b.consomeCobertura(i) && i.minuteBenefits && i.minuteBenefits.some((x) => x.sourceConsultationId === origem.id)) && Math.abs(c.valorDoMinutoDaConsulta(origem, antes) - c.valorDoMinutoDaConsulta(origem, depois)) > 0.000001) erro('Este pagamento sustenta um bônus utilizado ou reservado. Preserve a tarifa da origem.');
    const capacidadeAnterior = capacidadeDoBonus(origem, antes); const capacidadeProxima = capacidadeDoBonus(origem, depois);
    if (capacidadeAnterior !== capacidadeProxima && origem.bonusGrant.minutes > capacidadeProxima) erro('Este pagamento sustenta um bônus já concedido. Preserve os minutos pagos ou corrija o bônus antes.');
  }
}

module.exports = { validarComplementoDoPagamento };
