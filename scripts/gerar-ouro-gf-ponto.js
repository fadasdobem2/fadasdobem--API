'use strict';

/**
 * Gera o OURO do Ponto, da Escala e do calendário da operação (v702/v706 da Nice) A PARTIR DO CÓDIGO REAL DO FRONT:
 * `staff-clock.ts`, `staff-roster-model.ts`, `operation-settings.ts`, `staff-workday-model.ts`, `staff-day-overview-model.ts` e `escala/roster-model.ts`.
 * Grava scripts/apoio-gf-ponto/ouro-ponto-front.json. Só precisa rodar de novo quando o front mudar essas regras.
 *   node scripts/gerar-ouro-gf-ponto.js --front=<pasta do FRONT com node_modules>
 * Nada no front é alterado (vite em modo SSR, relógio sempre injetado). Todo valor é fictício.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { cenariosDeTurno, cenariosDeCalendario, cenariosDeEscala } = require('./apoio-gf-ponto/cenarios');
const { cenariosDeRegistro } = require('./apoio-gf-ponto/cenarios-registro');
const { executarTurno, executarCalendario, executarEscala, executarRegistro } = require('./apoio-gf-ponto/resumo');
const { montarEntradas, executarJornada } = require('./apoio-gf-ponto/resumo-jornada');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-ponto', define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const os = await vite.ssrLoadModule('/features/domain/operation-settings.ts');
    const ck = await vite.ssrLoadModule('/features/atendimento/staff-clock.ts');
    const rm = await vite.ssrLoadModule('/features/atendimento/staff-roster-model.ts');
    const wm = await vite.ssrLoadModule('/features/admin/staff-workday-model.ts');
    const ov = await vite.ssrLoadModule('/features/admin/staff-day-overview-model.ts');
    const ro = await vite.ssrLoadModule('/features/escala/roster-model.ts');
    const fns = {
      turno: { apply: ck.applyStaffClockCommand, status: ck.staffShiftStatus, canStart: (t, em) => ck.staffShiftCanStart(t, em) },
      calendario: { ...os, DEFAULT: os.DEFAULT_OPERATION_SETTINGS },
      escala: { valid: rm.validStaffRoster, edit: rm.editStaffRoster, forDate: rm.staffRosterForDate, describe: rm.describeStaffPeriods },
      jornada: { ...wm, summarizeStaffDay: (contas, dados, data, agora, h) => ov.summarizeStaffDay(contas.map((c) => ({ ...c, staffRoster: (dados.find((d) => d.accountId === c.id) || {}).roster })), dados, data, agora, h) },
      registro: ro,
    };
    const ouro = { gerado: 'a partir do código do front (staff-clock, staff-roster-model, operation-settings, staff-workday-model, staff-day-overview-model, roster-model)' };
    const turnos = cenariosDeTurno();
    ouro.turno = turnos.map((caso) => ({ caso, esperado: executarTurno(fns, caso) }));
    const cal = cenariosDeCalendario();
    ouro.calendario = { grupo: cal, esperado: executarCalendario(fns, cal) };
    const escalas = cenariosDeEscala();
    ouro.escala = escalas.map((caso) => ({ caso, esperado: executarEscala(fns, caso) }));
    ouro.registro = cenariosDeRegistro().map((caso) => ({ caso, esperado: executarRegistro(fns, caso) }));
    // Turnos finais produzidos pelo front alimentam a Jornada (as entradas ficam gravadas no ouro).
    const finais = ouro.turno.map((t) => { const ult = t.esperado.filter((p) => p.r.ok && p.r.ok.turno).pop(); return ult ? ult.r.ok.turno : null; }).filter(Boolean);
    const rosters = escalas.map((c) => c.roster).filter(Boolean);
    ouro.jornada = montarEntradas(finais, rosters).map((entrada) => ({ entrada, esperado: executarJornada(fns, entrada) }));
    const destino = path.join(__dirname, 'apoio-gf-ponto', 'ouro-ponto-front.json');
    fs.writeFileSync(destino, `${JSON.stringify(ouro)}\n`);
    const passos = ouro.turno.reduce((n, t) => n + t.caso.passos.length, 0);
    const recusas = ouro.turno.reduce((n, t) => n + t.esperado.filter((p) => p.r.erro).length, 0);
    console.log(`${ouro.turno.length} sequências de ponto (${passos} comandos, ${recusas} recusas), ${ouro.calendario.grupo.casos.length} instantes de calendário, ${ouro.escala.length} escalas, ${ouro.registro.length} perfis de escala e ${ouro.jornada.length} jornadas gravados em ${path.relative(process.cwd(), destino)}`);
  } finally { await vite.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
