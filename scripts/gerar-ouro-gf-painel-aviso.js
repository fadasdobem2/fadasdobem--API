'use strict';

/**
 * OURO do aviso de disponibilidade ao agendar (Maturacao/39), do CÓDIGO REAL do front com `Date.now` travado: `scheduleAvailabilityNotice`
 * (schedule-availability-notice.ts, com `bookingReturnPeriod`, `nextProfessionalReturnPeriod` e `presenceReturnSummary`).
 *   node scripts/gerar-ouro-gf-painel-aviso.js --front=<pasta do front>
 * Grava scripts/apoio-gf-painel/ouro-painel-aviso.json (inclui a `key`, a chave de confirmação).
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261127;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;
const inteiro = (n) => Math.floor(aleatorio() * n);
const AGORAS = ['2026-10-12T10:00:00-03:00', '2026-10-12T05:50:00-03:00', '2026-10-12T06:05:00-03:00', '2026-10-13T00:30:00-03:00', '2026-10-12T23:55:00-03:00', '2026-10-12T14:20:00-03:00', '2026-10-14T19:00:00-03:00'].map(Date.parse);
const iso = (ms) => new Date(ms).toISOString();
const diaOp = (ms) => new Date(ms - 9 * 3600000).toISOString().slice(0, 10);
const somar = (d, n) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const relogio = (ms) => new Date(ms - 3 * 3600000).toISOString().slice(11, 16);
const HORAS = ['0h às 23h', '9h às 18h', '22h às 6h', 'Folga', 'Horário não informado', '8h às 12h · 14h às 20h', '6h às 12h', 'Não atende'];

function perfil(agora, dia) {
  const p = { id: 'r1', name: sorteio(['Ana', 'Álvaro', 'Zeca']), online: chance(0.8), status: sorteio(['Disponível', 'Pausa']), official: [], today: '', note: '',
    weeklySchedule: Object.fromEntries(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].map((d) => [d, sorteio(HORAS)])) };
  if (chance(0.7)) p.shiftStatus = sorteio(['Disponível', 'Em pausa', 'Offline', 'Offline']);
  if (chance(0.5)) p.shiftExit = sorteio(['ended', 'missing', 'return', 'shift-ended']);
  if (chance(0.6)) p.presenceDate = dia;
  if (chance(0.3)) p.returnForecast = sorteio([{ kind: 'next-shift', scheduleDate: dia, date: dia, time: '09:00' }, { kind: 'afternoon', date: somar(dia, 1), scheduleDate: somar(dia, 1) }, { kind: 'evening', date: dia, scheduleDate: dia }, { kind: 'approximate', date: dia, time: '15:00', scheduleDate: dia }, { kind: 'exact', date: dia, time: '16:00', scheduleDate: dia, endTime: '22:00', endDate: dia }]);
  if (chance(0.3)) { p.expectedReturn = iso(agora + sorteio([-30, 30, 120, 600]) * 60000); if (chance(0.7)) p.returnUntil = iso(Date.parse(p.expectedReturn) + sorteio([60, 240, 600]) * 60000); p.shiftExit = 'return'; p.presenceDate = dia; }
  if (chance(0.15)) p.presenceConfirmedPeriod = { date: dia, startAt: iso(agora - 3600000), endAt: iso(agora + 7200000) };
  if (chance(0.2)) p.presenceConfirmation = { reason: 'manual', requestedAt: iso(agora - 600000), offlineAt: iso(agora - 300000 * inteiro(20)) };
  if (chance(0.15)) p.presenceScheduleUpdatedAt = iso(agora - inteiro(120) * 60000);
  return p;
}

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-painel-aviso', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateNow = Date.now;
  try {
    const fm = await vite.ssrLoadModule('/features/agenda/schedule-availability-notice.ts');
    const casos = []; let pulados = 0; const tipos = {};
    for (let k = 0; k < 1500; k += 1) {
      const agora = sorteio(AGORAS) + inteiro(60) * 60000; const dia = diaOp(agora); Date.now = () => agora;
      const p = perfil(agora, dia);
      const overrides = chance(0.3) ? { [`r1@${dia}`]: { startDate: dia, endDate: sorteio([dia, somar(dia, 3)]), absenceType: sorteio(['Nenhuma', 'Férias', 'Atestado']), todayHours: sorteio(['9h às 18h', 'Folga', '14h às 20h']), periods: chance(0.5) ? [{ start: '14:00', end: '20:00' }] : undefined, note: '', updatedAt: iso(agora - inteiro(300) * 60000) } } : {};
      const intakeEvents = chance(0.2) ? [{ id: 'ev', tarotId: 'r1', date: dia, mode: 'on_return', at: iso(agora - 600000), by: 'x', consultationIds: [], returnTime: sorteio(['15:00', '19:00']), endTime: sorteio(['20:00', '23:00', '03:00']) }] : [];
      const entrada = { profile: chance(0.97) ? p : undefined, overrides, date: sorteio([dia, dia, somar(dia, 1), somar(dia, 2), somar(dia, -1), 'invalida']), now: agora, intakeEvents,
        ...(chance(0.6) ? { time: sorteio(['08:00', '10:00', '12:30', '15:00', '19:30', '23:00', '02:00', '05:59', '06:00', relogio(agora + 600000), relogio(agora - 600000), '25:00']) } : {}), ...(chance(0.3) ? { requestedTime: 'por volta das 10' } : {}), ...(chance(0.7) ? { timeKind: sorteio(['exact', 'approximate', 'after', 'shift', 'none']) } : {}) };
      let r; try { r = fm.scheduleAvailabilityNotice(entrada); } catch (e) { pulados += 1; continue; }
      const j = r === undefined ? null : JSON.parse(JSON.stringify(r)); tipos[j ? j.kind : 'sem aviso'] = (tipos[j ? j.kind : 'sem aviso'] || 0) + 1;
      casos.push({ entrada: JSON.parse(JSON.stringify(entrada)), aviso: j });
    }
    Date.now = dateNow;
    const saida = path.join(__dirname, 'apoio-gf-painel', 'ouro-painel-aviso.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'schedule-availability-notice.ts, staff-presence-model.ts, presence-return-forecast.ts do front, com Date.now travado por caso', casos })}\n`);
    console.log(`OK: ${casos.length} casos (pulados ${pulados}), avisos ${JSON.stringify(tipos)} -> ${path.relative(process.cwd(), saida)}`);
  } finally { Date.now = dateNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
