'use strict';

/**
 * Cenários do ouro da Escala (`roster-model.ts`, v706): perfis com horário habitual, retorno e janela confirmada; exceções por data e por
 * intervalo; feriados; datas em todos os dias da semana (domingo fechado ou excepcional). Mesma lista no gerador e no verificador.
 */

const { prng, sorteio, iso } = require('./cenarios');

const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const HORARIOS = ['9h às 15h', '10:00 - 18:00', '22h às 2h', 'Folga', 'Não atende', 'Horário não informado', '9h às 12h e 14h às 18h', '', '13h a 19h'];
const CHAVE_HOJE = Date.parse('2026-11-05T12:00:00-03:00');
const dia = (n) => new Date(Date.UTC(2026, 9, 28 + n, 12)).toISOString().slice(0, 10);

function cenariosDeRegistro() {
  const s = sorteio(prng(706)); const casos = [];
  for (let n = 0; n < 260; n++) {
    const id = 'osiris';
    const perfil = { id, name: 'Osíris', weeklySchedule: Object.fromEntries(DIAS.filter(() => s.chance(0.7)).map((d) => [d, s.pick(HORARIOS)])) };
    if (s.chance(0.2)) perfil.weeklyScheduleVersions = [{ effectiveFrom: dia(s.int(20)), schedule: Object.fromEntries(DIAS.map((d) => [d, s.pick(HORARIOS)])) }, { effectiveFrom: dia(s.int(30)), schedule: { domingo: '9h às 13h' } }];
    const alvo = dia(s.int(34));
    if (s.chance(0.25)) {
      const ini = Date.parse(`${alvo}T${s.pick(['10:00', '18:00', '21:30'])}:00-03:00`);
      Object.assign(perfil, s.chance(0.5)
        ? { shiftExit: 'return', presenceDate: alvo, expectedReturn: iso(ini), returnUntil: s.chance(0.7) ? iso(ini + s.pick([2, 4, 6]) * 3_600_000) : undefined, presenceScheduleUpdatedAt: iso(CHAVE_HOJE - s.int(5) * 3_600_000), returnForecast: s.chance(0.5) ? { kind: s.pick(['exact', 'next-shift', 'later']), scheduleDate: alvo } : undefined }
        : { presenceConfirmedPeriod: { date: alvo, startAt: iso(ini), endAt: iso(ini + s.pick([3, 5]) * 3_600_000) } });
    }
    const excecoes = {};
    for (let k = 0; k < s.int(5); k++) {
      const ini = dia(s.int(34)); const unico = s.chance(0.7); const fim = unico ? ini : dia(Math.min(33, s.int(34) + 3));
      const f = fim < ini ? ini : fim; const tipo = s.int(6); const trabalha = tipo < 3; const periodos = trabalha ? [{ start: s.pick(['09:00', '10:00', '14:00']), end: s.pick(['13:00', '18:00', '22:00']) }] : [];
      const chave = ini === f ? `${id}@${ini}` : `${id}@${ini}..${f}`;
      excecoes[chave] = {
        todayHours: trabalha ? '9h às 13h' : tipo === 3 ? 'Folga' : tipo === 4 ? 'Não atende' : s.pick(['Aguardando', '']), periods: periodos, note: '', updatedAt: s.pick(['2026-11-01T10:00:00', '2026-11-03T09:00:00.000Z', iso(CHAVE_HOJE - s.int(10) * 3_600_000)]),
        absenceType: tipo === 5 ? 'Férias' : 'Nenhuma', startDate: ini, endDate: f, ...(s.chance(0.4) ? { rosterResponse: { actor: 'Osíris', at: '2026-11-04T10:00:00.000Z' } } : {}),
      };
    }
    const feriados = Array.from({ length: s.int(3) }, (_, k) => ({ id: `f${k}`, date: dia(s.int(34)), name: 'Feriado', remindFrom: dia(s.int(10)), createdBy: 'Gestora', updatedAt: '2026-11-01T10:00:00Z' }));
    const datas = Array.from({ length: 8 }, (_, k) => dia((n * 3 + k * 5) % 34));
    casos.push({ nome: `registro ${n}`, perfil, excecoes, feriados, datas, hoje: dia(5 + s.int(8)) });
  }
  return casos;
}

module.exports = { cenariosDeRegistro };
