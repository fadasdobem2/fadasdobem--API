'use strict';

/**
 * Ouro dos VÍNCULOS de bônus, cortesia e complemento (Maturacao/38), do código real do front: `validateMinuteBenefits` e
 * `validateComplementChanges`. Base: os cenários sorteados do ouro financeiro, ENRIQUECIDOS com origem de bônus, usos do bônus
 * (cobertura e benefício moderno), complemento e cortesia; cada consulta sofre mutações sorteadas (semente fixa) e as duas funções reais
 * dizem aceitar ou a frase de recusa. Também a compensação: `compensationMaximum`, `compensationGrant`, `prepareConsultationCompensation`.
 */

const { gerarCenarios } = require('../../apoio-gf-financeiro/cenarios');
const { semente, ISO } = require('./fabrica');

const roda = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const STATUS = ['Concluída', 'Cancelada', 'Em curso', 'Devolvida', 'Anulada', 'Finalizada pelo tarólogo', 'Desistiu', 'Não houve', 'Erro'];

function enriquecer(base, r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const consultas = JSON.parse(JSON.stringify(base.consultas));
  const alvos = consultas.filter((c) => ['Cancelada', 'Concluída'].includes(c.status));
  const origem = alvos.length ? pick(alvos) : null;
  if (origem) {
    const parcial = origem.status === 'Concluída' && r() < 0.5;
    origem.bonusGrant = { minutes: pick([5, 10, 15, 20]), unitValue: pick([2.96, 2.96, 3.1]), adjustment: parcial ? 'partial' : pick(['cancellation', 'cancellation', undefined]), reason: parcial ? 'Abatimento na consulta anterior' : 'Consulta anterior cancelada', grantedBy: 'Laya', grantedAt: ISO(-1), ...(r() < 0.15 ? { basis: 'manual' } : {}) };
    if (origem.status === 'Cancelada' && r() < 0.7) origem.cancellationReview = { status: pick(['paid', 'unpaid', 'pending']), readerStatus: 'Concluída', complaint: 'x', complaintReasons: [], shareComplaint: false };
    const outras = consultas.filter((c) => c.id !== origem.id);
    const filha = outras.length ? pick(outras) : null;
    if (filha) {
      if (r() < 0.5) filha.coverage = { kind: 'Bônus', minutes: pick([3, 5, 10, 15, 25]), sourceConsultationId: pick([origem.id, origem.id, `C-${origem.id}`, 'XX']), registeredBy: 'K', registeredAt: filha.startedAt };
      else { filha.minuteBenefits = [{ id: `cancellation:${origem.id}`, clientId: origem.clientId, kind: 'Bônus', minutes: pick([3, 5, 10, 20]), unitValue: pick([2.96, 3.1]), reason: 'x', grantedBy: 'Laya', grantedAt: ISO(-1), sourceConsultationId: origem.id, payTarologist: true }]; filha.paidMinutesBeforeBenefits = pick([0, 10, 15]); }
    }
    const resto = outras.filter((c) => !filha || c.id !== filha.id);
    const complemento = resto.length ? pick(resto) : null;
    if (complemento && r() < 0.6) complemento.coverage = { kind: 'Complemento', minutes: pick([2, 5, 10]), sourceConsultationId: pick([origem.id, origem.id, 'XX']), complementMode: pick(['prepaid', 'credit']), unitValue: pick([2.96, 3]), registeredBy: 'K', registeredAt: complemento.startedAt };
  }
  return { ...base, consultas };
}

function mutar(item, base, r) {
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const x = JSON.parse(JSON.stringify(item));
  const n = 1 + Math.floor(r() * 2);
  for (let i = 0; i < n; i += 1) {
    switch (pick(['dur', 'dur', 'status', 'cliente', 'grant', 'grant', 'cov', 'cov', 'ben', 'ben', 'min', 'lotes', 'review', 'preco', 'nada'])) {
      case 'dur': x.durationSeconds = pick([0, 300, 600, 900, 1500, 2400, 3600]); break;
      case 'status': x.status = pick(STATUS); break;
      case 'cliente': x.clientId = '900200'; break;
      case 'grant':
        if (!x.bonusGrant || r() < 0.3) x.bonusGrant = { minutes: pick([1, 5, 10, 15, 40]), unitValue: pick([2.96, 3.1]), adjustment: pick([undefined, 'cancellation', 'partial']), reason: 'Consulta anterior cancelada', grantedBy: 'Laya', grantedAt: ISO(-1), ...(r() < 0.2 ? { basis: 'manual' } : {}) };
        else { const g = x.bonusGrant; const o = pick(['min+', 'min-', 'val', 'adj', 'del', 'manual']); if (o === 'min+') g.minutes += pick([1, 5, 30]); else if (o === 'min-') g.minutes = Math.max(0, g.minutes - pick([1, 5])); else if (o === 'val') g.unitValue = (g.unitValue || 2.96) * 1.5; else if (o === 'adj') g.adjustment = pick([undefined, 'partial', 'cancellation']); else if (o === 'del') delete x.bonusGrant; else g.basis = 'manual'; }
        break;
      case 'cov': {
        const o = pick(['bonus', 'comp', 'min', 'src', 'del', 'cred']);
        const outras = base.consultas.filter((c) => c.id !== x.id);
        if (o === 'bonus') x.coverage = { kind: 'Bônus', minutes: pick([1, 5, 10, 30]), sourceConsultationId: outras.length ? pick(outras).id : 'XX', registeredBy: 'K', registeredAt: x.startedAt };
        else if (o === 'comp') x.coverage = { kind: 'Complemento', minutes: pick([2, 5, 10, 30]), sourceConsultationId: outras.length ? pick(outras).id : 'XX', complementMode: pick(['prepaid', 'credit']), unitValue: pick([2.96, 3]), registeredBy: 'K', registeredAt: x.startedAt };
        else if (o === 'cred') x.coverage = { kind: 'Crédito', minutes: pick([10, 30]), registeredBy: 'K', registeredAt: x.startedAt };
        else if (!x.coverage) break;
        else if (o === 'min') x.coverage.minutes = pick([0, 1, 5, 20, 99]);
        else if (o === 'src') x.coverage.sourceConsultationId = outras.length ? pick(outras).id : 'XX';
        else delete x.coverage;
        break;
      }
      case 'ben':
        if (!x.minuteBenefits || r() < 0.3) { const g = base.perfil.minuteBenefits && base.perfil.minuteBenefits[0]; const o = base.consultas.find((c) => c.bonusGrant); x.minuteBenefits = [g ? { ...g, minutes: pick([1, 5, 15, 40]) } : { id: o ? `cancellation:${o.id}` : 'B?', clientId: x.clientId, kind: pick(['Bônus', 'Cortesia']), minutes: pick([1, 5, 10]), unitValue: 2.96, reason: 'x', grantedBy: 'L', grantedAt: ISO(-1), sourceConsultationId: o && o.id }]; x.paidMinutesBeforeBenefits = pick([0, 10]); }
        else { const b = x.minuteBenefits[0]; const o = pick(['dup', 'min', 'val', 'kind', 'del']); if (o === 'dup') x.minuteBenefits.push({ ...b }); else if (o === 'min') b.minutes = pick([0, 1, 10, 50]); else if (o === 'val') b.unitValue += 0.5; else if (o === 'kind') b.kind = b.kind === 'Bônus' ? 'Cortesia' : 'Bônus'; else delete x.minuteBenefits; }
        break;
      case 'min': x.billing = { ...(x.billing || {}), minimumWaived: !(x.billing && x.billing.minimumWaived) }; break;
      case 'lotes': if (x.billing && x.billing.tariff) x.billing.tariff = { ...x.billing.tariff, creditLots: [{ kind: 'purchase', paymentId: 'PX', cents: pick([8880, 4000]), minutes: pick([30, 20]), unitValue: 2.96, minutesKnown: true, purchaseMinutes: 30, purchaseAmount: 88.8 }] }; break;
      case 'review': x.cancellationReview = r() < 0.5 ? { status: pick(['paid', 'unpaid']), readerStatus: pick(['Concluída', 'Cancelada']) } : undefined; break;
      case 'preco': x.specialPrice = r() < 0.5 ? { unitValue: pick([2, 0, 3.5]) } : undefined; break;
      default: break;
    }
  }
  return x;
}

async function gerar({ vite }) {
  const ben = await vite.ssrLoadModule('/features/domain/client-minute-benefits.ts');
  const bil = await vite.ssrLoadModule('/features/domain/consultation-billing.ts');
  const comp = await vite.ssrLoadModule('/features/domain/consultation-compensation.ts');
  const bases = gerarCenarios().filter((c) => c.tipo === 'tarifa' && c.perfil && c.consultas.length);
  const cenarios = []; const casos = [];
  bases.forEach((b0, n) => {
    const r = semente(7000 + n);
    const base = enriquecer({ consultas: b0.consultas, pagamentos: b0.pagamentos, perfil: b0.perfil }, r);
    const idx = cenarios.push(base) - 1;
    for (const item of base.consultas) {
      const variantes = [item, ...Array.from({ length: 5 }, () => mutar(item, base, r))];
      for (const next of variantes) {
        const lista = base.consultas.map((c) => (c.id === item.id ? item : c));
        casos.push({ t: 'vinculos', c: idx, item: next, orig: item.id, beneficios: roda(() => ben.validateMinuteBenefits(next, lista, base.perfil)), complemento: roda(() => bil.validateComplementChanges(next, lista, base.pagamentos)) });
      }
      // Compensação: máximo e concessão sobre cada consulta.
      for (const parcial of [false, true]) casos.push({ t: 'maximo', c: idx, item, parcial, r: roda(() => comp.compensationMaximum(item, base.pagamentos, parcial)) });
      for (const [motivo, minutos] of [['Consulta anterior cancelada', 1], ['Consulta anterior cancelada', 10], ['Abatimento na consulta anterior', 5], ['Outro', 3], ['Consulta anterior cancelada', 0]]) {
        casos.push({ t: 'concessao', c: idx, item, minutos, motivo, r: roda(() => comp.compensationGrant(item, base.pagamentos, minutos, motivo, 'Laya', ISO(0, 200))) });
        const lista = base.consultas;
        casos.push({ t: 'compensacao', c: idx, item, minutos, motivo, queixa: 'A cliente reclamou.', r: roda(() => { const x = comp.prepareConsultationCompensation({ clientId: item.clientId, sourceId: item.id, minutes: minutos, reason: motivo, complaint: 'A cliente reclamou.' }, lista, base.pagamentos, 'Laya', ISO(0, 200), 'atendente'); return { next: x.next, benefit: x.benefit }; }) });
      }
    }
  });
  return { cenarios, casos };
}

module.exports = { gerar };
