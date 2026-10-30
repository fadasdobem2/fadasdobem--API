'use strict';

/**
 * MAPEAMENTOS PROVISÓRIOS, pendentes da Nice (Maturacao/50). Ficam TODOS neste arquivo para trocar num lugar só. Base: leitura agregada de produção
 * (últimos 12 meses) e o código do ASP (Maturacao/47). Nada aqui é regra confirmada.
 */

/** Forma de consulta (`tbl_formaconsulta`): produção grava quase tudo como 4 (Skype) = 78.515; PABX 9.855; Indefinida 33. WhatsApp e chat -> 4 (pergunta 2 do doc 50). */
function formaDeConsulta(canal) {
  if (canal === 'PABX') return 1;
  if (canal === 'Telefone') return 5;
  if (typeof canal === 'string' && /^WhatsApp/.test(canal)) return 4;
  return 6;
}

/** Forma de pagamento da consulta (`tbl_opcaopagto`): 8 Pré Pago (48.059) e 1 Depósito (40.268). Pós-paga -> 1 (pergunta 3 do doc 50). */
const formaDePagamentoDaConsulta = (perfil) => (perfil === 'Pré-paga' ? 8 : 1);

/**
 * `id_status_pagto` de um pagamento informado MANUAL novo = 1 ("Não Confirmado"); a confirmação grava 2. NUNCA 0: o 0 é o marcador do FLUXO AUTOMÁTICO de compra de
 * crédito (sem atendente, forma 8; ~8.200 linhas em 30 dias), que não é nosso. Evidência da tela manual: o formulário de informar pagamento envia o campo
 * `id_status_pagto` (`chat/salvaPagamento.asp:28`) ao INSERT (`chat/DBStore_controle_consultas.asp:139,151`), com 1 como valor padrão (`chat/classes/selects.asp:125`,
 * `chat/inc/lancar-pagto.asp:393,404`); só `== 2` é lido como "(Confirmado)" (`chat/controle_pagtoinfo.asp:574`). Produção, 30 dias, por atendente: status 2 = 1.004, status 1 = 19.
 */
const STATUS_PAGTO_NOVO = 1;
const STATUS_PAGTO_CONFIRMADO = 2;

/**
 * Canal de pagamento do sistema novo -> ids EXISTENTES no legado (princípio do Patrick: o ASP segue vivo, nada de pedir linhas novas de catálogo; PROVISÓRIO, pendente
 * da Nice). Produção, 6 meses, pagamentos de atendente: forma 8 + banco 5 = 12.567; forma 1 + banco 2 = 555, banco 3 = 95, banco 4 = 7.
 *   Mercado Pago (qualquer forma) -> 8 + 5 | Dinheiro -> 1 + 5 | PIX, Depósito -> forma 1 | Transferência -> forma 3 |
 *   banco: Santander 4, BB 3, Itaú, Itaú Jurídica e Caixa 2, nenhum -> 5 (Indefinido) | Cartão de crédito (fora Mercado Pago): forma 2, que exige bandeira e parcelas
 *   como o ASP; o lançamento do sistema novo não os informa, então é recusado (`null`). Os ids são validados nos catálogos do legado antes de gravar.
 */
function canalDePagamento(metodo, banco) {
  if (banco === 'Mercado Pago') return { idFormaPagto: 8, idBanco: 5 };
  if (metodo === 'Cartão de crédito') return null;
  if (metodo === 'Dinheiro') return { idFormaPagto: 1, idBanco: 5 };
  const idFormaPagto = metodo === 'Transferência' ? 3 : metodo === 'PIX' || metodo === 'Depósito' ? 1 : null;
  if (idFormaPagto === null) return undefined;
  const idBanco = { Santander: 4, BB: 3, Itaú: 2, 'Itaú Jurídica': 2, Caixa: 2 }[banco];
  return { idFormaPagto, idBanco: idBanco === undefined ? 5 : idBanco };
}

module.exports = { canalDePagamento, formaDeConsulta, formaDePagamentoDaConsulta, STATUS_PAGTO_NOVO, STATUS_PAGTO_CONFIRMADO };
