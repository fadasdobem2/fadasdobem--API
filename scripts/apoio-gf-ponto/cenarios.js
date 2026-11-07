'use strict';

/**
 * Cenários do ouro do Ponto, da Escala e do calendário da operação (v706 da Nice). A MESMA lista de ENTRADAS alimenta o gerador
 * (`scripts/gerar-ouro-gf-ponto.js`, que roda o código REAL do front) e o verificador (`scripts/verificar-gf-ponto.js`, que roda o porte do
 * servidor). Semente fixa, bordas exatas (29,999 s, 59,999 s, 2:59,999 min, 3:00, virada das 06:00) e dados fictícios.
 */

function prng(semente) {
  let a = semente >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sorteio = (r) => ({ int: (n) => Math.floor(r() * n), pick: (l) => l[Math.floor(r() * l.length)], chance: (p) => r() < p });
const BASE = Date.parse('2026-11-02T09:00:00-03:00');
const MIN = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const DIA = (ms) => iso(ms).slice(0, 10);
const HH = (m) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

const PASSOS = [0, 5_000, 29_999, 30_000, 31_000, 59_999, 60_000, 90_000, 179_999, 180_000, 180_001, 5 * MIN, 31 * MIN, 2 * 3_600_000, 9 * 3_600_000, 15 * 3_600_000, 20 * 3_600_000, 30 * 3_600_000];
const COMANDOS = ['enter', 'start', 'heartbeat', 'pause', 'resume', 'end', 'disconnect', 'heartbeat', 'heartbeat', 'pause', 'resume'];

/** Sequências de comandos de ponto: cada passo com relógio, comando, atores e turno esperado (id atual, errado ou ausente). */
function cenariosDeTurno() {
  const s = sorteio(prng(702)); const casos = [];
  for (let n = 0; n < 420; n++) {
    let agora = BASE + s.int(48) * 3_600_000 + s.pick([0, 1, 59_999, 5 * MIN]) + (n % 7 === 0 ? 20 * 3_600_000 : 0); const passos = [];
    for (let k = 0; k < 4 + s.int(10); k++) {
      agora += s.chance(0.04) ? -s.pick([1, 60_000, 3_600_000]) : s.pick(PASSOS);
      const sorte = s.int(10);
      passos.push({ comando: s.pick(COMANDOS), agora, esperado: sorte < 6 ? 'atual' : sorte < 7 ? 'errado' : 'nenhum', ator: s.chance(0.03) ? 'outra' : 'a', estadoEm: agora + s.pick([0, 59_999, 180_000, 180_001, 7_200_000, 86_400_000]) });
    }
    casos.push({ nome: `turno ${n}`, passos });
  }
  return casos;
}

const versao = (id, de, ini, met, extra = {}) => ({ id, effectiveFrom: de, createdAt: '2026-11-01T12:00:00Z', createdBy: 'Gestora', dayStart: ini, metricsTime: met, serviceHours: Array.from({ length: 7 }, (_, weekday) => ({ weekday, defined: weekday > 0 && weekday < 6, closed: false, start: '09:00', end: '02:00', endDayOffset: 1 })), ...extra });
/** Histórias de calendário sobre a versão original (`base`) de quem executa: a do front ou a do servidor. */
const historias = (base) => ({ h8: [base, versao('v8', '2026-11-20', '08:00', '08:30')], h4: [base, versao('v4', '2026-11-10', '04:00', '05:00'), versao('v5', '2026-12-15', '00:00', '00:00')] });

/** Calendário: instantes com bordas das 06:00 e das viradas históricas, em histórias com corte alterado. */
function cenariosDeCalendario() {
  const s = sorteio(prng(648));
  const instantes = ['2026-11-02T08:59:59.999Z', '2026-11-02T09:00:00.000Z', '2026-11-02T08:59:59Z', '2026-11-20T10:59:59.999Z', '2026-11-20T11:00:00.000Z', '2026-11-19T08:59:59Z', '2026-11-19T09:00:00Z', '2018-11-04T02:59:59Z', '2018-11-04T03:00:00Z', '2019-02-17T01:59:59Z', '2019-02-17T02:00:00Z'];
  for (let i = 0; i < 120; i++) instantes.push(iso(Date.parse('2026-10-25T00:00:00Z') + s.int(70 * 24 * 60) * MIN + s.pick([0, 59_999])));
  const casos = [];
  for (const [nome, historia] of [['padrão', null], ['corte 08:00', 'h8'], ['corte 04:00 e 00:00', 'h4']]) {
    for (const em of instantes) casos.push({ nome: `${nome} ${em}`, historia, em });
  }
  const datas = ['2026-11-09', '2026-11-10', '2026-11-19', '2026-11-20', '2026-11-21', '2026-12-14', '2026-12-15', '2026-12-16', '2018-11-03', '2018-11-04'];
  return { casos, datas };
}

/** Escalas semanais e exceções (atendentes): válidas, sobrepostas, com virada de meia-noite, e edições. */
function cenariosDeEscala() {
  const s = sorteio(prng(77)); const casos = [];
  const periodo = () => { const ini = s.pick([0, 360, 480, 540, 600, 720, 840, 1020, 1200, 1320, 1380]); const dur = s.pick([60, 120, 240, 300, 360, 480, 600]); return { start: HH(ini), end: HH(ini + dur) }; };
  const dia = () => (s.chance(0.2) ? [] : Array.from({ length: 1 + s.int(3) }, periodo));
  const mud = (de) => ({ from: de, days: Object.fromEntries(Array.from({ length: 1 + s.int(5) }, () => [String(s.int(7)), dia()])) });
  for (let n = 0; n < 300; n++) {
    const roster = { weekly: Array.from({ length: s.int(4) }, (_, k) => mud(DIA(BASE + k * 9 * 86400000 + s.int(3) * 86400000))), exceptions: {} };
    for (let k = 0; k < s.int(4); k++) roster.exceptions[DIA(BASE + s.int(30) * 86400000)] = dia();
    if (s.chance(0.04)) roster.weekly.push({ ...roster.weekly[0] || mud('2026-11-02') });
    if (s.chance(0.04)) roster.exceptions['2026-02-31'] = [];
    const edicoes = Array.from({ length: 4 }, () => {
      const data = DIA(BASE + s.int(30) * 86400000);
      return s.chance(0.5) ? { kind: 'exception', date: data, periods: s.chance(0.15) ? null : dia() } : { kind: 'weekly', date: data, weekday: String(s.int(7)), periods: dia() };
    });
    if (s.chance(0.05)) edicoes.push({ kind: 'exception', date: 'nao-e-data', periods: [] });
    casos.push({ nome: `escala ${n}`, roster: s.chance(0.1) ? undefined : roster, edicoes, datas: Array.from({ length: 6 }, () => DIA(BASE + s.int(40) * 86400000)) });
  }
  // Limite de 12 períodos por dia (13 recusa), em faixas de 30 minutos que não se tocam.
  const faixas = (n) => Array.from({ length: n }, (_, k) => ({ start: HH(k * 90), end: HH(k * 90 + 30) }));
  for (const n of [11, 12, 13]) casos.push({ nome: `escala ${n} períodos`, roster: { weekly: [], exceptions: { '2026-11-04': faixas(n) } }, edicoes: [{ kind: 'exception', date: '2026-11-05', periods: faixas(n) }], datas: ['2026-11-04', '2026-11-05'] });
  return casos;
}

module.exports = { versao, historias, prng, sorteio, BASE, MIN, iso, DIA, HH, cenariosDeTurno, cenariosDeCalendario, cenariosDeEscala };
