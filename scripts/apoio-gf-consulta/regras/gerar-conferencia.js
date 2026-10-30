'use strict';

/**
 * Ouro da CONFERÊNCIA DE ENCERRAMENTO (Maturacao/38), do código real do front: `approveReportedFinish`, `rejectFinishCorrection`,
 * `recordFinancialReviewDecision`, `withFinishReviewBenefits`, `finishReviewAssessment`. Os estados vêm das funções reais
 * (`reportTarologistFinish`, `requestFinishCorrection`) sobre as variantes de saldo de `fabrica.js`.
 */

const { variantesDaConferencia, ISO } = require('./fabrica');

const EM = ISO(0, 150);
const roda = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const resumoDaAvaliacao = (a) => ({ error: a.error, mustReview: a.mustReview, extra: a.extra, early: a.early, minutes: a.minutes });

async function gerar({ vite }) {
  const report = await vite.ssrLoadModule('/features/tarologas/tarologist-finish-report.ts');
  const fr = await vite.ssrLoadModule('/features/consultas/consultation-financial-review.ts');
  const assess = await vite.ssrLoadModule('/features/consultas/finish-review-assessment.ts');
  const ben = await vite.ssrLoadModule('/features/consultas/finish-review-benefit-model.ts');
  const cenarios = []; const casos = [];
  for (const v of variantesDaConferencia()) {
    const idx = cenarios.push({ nome: v.nome, consultas: v.consultas, pagamentos: v.pagamentos, perfil: v.perfil }) - 1;
    const k1 = v.consultas.find((c) => c.id === 'K1');
    const financa = (estado) => ({ payments: v.pagamentos, consultations: v.consultas.map((c) => (c.id === 'K1' ? estado : c)), profile: v.perfil });
    for (const minutos of [10, 25, 30, 38, 45, 75]) {
      const relatado = roda(() => report.reportTarologistFinish({ ...k1, awaitingTarologistStart: false }, minutos, 'osiris', 'Osíris', ISO(0, 90), false, minutos < 30 ? { reason: 'client_satisfied', note: '' } : undefined, { finance: financa(k1), timingConfirmed: true }));
      if (!relatado.ok) continue;
      const estados = [relatado.ok];
      for (const m2 of [8, 33, 90]) { const r = roda(() => report.requestFinishCorrection(relatado.ok, m2, 'Erro de digitação', 'osiris', 'Osíris', ISO(0, 120))); if (r.ok) estados.push(r.ok); }
      // Um encerramento já conferido (Concluída) também pede correção.
      const conferido = roda(() => report.approveReportedFinish(relatado.ok, relatado.ok.updatedAt, 'Laya', ISO(0, 130), financa(relatado.ok)));
      if (conferido.ok && conferido.ok.status === 'Concluída') { const r = roda(() => report.requestFinishCorrection(conferido.ok, 12, 'Ajuste', 'osiris', 'Osíris', ISO(0, 140))); if (r.ok) estados.push(r.ok); estados.push(conferido.ok); }
      for (const s of estados) {
        const fin = financa(s);
        const caso = (t, args, r) => casos.push({ t, c: idx, item: s, args, r });
        caso('aprovar', { versao: s.updatedAt, ator: 'Laya', em: EM }, roda(() => report.approveReportedFinish(s, s.updatedAt, 'Laya', EM, fin)));
        caso('aprovar', { versao: 'outra', ator: 'Laya', em: EM }, roda(() => report.approveReportedFinish(s, 'outra', 'Laya', EM, fin)));
        caso('fluxo-aprovar', { selecao: {}, ator: 'Laya', em: EM, versao: s.updatedAt }, roda(() => { const a = assess.finishReviewAssessment(s, fin, EM); if (a.error) throw new Error(a.error); return report.approveReportedFinish(s, s.updatedAt, 'Laya', EM, fin); }));
        caso('aprovar-sem-saldo', { versao: s.updatedAt, ator: 'Laya', em: EM }, roda(() => report.approveReportedFinish(s, s.updatedAt, 'Laya', EM, undefined)));
        for (const status of ['awaiting-contact', 'awaiting-payment', 'approved', 'not-charged']) {
          for (const nota of ['', 'Cliente confirmou.']) caso('decisao', { status, nota, versao: s.updatedAt, ator: 'Laya', em: EM }, roda(() => fr.recordFinancialReviewDecision(s, status, 'Laya', nota, EM, s.updatedAt, fin)));
        }
        caso('decisao', { status: 'approved', nota: 'x', versao: 'outra', ator: 'Laya', em: EM }, roda(() => fr.recordFinancialReviewDecision(s, 'approved', 'Laya', 'x', EM, 'outra', fin)));
        for (const motivo of ['Mantido o tempo anterior.', '  ']) caso('rejeitar', { versao: s.updatedAt, ator: 'Laya', motivo, em: EM }, roda(() => report.rejectFinishCorrection(s, s.updatedAt, 'Laya', motivo, EM)));
        caso('avaliacao', { em: EM }, roda(() => resumoDaAvaliacao(assess.finishReviewAssessment(s, fin, EM))));
        const opcoes = roda(() => ben.finishReviewBenefitOptions(s, fin, EM));
        for (const o of opcoes.ok || []) {
          for (const n of ['1', String(o.remaining), String(o.remaining + 1), '0', '1.5']) {
            const selecao = { [o.id]: n };
            caso('beneficios', { selecao, ator: 'Laya', em: EM }, roda(() => ben.withFinishReviewBenefits(s, selecao, fin, 'Laya', EM)));
            const candidato = roda(() => ben.withFinishReviewBenefits(s, selecao, fin, 'Laya', EM));
            // O fluxo da tela (`confirmReportedItem`): benefícios escolhidos, avaliação (erro bloqueia) e conferência.
            caso('fluxo-aprovar', { selecao, ator: 'Laya', em: EM, versao: s.updatedAt }, roda(() => { const cand = ben.withFinishReviewBenefits(s, selecao, fin, 'Laya', EM); const a = assess.finishReviewAssessment(cand, fin, EM); if (a.error) throw new Error(a.error); return report.approveReportedFinish(cand, s.updatedAt, 'Laya', EM, fin); }));
            if (candidato.ok) casos.push({ t: 'aprovar', c: idx, item: candidato.ok, args: { versao: candidato.ok.updatedAt, ator: 'Laya', em: EM, comBeneficios: true }, r: roda(() => report.approveReportedFinish(candidato.ok, candidato.ok.updatedAt, 'Laya', EM, financa(candidato.ok))) });
          }
        }
        caso('beneficios', { selecao: { PX: '5' }, ator: 'Laya', em: EM }, roda(() => ben.withFinishReviewBenefits(s, { PX: '5' }, fin, 'Laya', EM)));
      }
    }
  }
  return { cenarios, casos };
}

module.exports = { gerar, EM };
