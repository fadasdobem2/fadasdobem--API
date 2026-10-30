'use strict';

/**
 * Ouro da RECONCILIAÇÃO DE DATAS DE MIGRAÇÃO (Maturacao/42, item 2): `correctMissingPaymentDates` REAL do front
 * (`consultation-payment-reconciliation-model.ts`) sobre pagamentos sem data de pagamento e/ou de lançamento, por papel e com entradas boas e ruins.
 * A revisão esperada (`reconciliationRevision`) vem do próprio front (a concorrência do servidor é o `expectedVersion`).
 */

const { AGORA, CLIENTE, semente, dia, tentar, limpar, BASES, criarBase } = require('./fabrica');

function gerar(fr, quantos = 260) {
  const cenarios = [];
  const M = fr.reconciliacao;
  for (let n = 0; n < quantos; n += 1) {
    const r = semente(31000 + n);
    const pick = (xs) => xs[Math.floor(r() * xs.length)];
    let p = criarBase(fr, pick(BASES), CLIENTE, `PG-${n}`, dia(2));
    const faltaPaga = r() < 0.6; const faltaLanc = r() < 0.5;
    if (faltaPaga) { const { paidAt: _a, ...resto } = p; p = resto; if (r() < 0.3) p = { ...p, paidAt: 'sem data' }; }
    if (faltaLanc) { const { informedAt: _b, ...resto } = p; p = { ...resto, audit: (p.audit || []).map((e) => ({ ...e, createdAt: r() < 0.5 ? 'x' : e.createdAt })) }; if (r() < 0.5) p = { ...p, audit: [] }; }
    const estado = { payments: [p], consultations: [] };
    const revisao = M.reconciliationRevision(estado, CLIENTE);
    const guiado = r() < 0.7;
    const entrada = { id: p.id, evidence: guiado ? 'Extrato do banco.' : pick(['Extrato do banco.', '', 'x'.repeat(4001)]) };
    if (guiado) {
      if (faltaPaga) entrada.paidAt = pick(['2026-10-20', '2026-10-20T10:00:00-03:00']);
      if (faltaLanc) entrada.informedAt = pick(['2026-10-20T10:00:00-03:00', '2026-10-20T10:00:00Z']);
      if (!entrada.paidAt && !entrada.informedAt && r() < 0.5) entrada.paidAt = '2026-10-20';
    } else {
      if (r() < 0.75) entrada.paidAt = pick(['2026-10-20', '2026-10-20T10:00:00-03:00', '2026-02-30', 'x', '2026-10-20T10:00']);
      if (r() < 0.6) entrada.informedAt = pick(['2026-10-20T10:00:00-03:00', '2026-10-20', '2026-13-01T10:00:00-03:00', '2026-10-20T10:00:00Z']);
    }
    if (entrada.paidAt && r() < 0.5) { entrada.paidPrecision = pick(['date', 'datetime']); entrada.paidDisplayDate = pick(['2026-10-20', '20/10/2026']); }
    if (entrada.informedAt && r() < 0.5) entrada.registeredDisplayDate = '2026-10-20T10:00';
    if (r() < 0.04) entrada.id = 'PG-nada';
    const papel = r() < 0.93 ? pick(['administradora', 'assistente']) : pick(['supervisora', 'atendente', 'tarologa']);
    const ator = pick(['Clara', 'Clara', 'Clara', 'Clara', 'Clara', 'Clara', 'Clara', '']); const em = pick([AGORA, AGORA, AGORA, AGORA, AGORA, AGORA, AGORA, 'x']);
    const res = tentar(() => M.correctMissingPaymentDates(estado, entrada, revisao, papel, ator, em));
    cenarios.push({ tipo: 'datas', estado: limpar(estado), entrada: limpar(entrada), papel, ator, em, esperado: res.ok ? { ok: limpar(res.ok.payments) } : { erro: res.erro } });
  }
  return cenarios;
}

module.exports = { gerar };
