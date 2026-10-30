'use strict';

/**
 * As duas pontas do ouro financeiro, com a MESMA forma de saída: `RESUMO` roda o código real do front (gerador) e `PORTE` roda o domínio
 * portado do servidor (verificador). Só campos que decidem dinheiro ou regra entram na comparação.
 */

const dom = '../../src/gestao-fadas/_comum/dominio';

const acerto = (s) => ({
  actual: s.actual, reported: s.reported, minimum: s.minimum, unitValue: s.unitValue, purchased: s.purchased, funded: s.funded, chargeable: s.chargeable, grossDebit: s.grossDebit,
  waivedAmount: s.waivedAmount, debit: s.debit, cashCredit: s.cashCredit, complementMinutes: s.complementMinutes, creditCompletionMinutes: s.creditCompletionMinutes,
  unusedBenefit: s.unusedBenefit, canWaive: s.canWaive,
  creditAllocations: s.creditAllocations && s.creditAllocations.map((a) => ({ paymentId: a.paymentId || null, kind: a.kind, usedCents: a.usedCents, usedMinutes: a.usedMinutes })),
});
const conta = (r) => ({ balance: r.balance, received: r.received, consumed: r.consumed, adjustments: r.adjustments });
const lote = (l) => ({ kind: l.kind, paymentId: l.paymentId || null, cents: l.cents, minutes: l.minutes, unitValue: l.unitValue, minutesKnown: Boolean(l.minutesKnown) });
const tarifa = (t) => ({
  unitValue: t.unitValue, availableMinutes: t.availableMinutes, exactAvailableMinutes: t.exactAvailableMinutes, availableAmount: t.availableAmount, knownMinutes: t.knownMinutes,
  unknownAmount: t.unknownAmount, hasUnpricedOpening: t.hasUnpricedOpening, availableLots: t.availableLots.map(lote), paymentIds: t.paymentIds,
});
const cobertura = (r) => ({ balance: r.balance, postpaid: r.postpaid, benefitMinutes: r.benefitMinutes, hasConfirmedReceipt: r.hasConfirmedReceipt, confirmedAvailableBalance: r.confirmedAvailableBalance, awaitingConfirmation: r.awaitingConfirmation, canConsult: r.canConsult, canLaunch: r.canLaunch, label: r.label });
const excesso = (r) => ({ debit: r.debit, availableCents: r.availableCents, otherActive: r.otherActive, extraCovered: r.extraCovered });

/** O que o servidor recebe do front ao criar uma versão de preço: o preludio de `createFinancialSettingsVersion` (campos alterados). */
function versaoEnviada(c, campos, clonar) {
  const rascunho = clonar(c.draft); rascunho.pixKey = rascunho.pixKey.trim();
  const original = clonar(c.original);
  const alterados = campos[c.secao].filter((campo) => JSON.stringify(rascunho[campo]) !== JSON.stringify(original[campo]));
  return { id: c.id, effectiveAt: c.efetivaEm, changedFields: alterados, ...Object.fromEntries(alterados.map((campo) => [campo, rascunho[campo]])) };
}
const comErro = (fn) => { try { return fn(); } catch (e) { return { erro: e.message }; } };

const RESUMO = {
  acerto: (fr, c) => acerto(fr.cobranca.consultationSettlement(c.item, c.pagamentos)),
  conta: (fr, c) => conta(fr.caixa.clientCashAccount(c.clientId, c.pagamentos, c.consultas, c.abertura)),
  tarifa: (fr, c) => tarifa(fr.tarifa.clientCreditTariff(c.clientId, c.em, c.pedidos, c.consultas, c.pagamentos, c.perfil, c.excepto)),
  cobertura: (fr, c) => cobertura(fr.cobertura.clientFundingCoverage(c.clientId, c.pagamentos, c.consultas, c.perfil)),
  excesso: (fr, c) => excesso(fr.termino.assessTarologistFinish(c.item, c.minutos, c.em, c.fin || undefined)),
  vigente: (fr, c) => fr.precos.effectivePricing(c.historico, c.em),
  normalizar: (fr, c) => fr.ajustes.normalizeScheduledFinancialSettingsHistory(c.historico, c.agora),
  versao: (fr, c) => comErro(() => fr.ajustes.createFinancialSettingsVersion({ history: c.historico, draft: c.draft, original: c.draft && JSON.parse(JSON.stringify(c.original)), section: c.secao, actor: c.ator, effectiveAt: c.efetivaEm, now: c.agora, id: c.id })),
  compra: (fr, c) => fr.precos.recognizePurchase(c.valor, c.preco) || null,
  alterar: (fr, c) => comErro(() => fr.restricao.changeRestriction(c.linhas, c.entrada)),
  queixas: (fr, c) => fr.restricao.syncComplaintRestrictions(c.linhas, c.consultas),
  visiveis: (fr, c) => fr.restricao.restrictionsVisibleTo(c.linhas, c.role, c.ownTarotId),
  restrita: (fr, c) => fr.restricao.isAttendanceRestricted(c.linhas, c.clientId, c.tarotId),
};

function porte() {
  const cobranca = require(`${dom}/financeiro-cobranca`); const saldo = require(`${dom}/financeiro-saldo`); const base = require(`${dom}/financeiro-base`);
  const precos = require(`${dom}/precos`); const restricoes = require(`${dom}/restricoes`);
  return {
    acerto: (c) => acerto(cobranca.acerto(c.item, c.pagamentos)),
    conta: (c) => conta(saldo.contaDaCliente(c.clientId, c.pagamentos, c.consultas, c.abertura)),
    tarifa: (c) => tarifa(saldo.tarifaDeCredito(c.clientId, c.em, c.pedidos, c.consultas, c.pagamentos, c.perfil, c.excepto)),
    cobertura: (c) => cobertura(saldo.coberturaDaCliente(c.clientId, c.pagamentos, c.consultas, c.perfil)),
    excesso: (c) => excesso(saldo.coberturaDoExcesso(c.item, c.minutos, c.em, c.fin || undefined)),
    vigente: (c) => base.precoVigente(c.historico, c.em),
    normalizar: (c) => precos.normalizarAgendadas(c.historico, c.agora),
    versao: (c) => comErro(() => precos.criarVersao({ historico: c.historico, versao: versaoEnviada(c, precos.CAMPOS, precos.clonar), ator: c.ator, agora: c.agora })),
    compra: (c) => precos.reconhecerCompra(c.valor, c.preco) || null,
    alterar: (c) => comErro(() => restricoes.alterar(c.linhas, c.entrada)),
    queixas: (c) => restricoes.sincronizarQueixas(c.linhas, c.consultas),
    visiveis: (c) => restricoes.visiveisPara(c.linhas, c.role, c.ownTarotId),
    restrita: (c) => restricoes.estaRestrita(c.linhas, c.clientId, c.tarotId),
  };
}

module.exports = { RESUMO, porte };
