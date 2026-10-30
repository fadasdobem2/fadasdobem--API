'use strict';

/**
 * Ouro da COBRANÇA DA EDIÇÃO (Maturacao/38), do código real do front: `resolveConsultationTariff`, `priceNewConsultation`, `repriceChangedComplement`
 * (consultation-pricing.ts), `maximumAtRecordedStart` (consultation-maximum-minutes.ts), `billingForConsultation` e `consultationUnitValue`
 * (consultation-billing.ts). A composição de `saveForm` (linhas 1527 a 1553 de consultations-experience.tsx) é transcrita aqui com essas funções REAIS.
 * Base: cenários sorteados do ouro financeiro, com tabela de preços padrão e uma versão agendada.
 */

const { gerarCenarios } = require('../../apoio-gf-financeiro/cenarios');
const { semente, ISO } = require('./fabrica');

const roda = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const HISTORICOS = [[], [{ id: 'VAL-X1', createdAt: '2026-10-01T10:00:00.000Z', createdBy: 'Laya', effectiveAt: '2026-10-05T00:00:00.000Z', changedFields: ['regularMinuteValue'], regularMinuteValue: 3.4 }]];

async function gerar({ vite }) {
  const pricing = await vite.ssrLoadModule('/features/domain/consultation-pricing.ts');
  const bil = await vite.ssrLoadModule('/features/domain/consultation-billing.ts');
  const maxi = await vite.ssrLoadModule('/features/domain/consultation-maximum-minutes.ts');
  const bases = gerarCenarios().filter((c) => c.tipo === 'tarifa' && c.perfil && c.consultas.length);
  const cenarios = []; const casos = [];
  bases.filter((_, i) => i % 2 === 0).forEach((b0, n) => {
    const r = semente(15000 + n); const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const idx = cenarios.push({ consultas: b0.consultas, pagamentos: b0.pagamentos, perfil: b0.perfil, vazio: { ...b0.perfil, clientId: '900200', credit: 0, minuteBenefits: undefined, openingCredit: undefined } }) - 1;
    const itens = b0.consultas.slice(0, 2);
    for (const item of itens) {
      const outras = b0.consultas.filter((x) => x.id !== item.id);
      const outra = outras.length ? pick(outras) : null;
      const h = pick([0, 1]);
      const ctx = (consultas = b0.consultas) => ({ consultations: consultas, profiles: { [item.clientId]: b0.perfil, '900200': cenarios[idx].vazio }, history: HISTORICOS[h] });
      const coberturas = [undefined, { kind: 'Crédito', minutes: 20 }, { kind: 'Crédito', minutes: 10, unitValue: 3 }, ...(outra ? [{ kind: 'Bônus', minutes: 5, sourceConsultationId: outra.id }, { kind: 'Complemento', minutes: 5, complementMode: 'prepaid', sourceConsultationId: outra.id }, { kind: 'Complemento', minutes: 5, complementMode: 'credit', sourceConsultationId: outra.id, unitValue: 2.96 }] : [])];
      for (const cobertura of coberturas) {
        for (const existente of [true, false]) {
          const repreco = r() < 0.4;
          const req = { clientId: item.clientId, at: item.startedAt, consultationId: existente ? item.id : 'NOVA', expectedMinutes: pick([undefined, 15, 30, 22]), coverage: cobertura, existing: existente ? item : undefined, payments: b0.pagamentos, repriceContract: repreco };
          casos.push({ t: 'tarifa', c: idx, h, req, r: roda(() => pricing.resolveConsultationTariff(req, ctx())) });
        }
        const sem = { ...item, coverage: cobertura, billing: { ...item.billing, tariff: undefined } };
        casos.push({ t: 'nova', c: idx, h, item: sem, r: roda(() => pricing.priceNewConsultation(sem, ctx(), b0.pagamentos)) });
        const depois = { ...item, coverage: cobertura };
        casos.push({ t: 'complemento', c: idx, h, anterior: item, item: depois, r: roda(() => pricing.repriceChangedComplement(depois, item, ctx(), b0.pagamentos)) });
        for (const clienteTrocado of [pick([false, true])]) {
          const pedidoBase = { ...item, coverage: cobertura, clientId: clienteTrocado ? '900200' : item.clientId, updatedAt: ISO(2) };
          for (const [contratoMudou, dispensa] of [[r() < 0.5, r() < 0.5], [r() < 0.5, r() < 0.5]]) {
            const ator = 'Laya'; const agora = ISO(2);
            casos.push({ t: 'cobranca', c: idx, h, antes: item, pedidoBase, contratoMudou, dispensa, r: roda(() => {
              const linked = b0.pagamentos; const trocou = pedidoBase.clientId !== item.clientId; const c0 = ctx();
              let upd = { ...pedidoBase, billing: item.billing, minuteValue: item.minuteValue };
              if (trocou) { upd.billing = undefined; Object.assign(upd, pricing.priceNewConsultation(upd, c0, linked)); } else Object.assign(upd, pricing.repriceChangedComplement(upd, item, c0, linked));
              const minutos = Math.ceil(pedidoBase.durationSeconds / 60);
              upd.billing = bil.billingForConsultation(upd, linked, dispensa && minutos < (item.billing?.minimumMinutes ?? 15) && (!cobertura || cobertura.kind === 'Crédito'), ator, agora);
              if (contratoMudou && !cobertura) { upd.billing.tariff = pricing.resolveConsultationTariff({ clientId: pedidoBase.clientId, at: pedidoBase.startedAt, consultationId: pedidoBase.id, expectedMinutes: pedidoBase.expectedMinutes || undefined, coverage: undefined, existing: trocou ? undefined : item, payments: linked, repriceContract: true }, c0); upd.billing.unitValueOverride = undefined; }
              upd.billing.keepUnusedCashCredit = upd.status === 'Desistiu' && dispensa;
              upd.minuteValue = bil.consultationUnitValue(upd, linked);
              const saida = { billing: upd.billing, minuteValue: upd.minuteValue };
              if (trocou) { const m = maxi.maximumAtRecordedStart(upd, c0.consultations, linked, c0.profiles); saida.maximumMinutesAtStart = m.minutes; saida.maximumIncludesPendingAtStart = m.includesPending; }
              return saida;
            }) });
          }
        }
      }
    }
    // Máximo no início gravado por cliente trocada.
    casos.push({ t: 'maximo', c: idx, r: roda(() => { const m = maxi.consultationMaximumsMap(b0.consultas, b0.pagamentos, { [b0.perfil.clientId]: b0.perfil }); return Object.fromEntries([...m.entries()]); }) });
  });
  return { cenarios, casos };
}

module.exports = { gerar, HISTORICOS };
