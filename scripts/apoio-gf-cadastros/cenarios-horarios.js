'use strict';

/** Cenários do ouro do horário semanal estruturado do cadastro (v706). Determinísticos (semente fixa). */

let semente = 20261207;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
const HORAS = ['9h às 12h', '9h às 12h e 14h às 18h', '22h às 6h', 'Folga', 'por escala', 'Por Escala', 'Não atende', '10 às 14', '', 'sem horário informado'];
const RUINS = ['14h às 9h', 'qualquer coisa', '1h às 2h e 3h às 4h e 5h às 6h e 7h às 8h', '25h às 26h'];
const DATAS = ['2026-10-01', '2026-11-01', '2026-11-07', '2026-11-10', '2026-12-01', '2027-01-15', '2026-10-01', '2026-11-10', '2026-02-30', ''];
const HOJE = '2026-11-07';

function semana() { const r = {}; for (const d of DIAS) if (aleatorio() < 0.6) r[d] = aleatorio() < 0.03 ? sorteio(RUINS) : sorteio(HORAS); return r; }
function versoes() { const n = Math.floor(aleatorio() * 3); return Array.from({ length: n }, () => ({ effectiveFrom: sorteio(DATAS), schedule: semana() })); }
function ficha(extra = {}) { return { professionalName: 'Ana Luz', weeklySchedule: semana(), ...extra }; }

function gerar() {
  const casos = [];
  for (let i = 0; i < 500; i += 1) {
    const base = ficha();
    if (aleatorio() < 0.5) base.weeklyScheduleEffectiveFrom = sorteio(DATAS);
    if (aleatorio() < 0.4) base.weeklyScheduleBase = semana();
    if (aleatorio() < 0.5) base.weeklyScheduleVersions = versoes();
    casos.push({ tipo: 'validar', entrada: base });
  }
  const valida = () => { const x = ficha(); x.weeklySchedule = Object.fromEntries(Object.entries(x.weeklySchedule).filter(([, h]) => ['9h às 12h', 'Folga', 'por escala', '9h às 12h e 14h às 18h'].includes(h))); return x; };
  for (let i = 0; i < 700; i += 1) {
    const anterior = aleatorio() < 0.85 ? valida() : undefined;
    if (anterior) {
      if (aleatorio() < 0.6) anterior.weeklyScheduleEffectiveFrom = sorteio(['2026-10-01', '2026-11-01', '2026-11-07', '2026-11-10', '2026-12-01']);
      if (aleatorio() < 0.5) anterior.weeklyScheduleBase = valida().weeklySchedule;
      if (aleatorio() < 0.6) anterior.weeklyScheduleVersions = [{ effectiveFrom: '2026-10-01', schedule: valida().weeklySchedule }, { effectiveFrom: sorteio(['2026-11-10', '2026-12-01']), schedule: valida().weeklySchedule }].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    }
    const proximo = aleatorio() < 0.5 && anterior ? { ...anterior, weeklySchedule: aleatorio() < 0.6 ? anterior.weeklySchedule : valida().weeklySchedule } : valida();
    if (aleatorio() < 0.35) proximo.weeklyScheduleEffectiveFrom = sorteio(['2026-11-07', '2026-11-10', '2026-12-01', '2026-10-01']); else if (aleatorio() < 0.5) delete proximo.weeklyScheduleEffectiveFrom;
    if (!anterior && aleatorio() < 0.4) proximo.weeklyScheduleVersions = [{ effectiveFrom: '2026-11-10', schedule: valida().weeklySchedule }];
    casos.push({ tipo: 'preparar', proximo, anterior, hoje: HOJE });
  }
  for (let i = 0; i < 300; i += 1) {
    const perfil = { weeklySchedule: aleatorio() < 0.8 ? semana() : undefined, weeklyScheduleVersions: aleatorio() < 0.7 ? [{ effectiveFrom: '2026-10-01', schedule: semana() }, { effectiveFrom: '2026-11-10', schedule: semana() }] : undefined };
    casos.push({ tipo: 'naData', perfil, data: sorteio(['2026-09-01', '2026-10-01', '2026-11-09', '2026-11-10', '2027-01-01']) });
  }
  return casos;
}

module.exports = { gerar };
