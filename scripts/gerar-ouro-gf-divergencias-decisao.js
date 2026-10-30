'use strict';

/**
 * Gera o OURO da DECISÃO das Divergências no servidor (Maturacao/35) a partir do CÓDIGO do front:
 * `tarologas/tarologist-divergences-model.ts` (`missingConsultationError`, `missingConsultationReportTimestamp`) e
 * `consultas/consultation-time-correction.ts` (`correctConsultationTime`, para o evento que a resolução "Corrigir tempo" deixa na consulta).
 *   node scripts/gerar-ouro-gf-divergencias-decisao.js --front=<pasta do front>
 * Grava scripts/apoio-gf-divergencias/ouro-decisao-front.json. Relógio fixo; todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const AGORA = Date.parse('2026-10-12T15:00:00-03:00');

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-div-decisao', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const realNow = Date.now; Date.now = () => AGORA;
  try {
    const m = await vite.ssrLoadModule('/features/tarologas/tarologist-divergences-model.ts');
    const corr = await vite.ssrLoadModule('/features/consultas/consultation-time-correction.ts');
    const ausentes = [];
    const datas = ['2026-10-10', '2026-10-12', '2026-10-13', '2027-01-01', '2026-02-30', '', '12/10/2026'];
    const horas = ['09:00', '14:59', '15:00', '15:01', '23:59', '00:00', '24:00', '9:00', ''];
    const minutos = [0, 1, 30, 1440, 1441, -5];
    const aberta = (o = {}) => ({ id: 'D0', kind: 'Operacional', area: 'Consulta', status: 'Pendente', issueType: 'Consulta ausente', clientId: '900013', client: 'Cliente', reason: 'x', reportedBy: 'Osíris', createdAt: '2026-10-11T10:00:00.000Z', tarotId: '9001', reporterTarotId: '9001', reportedDate: '2026-10-10', reportedTime: '09:00', ...o });
    for (const date of datas) for (const time of horas) for (const mins of minutos) for (const outras of [[], [aberta()], [aberta({ status: 'Resolvida' })], [aberta({ reporterTarotId: '9002', tarotId: '9002' })]]) {
      for (const clientId of ['900013', '']) {
        const entrada = { clientId, clientReference: clientId ? undefined : 'Maria', date, time, minutes: mins, tarotId: '9001' };
        ausentes.push({ entrada, outras, agora: AGORA, erro: m.missingConsultationError(entrada, outras, AGORA) });
      }
    }
    const base = { id: 'K1', clientId: '900013', client: 'Cliente', tarotId: '9001', tarot: 'Osíris', status: 'Concluída', startedAt: '2026-10-12T12:00:00.000Z', endedAt: '2026-10-12T12:20:00.000Z', durationSeconds: 1200, paymentProfile: 'Pós-paga', channel: 'WhatsApp', attendant: 'Khloe', observation: '', audit: [], commissionRate: 30, updatedAt: '2026-10-12T12:30:00.000Z', billing: { minimumMinutes: 15, minimumWaived: false, funding: [] } };
    const correcoes = [];
    for (const minutosNovos of [10, 20, 25, 25.5, 60, 0, -1]) for (const status of ['Concluída', 'Finalizada pelo tarólogo', 'Cancelada', 'Em curso']) {
      const item = { ...base, status };
      const nota = `Divergência D1; solicitada por Osíris: Tempo errado. Decisão: conferido`;
      let r;
      try { const out = corr.correctConsultationTime(item, minutosNovos, nota, 'Laya', '2026-10-12T16:00:00.000Z', item.updatedAt, { consultations: [item], payments: [], profile: undefined }); r = { ok: out }; } catch (e) { r = { erro: e instanceof Error ? e.message : String(e) }; }
      correcoes.push({ item, minutos: minutosNovos, nota, resultado: r });
    }
    fs.writeFileSync(path.join(__dirname, 'apoio-gf-divergencias', 'ouro-decisao-front.json'), JSON.stringify({ geradoDe: 'tarologist-divergences-model.ts e consultation-time-correction.ts do front', agora: AGORA, ausentes, correcoes }));
    console.log(`Ouro gravado: ${ausentes.length} casos de consulta ausente (${ausentes.filter((c) => c.erro).length} com erro), ${correcoes.length} correções (${correcoes.filter((c) => c.resultado.ok).length} aceitas).`);
  } finally { Date.now = realNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
