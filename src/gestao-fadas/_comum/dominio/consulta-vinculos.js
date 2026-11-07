'use strict';

/**
 * Consulta, VÍNCULOS de bônus, cortesia e complemento no servidor (Maturacao/38). Porte de `domain/client-minute-benefits.ts`
 * (`validateMinuteBenefits`), `domain/consultation-billing.ts` (`validateComplementChanges`, `availableComplement`,
 * `cancellationBonusCapacity`, `cancellationBonusGrant`, `fundedMinutesForConsultation`) e `domain/consultation-compensation.ts`
 * (`compensationMaximum`, `compensationGrant`). Puro (sem relógio: o instante entra por parâmetro). Ouro do código real do front.
 */

const b = require('./financeiro-base');
const cob = require('./financeiro-cobranca');
const fd = require('./financeiro-financiamento-dividido');

const { erro } = require('./consulta-comum');
const normalizado = (id) => (id || '').trim().toUpperCase().replace(/^C-/, '');
const consome = b.consomeCobertura;

/** `fundedMinutesForConsultation`. */
function minutosFinanciados(item, pagamentos) {
  return cob.financiamento(item, pagamentos).reduce((soma, lote) => {
    const p = pagamentos.find((x) => x.id === lote.paymentId);
    const disponivel = fd.valorDaFatia(lote, p); // v706: recibo dividido, só a fatia desta consulta
    return soma + Math.max(0, Math.floor(p.cashUnitValue ? disponivel / p.cashUnitValue + 0.000001 : lote.amount > 0 ? (lote.minutes * disponivel) / lote.amount + 0.000001 : 0));
  }, 0);
}

/** `cancellationBonusCapacity`. */
function capacidadeDoBonus(item, pagamentos) {
  if (!consome(item)) return 0;
  if (item.bonusGrant && item.bonusGrant.basis === 'manual') return item.bonusGrant.minutes;
  const pagos = consome(item) ? minutosFinanciados(item, pagamentos) : 0;
  const cobertos = item.coverage && (item.coverage.minutes > 0 || item.coverage.balanceOnly) ? Math.round(cob.minutosDeCredito(item)) : 0;
  return Math.max(0, pagos || cobertos);
}

/** `cancellationBonusGrant`. */
function concessaoDeBonus(item, pagamentos, minutos, ator, em) {
  if (!Number.isSafeInteger(minutos) || minutos < 1) erro('Informe os minutos inteiros do bônus.');
  const maximo = capacidadeDoBonus(item, pagamentos);
  if (maximo > 0 && minutos > maximo) erro(`O bônus pode ter até ${maximo} minutos.`);
  return { minutes: minutos, unitValue: cob.valorDoMinutoDaConsulta(item, pagamentos), grantedBy: ator, grantedAt: em, ...(maximo === 0 ? { basis: 'manual' } : {}) };
}

/** `availableComplement`. */
function complementoDisponivel(fonte, consultas, pagamentos, excetoId) {
  const origem = fonte.coverage && fonte.coverage.kind === 'Complemento' ? consultas.find((i) => i.id === fonte.coverage.sourceConsultationId) : fonte;
  const parcialPreservado = Boolean(origem) && origem.bonusGrant && origem.bonusGrant.adjustment === 'partial' && origem.cancellationReview && origem.cancellationReview.readerStatus === 'Concluída' && consome(origem);
  if (!origem || (origem.status !== 'Concluída' && !parcialPreservado) || (origem.bonusGrant && origem.bonusGrant.minutes && origem.bonusGrant.adjustment !== 'partial')) return null;
  const acerto = cob.acerto(origem, pagamentos);
  const total = acerto.complementMinutes + acerto.creditCompletionMinutes;
  const filhas = consultas.filter((i) => i.id !== excetoId && i.coverage && i.coverage.kind === 'Complemento' && i.coverage.sourceConsultationId === origem.id && consome(i));
  const usado = filhas.reduce((s, i) => s + cob.usoDoComplemento(i), 0);
  const minutos = Math.max(0, total - usado);
  if (minutos <= 0) return null;
  const tarifa = origem.billing && origem.billing.tariff;
  let lotes = !origem.specialPrice && !(origem.billing && origem.billing.minimumWaived) && tarifa && tarifa.creditLots && tarifa.creditLots.length
    ? b.fatiarLotes(tarifa.creditLots, Math.max(0, acerto.actual - b.usoDosBeneficios(origem).reduce((s, x) => s + x.usedMinutes, 0)), total) : undefined;
  if (lotes) {
    for (const filha of filhas) {
      const reivindicado = cob.usoDoComplemento(filha);
      const lotesDaFilha = filha.billing && filha.billing.tariff && filha.billing.tariff.creditLots;
      if (!(lotesDaFilha && lotesDaFilha.length)) { lotes = b.fatiarLotes(lotes, reivindicado); continue; }
      for (const alocacao of b.alocarLotes(lotesDaFilha, reivindicado).allocations) {
        let remover = alocacao.usedMinutes;
        lotes = lotes.flatMap((lote) => {
          if (remover <= 0.0000001 || lote.paymentId !== alocacao.paymentId || lote.kind !== alocacao.kind || lote.unitValue !== alocacao.unitValue) return [lote];
          const consumido = Math.min(remover, lote.minutes); remover -= consumido;
          return b.fatiarLotes([lote], consumido);
        });
      }
    }
  }
  const precificados = (lotes && lotes.reduce((s, l) => s + l.minutes, 0)) || 0;
  const unitValue = precificados > 0 ? lotes.reduce((s, l) => s + l.minutes * l.unitValue, 0) / precificados : acerto.unitValue;
  return { sourceConsultationId: origem.id, minutes: minutos, unitValue, mode: origem.billing && origem.billing.minimumWaived ? 'credit' : 'prepaid', ...(lotes && lotes.length ? { creditLots: lotes } : {}) };
}

/** `validateMinuteBenefits`. */
function validarBeneficios(proxima, consultas, perfil) {
  const beneficios = proxima.minuteBenefits || [];
  if (!beneficios.length || !consome(proxima)) return;
  if (new Set(beneficios.map((i) => i.id)).size !== beneficios.length) erro('Este benefício foi selecionado duas vezes.');
  const disponiveis = b.beneficiosDisponiveis(proxima.clientId, perfil, consultas, proxima.id, proxima.updatedAt || proxima.startedAt);
  for (const beneficio of beneficios) {
    const g = disponiveis.find((i) => i.id === beneficio.id);
    if (g && b.usaOrigemDeBonusLegado(proxima, g)) erro('Este bônus já cobre a consulta. Selecione outra origem para os minutos adicionais.');
    const reivindicado = proxima.status === 'Em curso' ? beneficio.minutes : ((b.usoDosBeneficios(proxima).find((i) => i.id === beneficio.id) || {}).usedMinutes || 0);
    if (!g || g.kind !== beneficio.kind || g.clientId !== proxima.clientId || !Number.isSafeInteger(beneficio.minutes) || beneficio.minutes < 1 || reivindicado > g.remaining || Math.abs(g.unitValue - beneficio.unitValue) > 0.000001) erro('Os minutos de bônus ou cortesia mudaram. Confira a quantidade disponível.');
  }
}

/** `validateComplementChanges`. `consultas` inclui a versão guardada (`original`) da consulta. */
function validarComplemento(proxima, consultas, pagamentos) {
  const original = consultas.find((i) => i.id === proxima.id);
  const valor = (x) => cob.valorDoMinutoDaConsulta(x, pagamentos);
  const g0 = proxima.bonusGrant;
  if (g0 && g0.unitValue && Math.abs(g0.unitValue - valor(proxima)) > 0.000001) erro('Há bônus concedido. Preserve o valor do minuto da consulta de origem.');
  if (g0 && g0.adjustment && g0.minutes > cob.acerto(proxima, pagamentos).chargeable) erro('Preserve os minutos convertidos em bônus na consulta de origem.');
  if (g0 && g0.adjustment === 'partial' && ((proxima.status !== 'Concluída' && !(proxima.status === 'Cancelada' && proxima.cancellationReview) && !b.retemCoberturaDeCancelamento(proxima)) || g0.minutes >= cob.minutosRealizados(proxima))) erro('O abatimento deve preservar parte do tempo realizado na consulta.');
  const usosBonus = consultas.filter((i) => i.id !== proxima.id && i.coverage && i.coverage.kind === 'Bônus' && normalizado(i.coverage.sourceConsultationId) === normalizado(proxima.id) && consome(i));
  const usosModernos = consultas.filter((i) => i.id !== proxima.id && consome(i) && (i.minuteBenefits || []).some((x) => normalizado(x.sourceConsultationId) === normalizado(proxima.id)));
  const reivindicado = usosModernos.reduce((soma, i) => soma + (i.status === 'Em curso'
    ? i.minuteBenefits.filter((x) => normalizado(x.sourceConsultationId) === normalizado(proxima.id)).reduce((n, x) => n + x.minutes, 0)
    : b.usoDosBeneficios(i).filter((x) => normalizado(x.sourceConsultationId) === normalizado(proxima.id)).reduce((n, x) => n + x.usedMinutes, 0)), 0);
  if (usosModernos.length && (!b.ehOrigemDeBonus(proxima) || !g0 || reivindicado > g0.minutes || usosModernos.some((i) => i.clientId !== proxima.clientId) || usosBonus.length)) erro('Há minutos de bônus utilizados ou reservados. Preserve a origem, a cliente e os minutos concedidos.');
  if (reivindicado > 0 && usosModernos.some((i) => (i.minuteBenefits || []).some((x) => normalizado(x.sourceConsultationId) === normalizado(proxima.id) && Math.abs(x.unitValue - valor(proxima)) > 0.000001))) erro('Há bônus utilizado ou reservado. Preserve a tarifa da origem.');
  if (g0 || usosBonus.length) {
    const minutosConcedidos = (g0 && g0.minutes) || 0;
    if (!b.ehOrigemDeBonus(proxima) || !Number.isInteger(minutosConcedidos) || minutosConcedidos < 1 || usosBonus.length > 1 || usosBonus.some((i) => i.clientId !== proxima.clientId || i.coverage.minutes > minutosConcedidos)) {
      erro('Há bônus vinculado. Mantenha o cancelamento ou abatimento da origem, a mesma cliente e os minutos dentro do bônus concedido.');
    }
    const capacidadeAnterior = original ? capacidadeDoBonus(original, pagamentos) : 0;
    if (g0 && g0.basis === 'manual' && !(original && original.bonusGrant && original.bonusGrant.basis === 'manual') && capacidadeAnterior > 0) erro('Mantenha o bônus dentro dos minutos da consulta de origem.');
    const capacidadeNova = capacidadeDoBonus(proxima, pagamentos);
    const mudou = (original && original.bonusGrant && original.bonusGrant.minutes) !== (g0 && g0.minutes);
    if ((!original || mudou || capacidadeAnterior !== capacidadeNova) && minutosConcedidos > capacidadeNova) erro('O bônus não pode ser maior que os minutos da consulta de origem.');
  }
  if (proxima.coverage && proxima.coverage.kind === 'Bônus' && consome(proxima)) {
    const origem = consultas.find((i) => normalizado(i.id) === normalizado(proxima.coverage.sourceConsultationId));
    const outros = origem ? consultas.filter((i) => i.id !== proxima.id && i.coverage && i.coverage.kind === 'Bônus' && normalizado(i.coverage.sourceConsultationId) === normalizado(origem.id) && consome(i)) : [];
    const minutos = proxima.coverage.minutes;
    if (!origem || !b.ehOrigemDeBonus(origem) || origem.clientId !== proxima.clientId || !origem.bonusGrant || !Number.isInteger(minutos) || minutos < 1 || minutos > origem.bonusGrant.minutes || origem.bonusGrant.minutes > capacidadeDoBonus(origem, pagamentos) || outros.length
      || consultas.some((i) => i.id !== proxima.id && consome(i) && (i.minuteBenefits || []).some((x) => normalizado(x.sourceConsultationId) === normalizado(origem.id)))) {
      erro('Este bônus já foi utilizado ou sua consulta de origem mudou. Escolha novamente a origem.');
    }
  }
  const filhas = consultas.filter((i) => i.id !== proxima.id && i.coverage && i.coverage.kind === 'Complemento' && i.coverage.sourceConsultationId === proxima.id && consome(i));
  if (filhas.length) {
    const origemDoComplemento = consultas.find((i) => i.id === proxima.id);
    const antes = cob.acerto(origemDoComplemento, pagamentos); const depois = cob.acerto(proxima, pagamentos);
    const usado = filhas.reduce((s, i) => s + cob.usoDoComplemento(i), 0);
    const lotesDe = (x) => x.billing && x.billing.tariff && x.billing.tariff.creditLots;
    const lotesDaOrigemMudaram = filhas.some((f) => lotesDe(f) && lotesDe(f).length) && (antes.actual !== depois.actual || antes.chargeable !== depois.chargeable || JSON.stringify(lotesDe(origemDoComplemento)) !== JSON.stringify(lotesDe(proxima)));
    if (proxima.clientId !== origemDoComplemento.clientId || antes.unitValue !== depois.unitValue || lotesDaOrigemMudaram
      || filhas.some((f) => !(lotesDe(f) && lotesDe(f).length) && Math.abs((f.coverage.unitValue || f.minuteValue || 2.96) - depois.unitValue) > 0.000001)
      || Boolean(proxima.billing && proxima.billing.minimumWaived) !== Boolean(origemDoComplemento.billing && origemDoComplemento.billing.minimumWaived) || depois.complementMinutes + depois.creditCompletionMinutes < usado) {
      erro('Há complemento vinculado. Confira esse atendimento antes de alterar a origem.');
    }
  }
  if (proxima.coverage && proxima.coverage.kind === 'Complemento' && consome(proxima)) {
    const origem = consultas.find((i) => i.id === proxima.coverage.sourceConsultationId);
    const cobertura = proxima.coverage;
    const mantem = Boolean(origem) && origem.cancellationReview && origem.cancellationReview.readerStatus === 'Concluída' && (origem.status === 'Cancelada' || b.retemCoberturaDeCancelamento(origem))
      && Boolean(original) && consome(original) && original.clientId === proxima.clientId && original.coverage && original.coverage.kind === 'Complemento'
      && original.coverage.sourceConsultationId === cobertura.sourceConsultationId && original.coverage.minutes === cobertura.minutes && original.coverage.complementMode === cobertura.complementMode
      && original.coverage.unitValue === cobertura.unitValue && original.minuteValue === proxima.minuteValue
      && JSON.stringify(lotesDe2(original)) === JSON.stringify(lotesDe2(proxima));
    const disponivel = origem && (complementoDisponivel(origem, consultas, pagamentos, proxima.id) || (mantem ? complementoDisponivel({ ...origem, status: 'Concluída', bonusGrant: undefined }, consultas, pagamentos, proxima.id) : null));
    if (!disponivel || origem.clientId !== proxima.clientId || cobertura.minutes > disponivel.minutes || cobertura.complementMode !== disponivel.mode) erro('Os minutos deste complemento já foram utilizados ou a origem mudou. Abra Reabrir novamente.');
  }
}
const lotesDe2 = (x) => x.billing && x.billing.tariff && x.billing.tariff.creditLots;

/** `compensationMaximum`. */
function maximoDaCompensacao(item, pagamentos, parcial) {
  const financiado = capacidadeDoBonus(item, pagamentos);
  const cobravel = cob.acerto(item, pagamentos).chargeable;
  return parcial ? Math.max(0, Math.min(financiado || cobravel, cobravel, cob.minutosRealizados(item) - 1)) : Math.min(financiado || cobravel, cobravel);
}

module.exports = { minutosFinanciados, capacidadeDoBonus, concessaoDeBonus, complementoDisponivel, validarBeneficios, validarComplemento, maximoDaCompensacao };
