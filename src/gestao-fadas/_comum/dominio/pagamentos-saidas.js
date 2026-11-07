'use strict';

/**
 * Quem pode registrar SAÍDAS de pagamento (devolução, estorno, contestação) no servidor. Porte de `features/finance/outgoing-permissions.ts`
 * (`canRegisterPaymentOutgoing`, v706). A autoridade vem da CONTA autenticada, nunca do formulário: conta inativa ou de outro papel nega;
 * administradora e assistente sempre podem; atendente e supervisora só com `financialPermissions.registerOutgoing === true` na conta ativa.
 * Sem conta (chamada sem a conta carregada) vale o padrão seguro: só administradora e assistente. Ouro: scripts/gerar-ouro-gf-area5-v706.js. Puro.
 */

function podeRegistrarSaida(papel, conta) {
  if (conta && (!conta.active || conta.role !== papel)) return false;
  return papel === 'administradora' || papel === 'assistente'
    || Boolean((papel === 'atendente' || papel === 'supervisora') && conta && conta.active && conta.financialPermissions && conta.financialPermissions.registerOutgoing === true);
}

const MSG_SAIDA = 'Seu acesso não está autorizado a registrar saídas.';
const MSG_DECISAO = 'A decisão de manter ou dispensar cobrança é feita pela assistente ou administradora.';

module.exports = { podeRegistrarSaida, MSG_SAIDA, MSG_DECISAO };
