'use strict';

/**
 * Ouro dos DESFECHOS (Maturacao/38), do código real do front: `requestCancellationReview`, `decideCancellationReview`,
 * `decideCancellationInConsultations` (com `withConsultationComplaint`), `withConsultationComplaint`, `validateConsultationErrorInput`,
 * `validateComplaint`. Quem pode (papéis), estados, frases de recusa. A compensação está em `gerar-vinculos.js`.
 * Anular e erro (`confirmAnnul`, `confirmError`) não têm função pura no front: ficam testados à mão.
 */

const { gerarCenarios } = require('../../apoio-gf-financeiro/cenarios');
const { semente, ISO } = require('./fabrica');

const roda = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const PAPEIS = ['atendente', 'administradora', 'supervisora', 'assistente', 'tarologa'];
const QUEIXAS = [
  { complaint: 'A cliente reclamou do atendimento.', complaintReasons: ['Não bateu'], shareComplaint: true },
  { complaint: '', complaintReasons: ['Demora/lentidão', 'Outros'], shareComplaint: false },
  { complaint: '', complaintReasons: [], shareComplaint: false },
  { complaint: 'x', complaintReasons: ['Motivo inventado'], shareComplaint: false },
  { complaint: 'y'.repeat(4001), complaintReasons: [], shareComplaint: false },
  { complaint: '  texto com espaços  ', complaintReasons: ['Não bateu', 'Não bateu'], shareComplaint: true },
];

async function gerar({ vite }) {
  const rev = await vite.ssrLoadModule('/features/domain/consultation-cancellation-review.ts');
  const dec = await vite.ssrLoadModule('/features/consultas/cancellation-review-decision.ts');
  const quei = await vite.ssrLoadModule('/features/domain/consultation-complaint.ts');
  const inp = await vite.ssrLoadModule('/features/consultas/consultation-input.ts');
  const bases = gerarCenarios().filter((c) => c.tipo === 'tarifa' && c.perfil && c.consultas.length).slice(0, 70);
  const cenarios = []; const casos = []; const EM = ISO(0, 200);
  bases.forEach((b, n) => {
    const r = semente(9000 + n); const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const idx = cenarios.push({ consultas: b.consultas, pagamentos: b.pagamentos, perfil: b.perfil }) - 1;
    for (const item of b.consultas) {
      const papeis = ['atendente', 'administradora', pick(PAPEIS)];
      for (const papel of papeis) {
        const q = pick(QUEIXAS);
        casos.push({ t: 'solicitar', c: idx, item, papel, queixa: q.complaint, detalhes: q, ator: pick(['Laya', ' ']), r: roda(() => rev.requestCancellationReview(item, q.complaint, pick(['Laya']) , EM, papel, q)) });
      }
      // Estado pendente real, depois decisões.
      const pendente = roda(() => rev.requestCancellationReview(item, 'Reclamou.', 'Khloe', ISO(0, 190), 'atendente', QUEIXAS[0]));
      for (const base of pendente.ok ? [pendente.ok, item] : [item]) {
        for (const papel of ['administradora', 'atendente']) {
          for (const decisao of ['paid', 'unpaid', 'x']) {
            const motivo = pick(['', 'Motivo da decisão.', 'z'.repeat(4001)]); const msg = pick([undefined, 'Aviso ao tarólogo.', 'm'.repeat(601), '  ']);
            casos.push({ t: 'decidir', c: idx, item: base, papel, decisao, motivo, msg, r: roda(() => rev.decideCancellationReview(base, decisao, motivo, 'Laya', EM, papel, msg)) });
          }
        }
        const lista = b.consultas.map((c) => (c.id === base.id ? base : c));
        for (const [versao, detalhes] of [[base.updatedAt, undefined], ['velha', undefined], [base.updatedAt, QUEIXAS[0]], [base.updatedAt, QUEIXAS[3]]]) {
          for (const papel of ['administradora', 'atendente']) {
            casos.push({ t: 'decidir-lista', c: idx, item: base, papel, versao, detalhes, r: roda(() => dec.decideCancellationInConsultations(lista, { id: base.id, updatedAt: versao }, { decision: 'unpaid', observation: 'Ok', actor: 'Laya', at: EM, role: papel, complaintDetails: detalhes }, b.pagamentos).find((x) => x.id === base.id)) });
          }
        }
        casos.push({ t: 'queixa', c: idx, item: base, papel: 'administradora', detalhes: QUEIXAS[1], r: roda(() => quei.withConsultationComplaint(base, QUEIXAS[1], 'Laya', EM, 'administradora')) });
        casos.push({ t: 'queixa', c: idx, item: base, papel: 'atendente', detalhes: QUEIXAS[0], r: roda(() => quei.withConsultationComplaint(base, QUEIXAS[0], 'Laya', EM, 'atendente')) });
      }
    }
  });
  const erros = [];
  for (const motivo of ['ID errado', 'Não teve', 'Duplicada', 'Outro', 'Qualquer', '', undefined, 5]) for (const detalhe of ['', 'Detalhe', '  ', 'd'.repeat(4001), undefined, 'linha\nquebrada', 'a\u0001b']) erros.push({ t: 'erro-entrada', motivo, detalhe, r: roda(() => inp.validateConsultationErrorInput(motivo, detalhe)) });
  for (const q of QUEIXAS) for (const obrig of [false, true]) erros.push({ t: 'validar-queixa', q, obrig, r: roda(() => quei.validateComplaint(q, obrig)) });
  casos.push(...erros.map((e) => ({ ...e, c: 0, item: null })));
  return { cenarios, casos };
}

module.exports = { gerar };
