'use strict';

/** Cenários do ouro do COMPONENTE da consulta (Maturacao/56 D3): semente fixa, valores fictícios. Reaproveita as variantes de saldo da fábrica das regras. */

const { semente, ISO, variantesDaConferencia, perfilVazio, consulta } = require('../regras/fabrica');

const clonar = (v) => JSON.parse(JSON.stringify(v));
const QUEIXAS = [
  { complaint: 'A cliente reclamou do atendimento.', complaintReasons: ['Não bateu'], shareComplaint: true },
  { complaint: '', complaintReasons: ['Demora/lentidão', 'Outros'], shareComplaint: false },
  { complaint: '', complaintReasons: [], shareComplaint: false },
  { complaint: 'x', complaintReasons: ['Motivo inventado'], shareComplaint: false },
];
const HORA_SP = (iso) => new Date(Date.parse(iso) - 3 * 3600000).toISOString().slice(11, 16);

function cenarios() {
  const r = semente(5600); const pick = (xs) => xs[Math.floor(r() * xs.length)]; const chance = (p) => r() < p;
  const bases = variantesDaConferencia(); const casos = [];
  const EM = ISO(0, 120);
  // ---- finishConsultation
  for (let n = 0; n < 900; n += 1) {
    const base = bases[n % bases.length]; const consultas = clonar(base.consultas); const alvo = consultas.find((c) => c.id === 'K1');
    const revisao = chance(0.3);
    if (revisao) {
      alvo.status = chance(0.7) ? 'Finalizada pelo tarólogo' : 'Em curso'; alvo.tarologistFinishReport = { submittedAt: ISO(0, 40), minutes: pick([20, 25, 31]), reporterName: 'Leitora', endedAt: ISO(0, 40) };
      if (alvo.status !== 'Em curso') { alvo.endedAt = ISO(0, 40); alvo.durationSeconds = 1200; }
      if (chance(0.15)) alvo.finishCorrections = [{ status: 'pending', minutes: 12, beforeMinutes: 20, reason: 'x' }];
      if (chance(0.1)) alvo.finishReview = { at: ISO(0, 50) };
    }
    if (chance(0.15)) alvo.pauseHistory = [{ id: 'p1', startedAt: ISO(0, 10), startedBy: 'x', reason: 'x', ...(chance(0.7) ? { endedAt: ISO(0, 15) } : {}) }];
    if (chance(0.1)) alvo.tarologistMoreTimeRequest = { active: true, requestedAt: ISO(0, 30), reporterName: 'Leitora' };
    if (chance(0.08)) alvo.expectedMinutes = undefined, alvo.timeLimit = undefined;
    if (chance(0.1)) alvo.timeLimit = { kind: 'minimum', minutes: 15 };
    alvo.updatedAt = ISO(0, 5);
    const desfecho = pick(['Concluída', 'Concluída', 'Cancelada', 'Devolvida', 'Não houve']);
    const mesmaHora = chance(0.8); const queixa = pick(QUEIXAS);
    const estado = {
      finishOutcome: desfecho, finishMinutes: pick(['10', '30', '31', '45', '29,5', '15', '0', 'abc', '-5', '', '1', '12,5', '90']),
      finishStartTime: mesmaHora ? HORA_SP(alvo.startedAt) : pick(['09:00', '12:50', '25:00', '', '23:30', '05:59', '06:00']),
      finishComplaint: desfecho === 'Cancelada' ? queixa.complaint : '', finishComplaintDetails: desfecho === 'Cancelada' ? { shareComplaint: queixa.shareComplaint, complaintReasons: queixa.complaintReasons } : { complaint: '' },
      finishBonusEnabled: desfecho === 'Cancelada' && chance(0.4), finishBonusMinutes: pick(['5', '10', '60', '0', 'x']),
      finishReviewReason: revisao ? pick(['', ' Ajuste do tempo ', 'x']) : '', finishOpenedAsReview: revisao || chance(0.04), finishReviewVersion: chance(0.9) ? alvo.updatedAt : 'velha',
      finishBenefitSelection: {}, finishReturnToLaunch: chance(0.1),
    };
    casos.push({ tipo: 'finalizar', nome: `${base.nome}#${n}`, alvoId: 'K1', consultas, pagamentos: clonar(base.pagamentos), perfil: base.perfil, agenda: [], papel: pick(['atendente', 'administradora']), ator: chance(0.07) ? ' ' : 'Khloe', agora: EM, estado });
  }
  // ---- confirmAnnul
  for (let n = 0; n < 400; n += 1) {
    const base = bases[n % bases.length]; const consultas = clonar(base.consultas); const alvo = consultas.find((c) => c.id === 'K1');
    alvo.status = pick(['Concluída', 'Concluída', 'Cancelada', 'Em curso', 'Devolvida']); if (alvo.status !== 'Em curso') { alvo.endedAt = ISO(0, 40); alvo.durationSeconds = 1200; }
    if (chance(0.35)) alvo.cancellationReview = { status: pick(['pending', 'pending', 'approved']), requestedBy: 'Khloe', requestedAt: ISO(0, 41), complaint: 'Reclamou.', complaintDetails: QUEIXAS[0] };
    alvo.updatedAt = ISO(0, 5);
    if (chance(0.3)) alvo.audit = [{ id: 'a0', action: 'Dados corrigidos', detail: 'x', actor: 'Khloe', createdAt: ISO(0, 2) }];
    const agenda = chance(0.6) ? [{ id: 'ag1', clientId: alvo.clientId, client: 'Cliente Teste', tarotId: alvo.tarotId, date: '2026-10-10', time: '13:00', createdAt: ISO(0, -60), channel: 'Telefone', observation: '', response: 'Aguardando resposta', position: 1, resolvedByConsultationId: 'K1', resolvedAt: ISO(0, 41), contact: { attempt: 1, date: '2026-10-10', tags: ['Concluída'] }, contactHistory: [] }] : [];
    const q = pick(QUEIXAS);
    casos.push({ tipo: 'anular', nome: `${base.nome}#${n}`, alvoId: 'K1', consultas, pagamentos: clonar(base.pagamentos), perfil: base.perfil, agenda, papel: chance(0.85) ? 'administradora' : 'atendente', ator: chance(0.07) ? ' ' : 'Laya', agora: EM,
      estado: { annulReason: pick(['', 'Motivo da anulação.', '  ', 'm'.repeat(2100)]), annulComplaintDetails: q, annulVersion: chance(0.85) ? alvo.updatedAt : 'velha', annulTargetPresente: chance(0.96) } });
  }
  return casos;
}

module.exports = { cenarios, clonar, perfilVazio, consulta };
