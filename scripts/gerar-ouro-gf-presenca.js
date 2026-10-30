'use strict';

/**
 * Gera o ouro da Presença (scripts/apoio-gf-presenca/ouro-presenca-front.json) A PARTIR DO CÓDIGO REAL DO FRONT:
 * `advancePresenceConfirmation`, `confirmProfessionalPresence`, `changeProfessionalPresence` e `resolvePresenceReturn`, com os cenários de
 * scripts/apoio-gf-presenca/cenarios.js. Só precisa rodar de novo quando o front mudar essas regras. Uso (o FRONT tem de ter node_modules):
 *   node scripts/gerar-ouro-gf-presenca.js --front=<pasta do FRONT com node_modules>
 * Nada no front é alterado. Roda o vite em modo SSR com a marca de artefato Node e FADAS_MODE=real (sem o calendário de demonstração).
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CENARIOS } = require('./apoio-gf-presenca/cenarios');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

const CAMPOS = ['shiftStatus', 'shiftExit', 'pauseReason', 'expectedReturn', 'returnUntil', 'returnForecast', 'presenceDate', 'presenceLastActivityAt', 'presenceConfirmedAt',
  'presenceScheduleUpdatedAt', 'presenceConfirmedPeriod', 'presenceConfirmation', 'shiftAvailableSince', 'presenceHistory'];
/** Só a presença, histórico sem os ids aleatórios, e como JSON (campo `undefined` some, como o servidor omite). */
function recorte(p) {
  const o = Object.fromEntries(CAMPOS.filter((c) => p[c] !== undefined).map((c) => [c, p[c]]));
  if (o.presenceHistory) o.presenceHistory = o.presenceHistory.map((h) => ({ ...h, id: h.id.startsWith('presence-idle-') ? h.id : '#' }));
  return JSON.parse(JSON.stringify(o));
}

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  const cal = await vite.ssrLoadModule('/features/domain/operation-calendar.ts');
  if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
  const conf = await vite.ssrLoadModule('/features/tarologas/presence-confirmation-model.ts');
  const staff = await vite.ssrLoadModule('/features/tarologas/staff-presence-model.ts');
  const prev = await vite.ssrLoadModule('/features/tarologas/presence-return-forecast.ts');
  const saida = [];
  for (const c of CENARIOS) {
    let resultado;
    try {
      if (c.tipo === 'avancar') resultado = { perfil: recorte(conf.advancePresenceConfirmation(c.perfil, c.consultasFront, c.excecoes, c.data, c.agora)) };
      else if (c.tipo === 'confirmar') resultado = { perfil: recorte(conf.confirmProfessionalPresence(c.perfil, c.data, c.ator, c.agora)) };
      else if (c.tipo === 'mudar') {
        const f = c.front;
        resultado = { perfil: recorte(staff.changeProfessionalPresence(c.perfil, f.choice, c.data, c.ator, c.agora, f.returnTime, f.endTime, new Date(c.agora).toISOString(), f.pause, f.forecast, c.excecoes)) };
      } else resultado = { retorno: JSON.parse(JSON.stringify(prev.resolvePresenceReturn(c.perfil, c.excecoes, c.data, c.agora, c.entrada))) };
    } catch (e) { resultado = { erro: e.message }; }
    saida.push({ nome: c.nome, ...resultado });
  }
  await vite.close();
  const destino = path.join(__dirname, 'apoio-gf-presenca', 'ouro-presenca-front.json');
  fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (presence-confirmation-model, staff-presence-model, presence-return-forecast)', cenarios: saida }, null, 1)}\n`);
  console.log(`${saida.length} cenários gravados em ${path.relative(process.cwd(), destino)} (${saida.filter((s) => s.erro).length} com recusa)`);
})().catch((e) => { console.error(e); process.exit(2); });
