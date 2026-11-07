'use strict';

/**
 * Núcleo puro da apuração do repasse (porta FIEL de `features/finance/real-payout-core.ts`, B; spec 004, etapa 2).
 * Sem I/O: o serviço lê o legado e as `gf_repasse_*` na borda e passa os dados para cá. Dinheiro em centavos inteiros
 * (BigInt), nunca em ponto flutuante: entra o texto DECIMAL e sai o texto "123.45" (R13). Instantes locais de São
 * Paulo chegam como texto, com espaço (tabelas gf_) ou "T" (leitor do legado), e são comparados como texto depois de
 * normalizados, sem fuso (R4). Datas civis "AAAA-MM-DD" também se comparam como texto. A data de referência entra por
 * argumento, como o agora local que separa a consulta em curso: o núcleo não lê o relógio nem gera identificador.
 *
 * Os nomes das funções e dos campos do DTO são os da B de propósito (paridade e conferência lado a lado).
 */


/** Fachada: reexporta a API pública do núcleo, dividido por assunto em repasse.core.*.js. */

const { moneyToCents, centsToMoney } = require('./helpers/dinheiro');
const { commissionCents, consultationRates } = require('./repasse.core.percentual');
const { legacyConsultationBase, consultationAmount } = require('./repasse.core.base');
const { payoutComposition } = require('./repasse.core.apuracao');
const { expectedPayment } = require('./repasse.core.calendario');
const { debtBalances, checkDebtCorrection } = require('./repasse.core.dividas');
const { buildDueRow } = require('./repasse.core.linha-a-pagar');
const { payoutVersion } = require('./repasse.core.versao');

module.exports = {
  moneyToCents, centsToMoney, commissionCents, consultationRates, legacyConsultationBase, consultationAmount,
  payoutComposition, expectedPayment, debtBalances, checkDebtCorrection, buildDueRow, payoutVersion,
};
