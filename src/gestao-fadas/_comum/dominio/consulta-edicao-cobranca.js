'use strict';

/**
 * Consulta, COBRANÇA DA EDIÇÃO no servidor (Maturacao/38): refaz o que `saveForm` (`consultations-experience.tsx`, linhas 1527 a 1553) calcula depois de
 * montar o registro editado: preço novo da cliente trocada (`priceNewConsultation`), nova fatia do complemento (`repriceChangedComplement`),
 * `billingForConsultation`, o contrato escolhido nos pagamentos (`resolveConsultationTariff` com `repriceContract`), `keepUnusedCashCredit`,
 * `consultationUnitValue` (o `minuteValue`) e, na troca de cliente, `maximumAtRecordedStart`. Tabela de preços, pagamentos, consultas e saldo
 * são os REAIS (`ctx`). Entradas da tela que o registro não guarda (dispensa do mínimo, manter crédito) são lidas do `pedido` e conferidas.
 * Puro: o instante e o autor entram por parâmetro. A composição é transcrita do componente; as funções que ela chama têm ouro do código real.
 */

const c = require('./consulta-comum');
const cob = require('./financeiro-cobranca');
const { precificarNova, reprecificarComplemento, resolverTarifa } = require('./consulta-tarifa');
const { maximoNoInicioGravado } = require('./consulta-maximo');

/** `billingForConsultation` (sem o `funding` salvo: vem dos pagamentos vinculados). */
function cobrancaDoRegistro(item, pagamentos, dispensado, ator, em) {
  const b = item.billing || {};
  return { chargeAdjustments: b.chargeAdjustments, tariff: b.tariff, unitValueOverride: b.unitValueOverride, minimumMinutes: b.minimumMinutes ?? 15, minimumWaived: dispensado, keepUnusedCashCredit: b.keepUnusedCashCredit,
    funding: cob.financiamento(item, pagamentos), decidedBy: ator || b.decidedBy, decidedAt: em || b.decidedAt };
}

/** O que a edição grava de derivado, dado o registro da tela (`pedido`) e o guardado (`antes`). `variante.contratoMudou`: o contrato dos pagamentos foi trocado na tela. */
function refazerCobranca(antes, pedido, ctx, { em, ator, contratoMudou }) {
  const trocouCliente = antes.clientId !== pedido.clientId;
  const pagamentos = ctx.payments;
  const base = { ...pedido, billing: antes.billing, minuteValue: antes.minuteValue };
  let editado = base;
  if (trocouCliente) { editado = { ...base, billing: undefined }; editado = { ...editado, ...precificarNova(editado, ctx, pagamentos) }; }
  else editado = { ...editado, ...reprecificarComplemento(editado, antes, ctx, pagamentos) };
  const minutos = Math.ceil((pedido.durationSeconds || 0) / 60);
  const minimo = (antes.billing && antes.billing.minimumMinutes) ?? 15;
  const permiteDispensar = minutos < minimo && (!pedido.coverage || pedido.coverage.kind === 'Crédito');
  const dispensado = Boolean(pedido.billing && pedido.billing.minimumWaived) && permiteDispensar;
  editado.billing = cobrancaDoRegistro(editado, pagamentos, dispensado, ator, em);
  if (contratoMudou && !pedido.coverage) {
    editado.billing.tariff = resolverTarifa({ clientId: pedido.clientId, at: pedido.startedAt, consultationId: pedido.id, expectedMinutes: pedido.expectedMinutes || undefined, coverage: undefined, existing: trocouCliente ? undefined : antes, payments: pagamentos, repriceContract: true }, ctx);
    editado.billing.unitValueOverride = undefined;
  }
  editado.billing.keepUnusedCashCredit = pedido.status === 'Desistiu' && Boolean(pedido.billing && pedido.billing.keepUnusedCashCredit);
  editado.minuteValue = cob.valorDoMinutoDaConsulta(editado, pagamentos);
  const saida = { billing: editado.billing, minuteValue: editado.minuteValue };
  if (trocouCliente) {
    const maximo = maximoNoInicioGravado(editado, ctx.consultations, pagamentos, ctx.profiles);
    saida.maximumMinutesAtStart = maximo.minutes; saida.maximumIncludesPendingAtStart = maximo.includesPending;
  }
  return saida;
}

const MENSAGEM = 'Não foi possível conferir o valor desta edição. Atualize a tela e tente novamente.';
const chave = (o) => JSON.stringify(JSON.parse(JSON.stringify(o)), (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
const recorte = (x) => chave({ billing: x.billing, minuteValue: x.minuteValue, maximumMinutesAtStart: x.maximumMinutesAtStart, maximumIncludesPendingAtStart: x.maximumIncludesPendingAtStart });

/** É uma gravação de `saveForm`? A cobrança dele leva o autor e o instante da própria edição. */
const ehEdicaoDeTela = (antes, pedido) => Boolean(pedido.billing && pedido.billing.decidedAt && pedido.billing.decidedAt === pedido.updatedAt && !(antes.billing && antes.billing.decidedAt === pedido.updatedAt));

/**
 * Confere o que o navegador calculou (com o instante e o autor dele) contra o refeito, nas duas variantes do contrato, e devolve o refeito com o
 * instante e o autor do SERVIDOR. Lança `RegraConsultaError` quando nenhuma variante bate.
 */
function conferirECorrigir(antes, pedido, ctx, { em, ator }) {
  const doNavegador = recorte({ ...pedido, maximumMinutesAtStart: pedido.maximumMinutesAtStart, maximumIncludesPendingAtStart: pedido.maximumIncludesPendingAtStart });
  const atorDoNavegador = (pedido.billing && pedido.billing.decidedBy) || ator;
  for (const contratoMudou of [false, true]) {
    const comoOFront = refazerCobranca(antes, pedido, ctx, { em: pedido.updatedAt, ator: atorDoNavegador, contratoMudou });
    const mesmoRecorte = recorte({ ...comoOFront, maximumMinutesAtStart: comoOFront.maximumMinutesAtStart ?? pedido.maximumMinutesAtStart, maximumIncludesPendingAtStart: comoOFront.maximumIncludesPendingAtStart ?? pedido.maximumIncludesPendingAtStart });
    if (mesmoRecorte === doNavegador) return refazerCobranca(antes, pedido, ctx, { em, ator, contratoMudou });
  }
  throw new c.RegraConsultaError(MENSAGEM);
}

module.exports = { refazerCobranca, conferirECorrigir, ehEdicaoDeTela, cobrancaDoRegistro, MENSAGEM };
