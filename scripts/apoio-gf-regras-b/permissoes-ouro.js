'use strict';

/**
 * Ouro das PERMISSÕES POR PERFIL (Maturacao/44): `permissionsFor` REAL do front para os 5 perfis (todas as capacidades) e o comportamento REAL
 * do recorte "só recentes" (`visibleCashRows` com `recentOnly`, o que `payments-ledger.tsx` usa para supervisora e atendente): quando o corte de
 * 30 linhas vale e quando o histórico inteiro continua acessível (busca, filtro, data de lançamento).
 */

async function gerar(ctx) {
  const mod = await ctx.carregar('/features/domain/permissions.ts');
  const perfis = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
  const led = await ctx.carregar('/features/finance/cash-ledger.ts');
  const pagamentos = Array.from({ length: 45 }, (_, i) => ({
    id: `PG-${String(i + 1).padStart(3, '0')}`, clientId: `${1000 + i}`, client: `Cliente ${i % 7 === 0 ? 'Marta' : 'Outra'} ${i}`, amount: 40 + i, grossAmount: 40 + i, method: 'PIX', bank: 'Mercado Pago', payerName: `Pagador ${i}`,
    informedAt: new Date(Date.parse('2026-10-01T12:00:00-03:00') + i * 86400000).toISOString(), paidAt: new Date(Date.parse('2026-10-01T12:00:00-03:00') + i * 86400000).toISOString(), status: 'Informado',
  }));
  const base = { query: '', filter: 'todos', start: '2026-10-30', end: '2026-10-30', today: '2026-11-14', recentOnly: true };
  const variantes = {
    semBusca: base, comBusca: { ...base, query: 'Marta' }, filtroInformados: { ...base, filter: 'informados' }, dataDeLancamento: { ...base, registrationDate: '2026-10-05' }, adminSemCorte: { ...base, recentOnly: false, start: '2026-10-01', end: '2026-11-14' },
  };
  const recorte = Object.fromEntries(Object.entries(variantes).map(([k, o]) => [k, led.visibleCashRows(pagamentos, o, []).length]));
  return { perfis: Object.fromEntries(perfis.map((p) => [p, mod.permissionsFor(p)])), recorte, totalDePagamentos: pagamentos.length };
}

module.exports = { gerar };
