'use strict';

/**
 * Regras PURAS do acordo e da abertura de repasse (porta FIEL de `features/finance/real-payout-agreement.ts` e
 * `real-payout-opening.ts`, B; spec 004, I9, T045). Sem I/O. Dinheiro nunca passa por ponto flutuante: o campo
 * ("1.234,56") vira o texto do contrato ("1234.56") por texto, e as somas e a divisão das parcelas são em centavos
 * inteiros (BigInt). As GRAVAÇÕES não existem nesta API (ver repasse.service.js, TODO): aqui ficam a leitura do DTO,
 * os rótulos e a validação/montagem do corpo que a escrita futura vai usar.
 */

/** Fachada: reexporta a API pública, dividida por assunto em repasse.model.*.js. */

const { sumMoney } = require('./helpers/dinheiro');
const acordo = require('./repasse.model.acordo');
const abertura = require('./repasse.model.abertura');
const dinheiro = require('./repasse.model.dinheiro');
const parcelas = require('./repasse.model.parcelas');
const formulario = require('./repasse.model.formulario');
const pedido = require('./repasse.model.pedido');
const revisao = require('./repasse.model.revisao');
const { isPayoutPerson } = require('./repasse.model.comum');

module.exports = {
  DEFAULT_RATE: acordo.DEFAULT_RATE, MAX_PAYOUT_LOAN_INSTALLMENTS: parcelas.MAX_PAYOUT_LOAN_INSTALLMENTS,
  payoutLoanFrequencyLabels: parcelas.payoutLoanFrequencyLabels,
  isPayoutSchedule: acordo.isPayoutSchedule, isPayoutPerson, parseAgreement: acordo.parseAgreement, rateLabel: acordo.rateLabel,
  rateFieldValue: acordo.rateFieldValue, rateFromField: acordo.rateFromField, scheduleFromField: acordo.scheduleFromField,
  scheduleToField: acordo.scheduleToField, scheduleProblem: acordo.scheduleProblem, scheduleLabel: acordo.scheduleLabel,
  agreementChanges: acordo.agreementChanges, commissionBody: acordo.commissionBody, scheduleBody: acordo.scheduleBody,
  operationKeys: acordo.operationKeys, localMomentLabel: acordo.localMomentLabel, newestAgreement: acordo.newestAgreement,
  personName: acordo.personName, agreementHistory: acordo.agreementHistory,
  parseOpenings: abertura.parseOpenings, newestOpenings: abertura.newestOpenings,
  moneyFromField: dinheiro.moneyFromField, moneyToField: dinheiro.moneyToField, sumMoney,
  blankDebt: parcelas.blankDebt, debtPlan: parcelas.debtPlan, editInstallment: parcelas.editInstallment, chooseFrequency: parcelas.chooseFrequency,
  blankAdjustment: formulario.blankAdjustment, blankDifference: formulario.blankDifference, blankForm: formulario.blankForm,
  liveDebts: formulario.liveDebts, formFromOpening: formulario.formFromOpening, settledThroughLabel: formulario.settledThroughLabel,
  openingRequest: pedido.openingRequest, revisionTag: revisao.revisionTag, openingTotals: revisao.openingTotals,
  localMomentText: revisao.localMomentText, momentLabel: revisao.momentLabel, settledThroughText: revisao.settledThroughText,
};
