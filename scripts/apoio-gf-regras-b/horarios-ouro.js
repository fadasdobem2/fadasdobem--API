'use strict';

/**
 * Cenários de ouro dos HORÁRIOS (Maturacao/44): `availabilityChange` + `applyAvailabilityChange` + `planScheduleCommands` REAIS sobre muitos estados
 * de exceções, mais os registros dos outros caminhos do front (editor da equipe, resposta da escala), que são código em componente e entram
 * TRANSCRITOS (marcados `origem`). O verificador reproduz os comandos no servidor (`corpoExcecao` + `guardarExcecao`) e exige o mesmo conjunto
 * de exceções; as recusas do front (frases) viram cenários de recusa.
 */

const { sorteador, tentar } = require('./front');

const HOJE = '2026-11-10';
const AGORA = '2026-11-10T15:00:00-03:00';
const ID = 'osiris';
const PERFIL = { id: ID, name: 'Osíris', official: [], weeklySchedule: { segunda: '18h às 23h', terca: '18h às 23h', sabado: 'Folga' }, today: '18h às 23h', note: 'Recado do perfil', noteDate: '2026-11-12', status: 'Disponível', online: true };
const dia = (n) => new Date(Date.parse(`${HOJE}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const PERIODOS = [
  [{ start: '18:00', end: '23:00' }], [{ start: '09:00', end: '12:00' }, { start: '14:00', end: '18:00' }], [{ start: '08:00', end: '10:00' }, { start: '11:00', end: '13:00' }, { start: '14:00', end: '16:00' }],
  [{ start: '22:00', end: '06:00' }], [{ start: '23:00', end: '02:00' }], [{ start: '10:00', end: '10:00' }], [{ start: '12:00', end: '10:00' }], [{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }],
  [{ start: '9:00', end: '12:00' }], [{ start: '', end: '' }], [], [{ start: '08:00', end: '09:00' }, { start: '10:00', end: '11:00' }, { start: '12:00', end: '13:00' }, { start: '14:00', end: '15:00' }],
];
const AUSENCIAS = ['Nenhuma', 'Férias', 'Licença', 'Folga estendida'];

async function gerar(ctx) {
  const md = await ctx.carregar('/features/tarologas/tarologist-availability-model.ts');
  const so = await ctx.carregar('/features/domain/schedule-overrides.ts');
  const pl = await ctx.carregar('/features/integration/schedules/real-schedules-plan.ts');
  const sp = await ctx.carregar('/features/tarologas/tarologist-self-profile-model.ts');
  const fm = await ctx.carregar('/features/domain/formatters.ts');
  const { sorteio, alea, inteiro } = sorteador(20261201);
  const cenarios = []; const estados = new Map();
  const ref = (o) => { const k = JSON.stringify(o); if (!estados.has(k)) estados.set(k, estados.size); return estados.get(k); };

  // Estados de exceções: cadeias de mudanças reais.
  const pool = [{}];
  for (let i = 0; i < 60; i += 1) {
    let rec = {};
    for (let k = inteiro(1, 4); k > 0; k -= 1) {
      const ini = dia(inteiro(0, 12)); const tipo = sorteio(AUSENCIAS);
      const r = tentar(() => {
        const mud = md.availabilityChange(PERFIL, rec, { startDate: ini, endDate: dia(inteiro(0, 15)), absenceType: tipo, periods: sorteio(PERIODOS.slice(0, 5)) }, `2026-11-0${inteiro(1, 9)}T10:00:00-03:00`, undefined, `cmd-${i}-${k}`);
        return md.applyAvailabilityChange(rec, PERFIL, mud);
      });
      if (r.ok) rec = r.ok;
    }
    pool.push(rec);
  }

  const registrar = (acao, antes, depois, extra = {}) => {
    const comandos = pl.planScheduleCommands(antes, depois);
    cenarios.push({ tipo: 'comando', acao, antes: ref(antes), depois, comandos, ...extra });
  };
  for (const rec of pool) {
    for (let n = 0; n < 6; n += 1) {
      const tipo = sorteio(AUSENCIAS); const ini = dia(inteiro(-2, 14)); const fim = dia(inteiro(-2, 20)); const periodos = sorteio(PERIODOS);
      const draft = { startDate: ini, endDate: fim, absenceType: tipo, periods: periodos };
      const minimo = alea() < 0.5 ? HOJE : undefined;
      const r = tentar(() => { const mud = md.availabilityChange(PERFIL, rec, draft, AGORA, minimo, `cmd-${n}`); return { mud, depois: md.applyAvailabilityChange(rec, PERFIL, mud) }; });
      if (r.ok) { registrar(`mudanca:${tipo}`, rec, r.ok.depois, { origem: 'real' }); continue; }
      // Recusa do front: o que o navegador mandaria sem a conferência (o registro montado à força).
      const periodosForjados = tipo === 'Nenhuma' ? periodos : [];
      const forjado = { commandId: `cmd-${n}`, todayHours: tipo === 'Nenhuma' ? fm.formatWorkPeriods(periodosForjados.filter((p) => p.start && p.end)) : tipo === 'Folga estendida' ? 'Folga' : tipo, periods: periodosForjados, note: '', updatedAt: AGORA, absenceType: tipo, startDate: ini, endDate: tipo === 'Nenhuma' ? ini : fim };
      cenarios.push({ tipo: 'recusa', acao: `mudanca:${tipo}`, antes: ref(rec), erro: r.erro, minimo: minimo || null, forjado, perfil: minimo ? 'tarologa' : 'equipe' });
    }
    // Editor da equipe (horarios/schedule-experience.tsx, transcrito): `storeScheduleOverride` com registro novo.
    for (let n = 0; n < 3; n += 1) {
      const tipo = sorteio(AUSENCIAS); const ini = dia(inteiro(0, 14)); const fim = alea() < 0.5 ? ini : dia(inteiro(0, 20));
      const periodos = tipo === 'Nenhuma' ? sorteio(PERIODOS.slice(0, 3)) : [];
      const r = tentar(() => { if (tipo === 'Nenhuma') sp.validateOwnWorkPeriods(periodos); if (fim < ini) throw new Error('A data final não pode ser anterior à inicial.'); });
      if (r.erro) continue;
      const reg = { commandId: `ed-${n}`, todayHours: tipo === 'Nenhuma' ? fm.formatWorkPeriods(periodos) : tipo, periods: periodos, note: 'Sem recado adicional.', updatedAt: AGORA, absenceType: tipo, startDate: ini, endDate: fim, rosterResponse: { actor: 'Clara', at: AGORA } };
      registrar(`editor:${tipo}`, rec, so.storeScheduleOverride(rec, ID, reg), { origem: 'transcrito:schedule-experience.tsx' });
    }
    // Resposta da escala (escala/roster-context.tsx, transcrito): "vou" com períodos ou "não atende" (Folga estendida).
    for (let n = 0; n < 2; n += 1) {
      const d = dia(inteiro(0, 14)); const vai = alea() < 0.5; const periodos = vai ? sorteio(PERIODOS.slice(0, 3)) : [];
      if (vai && tentar(() => sp.validateOwnWorkPeriods(periodos, 3)).erro) continue;
      const antes = so.scheduleOverrideOnDate(rec, ID, d);
      const reg = { ...antes, commandId: `ro-${n}`, todayHours: vai ? fm.formatWorkPeriods(periodos) : 'Não atende', periods: periodos, note: antes?.note || '', noteUpdatedAt: antes?.noteUpdatedAt ?? antes?.updatedAt, noteStartDate: antes?.noteStartDate ?? antes?.startDate, noteEndDate: antes?.noteEndDate ?? antes?.endDate, absenceType: vai ? 'Nenhuma' : 'Folga estendida', startDate: d, endDate: d, updatedAt: AGORA, rosterResponse: { actor: 'Clara', at: AGORA } };
      registrar(`escala:${vai ? 'vou' : 'nao'}`, rec, so.storeScheduleOverride(rec, ID, reg), { origem: 'transcrito:roster-context.tsx' });
    }
  }
  // As frases de `validateOwnWorkPeriods` (maximo 2 e 3).
  const frases = [];
  for (const max of [2, 3]) for (const p of PERIODOS) { const r = tentar(() => sp.validateOwnWorkPeriods(p, max)); frases.push({ max, periodos: p, erro: r.erro || null }); }
  return { estados: [...estados.keys()].map((k) => JSON.parse(k)), cenarios, frases, hoje: HOJE };
}

module.exports = { gerar, ID, HOJE };
