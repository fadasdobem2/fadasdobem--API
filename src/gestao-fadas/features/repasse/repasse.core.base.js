'use strict';

/** Base das consultas legadas (R12) e valor do repasse da consulta. */

const { moneyToCents, centsToMoney } = require('./helpers/dinheiro');
const { ZERO } = require('./repasse.core.util');
const { commissionCents } = require('./repasse.core.percentual');

// ---- Base das consultas legadas (R12) ----

/** Tabela R12, na ordem: vale a primeira linha cujas condições batem todas. Mudar a regra é decisão registrada (VI). */
const LEGACY_BASE_RULES = [
  { when: { cancellation: ['retirado'] }, base: 'zero' },
  { when: { cancellation: ['nenhum', 'pendente', 'mantido'], finished: [true], minutes: [true], amount: [true], bonus: [false], abatement: [false] }, base: 'recorded-amount' },
  // Com bônus, com abatimento, com valor 0 ou nulo, sem minutos, ou "manter pagamento" com bônus: sem valor presumido (FR-025).
  { when: {}, base: 'pending-review' },
];
const RECORDED_AMOUNT_RULE = LEGACY_BASE_RULES.find((rule) => rule.base === 'recorded-amount');

function positiveMoney(valor) {
  return valor !== null && moneyToCents(valor) > ZERO;
}

/** Finalizada pela R4: com fim e com minutagem registrados. */
function finishedConsultation(consultation) {
  return consultation.endedAtLocal !== null && consultation.recordedMinutes !== null;
}

function failedConditions(rule, facts) {
  return Object.entries(rule.when).filter(([chave, aceitos]) => !aceitos.includes(facts[chave])).map(([chave]) => chave);
}

/**
 * Base da consulta legada (FR-024, R12). Nunca usa outro campo do cadastro do tarólogo.
 * consultation: { endedAtLocal, recordedMinutes, recordedAmount, appliedBonusMinutes, recordedAbatement }
 * cancellation: 'pendente' | 'mantido' | 'retirado' | null
 */
function legacyConsultationBase(consultation, cancellation) {
  const facts = {
    cancellation: cancellation ?? 'nenhum',
    finished: finishedConsultation(consultation),
    minutes: (consultation.recordedMinutes ?? 0) > 0,
    amount: positiveMoney(consultation.recordedAmount),
    // vlBonus nulo ou 0 é sem bônus; abatimento nulo ou 0 é sem abatimento.
    bonus: (consultation.appliedBonusMinutes ?? 0) > 0,
    abatement: consultation.recordedAbatement !== null && moneyToCents(consultation.recordedAbatement) !== ZERO,
  };
  const rule = LEGACY_BASE_RULES.find((item) => failedConditions(item, facts).length === 0);
  if (rule.base === 'zero') return { status: 'known', base: '0.00', rule: 'removed' };
  if (rule.base === 'recorded-amount') return { status: 'known', base: consultation.recordedAmount, rule: 'recorded-amount' };
  // O motivo da pendência são as condições da linha de valor_consulta que a consulta não cumpre.
  const reasons = failedConditions(RECORDED_AMOUNT_RULE, facts).filter((chave) => chave !== 'cancellation');
  return { status: 'pending-review', reasons };
}

/**
 * Repasse da consulta (data-model, seção 4): base × percentual, meio para cima em centavos. Retirado vale zero.
 * Sem percentual informado, a consulta é do histórico quitado e não gera valor; pendente de conferência fica sem valor.
 */
function consultationAmount(base, rate) {
  if (rate.status === 'not-informed') return null;
  if (base.status === 'known' && base.rule === 'removed') return '0.00';
  if (base.status !== 'known' || rate.status !== 'known') return null;
  return centsToMoney(commissionCents(moneyToCents(base.base), rate.rate));
}

module.exports = { finishedConsultation, legacyConsultationBase, consultationAmount };
