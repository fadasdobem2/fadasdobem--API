'use strict';

/** Ouro do PERFIL DO TARÓLOGO (Maturacao/44): `prepareRegistrationChange` REAL (inativar/reativar o cadastro: consulta em curso, contas ligadas bloqueadas). */

const { sorteador, tentar } = require('./front');

async function gerar(ctx) {
  const mod = await ctx.carregar('/features/admin/professional-settings-model.ts');
  const { sorteio } = sorteador(20261205);
  const perfil = (id, ativo) => ({ id, name: `Tarólogo ${id}`, registrationActive: ativo, official: [], today: '', note: '', online: true, status: 'Disponível', shiftStatus: 'Online' });
  const cenarios = [];
  for (let i = 0; i < 400; i += 1) {
    const ativoAntes = sorteio([true, false]); const ativoNovo = sorteio([true, false]);
    const consultas = [];
    for (let k = 0; k < sorteio([0, 1, 2]); k += 1) consultas.push({ id: `c${k}`, tarotId: sorteio(['t1', 't1', 't2']), status: sorteio(['Em curso', 'Concluída', 'Cancelada', 'Em curso']) });
    const contas = sorteio([[], [{ id: 'u1', tarotId: 't1', name: 'Tarólogo t1', email: 'a@b.com', role: 'tarologa', commission: '30%', access: 'x', active: true }]]);
    const fonte = { tarotProfiles: [perfil('t1', ativoAntes), perfil('t2', true)], directoryProfiles: [], accounts: contas, consultations: consultas, agenda: [] };
    const r = tentar(() => mod.prepareRegistrationChange('t1', ativoNovo, fonte, { id: 'a1', actor: 'Clara', at: '2026-11-10T12:00:00.000Z' }));
    const saida = r.ok && 'error' in r.ok ? { erro: r.ok.error } : { ok: { bloqueadas: r.ok.blockedAccountIds, ativo: r.ok.directory.registrationActive } };
    cenarios.push({ ativoAntes, ativoNovo, consultas, contas: contas.length, esperado: saida });
  }
  return { cenarios };
}

module.exports = { gerar };
