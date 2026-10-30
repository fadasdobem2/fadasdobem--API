'use strict';

/**
 * Ouro da AUTORIZAÇÃO da supervisora no lançamento (Maturacao/38), do código real do front: `clientFinancialLaunchError` (e, por dentro,
 * `financialGuidanceApprovalAvailable`). Combinações sorteadas (semente fixa) de orientação (sem, sem exigência, exige sem autorização, com
 * autorização e linha de base) e consultas da cliente e de outra cliente (situação, fim antes ou depois da decisão, dentro ou fora da base).
 */

const { semente, ISO } = require('./fabrica');

const roda = (fn) => { try { const v = fn(); return { ok: v === undefined ? null : v }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
const STATUS = ['Em curso', 'Concluída', 'Cancelada', 'Devolvida', 'Não houve', 'Finalizada pelo tarólogo', 'Anulada', 'Erro', 'Desistiu'];

async function gerar({ vite }) {
  const modelo = await vite.ssrLoadModule('/features/clientes/client-financial-guidance-model.ts');
  const casos = []; const cenarios = [];
  for (let n = 0; n < 900; n += 1) {
    const r = semente(11000 + n); const pick = (xs) => xs[Math.floor(r() * xs.length)];
    const consultas = Array.from({ length: Math.floor(r() * 6) }, (_, i) => {
      const status = pick(STATUS); const quando = pick([-3, -1, 0, 1, 2]);
      return { id: `K${i}`, clientId: pick(['900100', '900100', '900100', '900200']), status, startedAt: ISO(quando), ...(status === 'Em curso' || r() < 0.1 ? {} : { endedAt: pick([ISO(quando, 20), 'invalido', ISO(quando, 400)]) }) };
    });
    const aprovacaoEm = ISO(pick([-2, 0, 1]), 30);
    const baseline = consultas.filter(() => r() < 0.4).map((c) => c.id);
    const g = pick(['nenhuma', 'sem-exigencia', 'exige', 'exige', 'autorizada', 'autorizada', 'autorizada-vazia']);
    const base = { revision: 1, active: true, pendingReview: false, reason: 'x', at: aprovacaoEm, by: 'Clara', history: [] };
    const orientacao = g === 'nenhuma' ? undefined : g === 'sem-exigencia' ? { ...base, requiresApproval: false } : g === 'exige' ? { ...base, requiresApproval: true }
      : { ...base, requiresApproval: true, approval: { id: 'A1', at: aprovacaoEm, by: 'Clara', baselineConsultationIds: g === 'autorizada-vazia' ? [] : baseline } };
    const idx = cenarios.push({ clientId: '900100', orientacao, consultas }) - 1;
    casos.push({ t: 'lancamento', c: idx, r: roda(() => { const e = modelo.clientFinancialLaunchError(orientacao ? { clientId: '900100', financialGuidance: orientacao } : { clientId: '900100' }, consultas); return e === undefined ? null : e; }) });
  }
  return { cenarios, casos };
}

module.exports = { gerar };
