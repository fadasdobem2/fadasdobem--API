'use strict';

/**
 * Gera os CASOS DE OURO das divergências (Maturacao/31) a partir do CÓDIGO do front: `tarologist-divergences-model.ts`
 * (`changeReaderDivergence`, `appendDivergenceComment`, `clearReaderDivergenceTrash`, `readerDivergences`, `missingConsultationError`) e
 * `domain/divergence-state.ts`. Grava entradas e saídas em scripts/apoio-gf-divergencias/ouro-divergencias-front.json.
 *   node scripts/gerar-ouro-gf-divergencias.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

let semente = 20261116;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (l) => l[Math.floor(aleatorio() * l.length)];
const chance = (p) => aleatorio() < p;

const AGORA = Date.parse('2026-10-20T15:00:00-03:00');
const iso = (ms) => new Date(ms).toISOString();
const minutos = (n) => n * 60000;
const TAROT = 'osiris';

const snap = (it) => ({ reason: it.reason, status: it.status });

function item(i) {
  const issueType = sorteio(['Consulta ausente', 'Profissional incorreto', 'Minutagem incorreta', 'Outro', undefined]);
  const base = { id: `DIV-g${i}`, kind: 'Operacional', area: 'Consulta', clientId: chance(0.85) ? String(900010 + i) : '', client: `Cliente ${i}`, tarotId: TAROT, tarot: 'Osíris', reporterTarotId: chance(0.9) ? TAROT : undefined,
    reason: `Relato ${i}`, status: 'Pendente', reportedBy: 'Osíris', createdAt: iso(AGORA - minutos(600 + i)) };
  if (issueType) base.issueType = issueType;
  if (chance(0.7)) base.consultationId = `C-${i}`;
  if (issueType === 'Minutagem incorreta') { base.recordedMinutes = 12; base.reportedMinutes = sorteio([20, 30]); }
  if (issueType === 'Consulta ausente') { base.reportedMinutes = 25; base.reportedDate = '2026-10-19'; base.reportedTime = sorteio(['10:00', '14:30']); base.reportedChannel = 'WhatsApp'; if (!base.clientId) { base.clientIdentificationPending = true; base.reportedClientName = 'Maria'; } }
  if (chance(0.4)) base.reportNote = 'Nota do relato.';
  const sorte = aleatorio();
  if (sorte < 0.25) base.status = 'Em conferência';
  else if (sorte < 0.4) Object.assign(base, { status: 'Resolvida', resolvedBy: 'Clara', resolvedAt: iso(AGORA - minutos(300)), decision: 'Conferido.' });
  else if (sorte < 0.6) Object.assign(base, { status: 'Arquivada', statusBeforeArchive: sorteio(['Pendente', 'Resolvida']), archivedAt: iso(AGORA - minutos(200)), archivedBy: 'Osíris', archiveReason: 'Motivo.' });
  if (base.status === 'Arquivada' && base.statusBeforeArchive === 'Resolvida') Object.assign(base, { resolvedBy: 'Clara', resolvedAt: iso(AGORA - minutos(400)), decision: 'Conferido.' });
  if (chance(0.15)) Object.assign(base, { deletedAt: iso(AGORA - minutos(100)), deletedBy: 'Osíris', deleteReason: 'Engano.' });
  if (base.deletedAt && chance(0.3)) Object.assign(base, { readerTrashClearedAt: iso(AGORA - minutos(50)), readerTrashClearedBy: 'Osíris' });
  if (chance(0.3)) base.history = [{ id: `h${i}`, at: iso(AGORA - minutos(700)), actor: 'Osíris', action: 'Relato editado', before: snap(base), after: snap(base) }];
  if (chance(0.3)) base.comments = [{ id: `c${i}`, at: iso(AGORA - minutos(650)), actor: 'Osíris', text: 'Nota.', source: 'tarologist' }];
  base.updatedAt = base.history ? base.history[0].at : base.createdAt;
  return base;
}

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-divergencias', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const modelo = await vite.ssrLoadModule('/features/tarologas/tarologist-divergences-model.ts');
    const estado = await vite.ssrLoadModule('/features/domain/divergence-state.ts');
    const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    const casos = []; const recusas = []; const visibilidade = [];
    for (let i = 0; i < 400; i += 1) {
      const lista = Array.from({ length: 1 + Math.floor(aleatorio() * 3) }, (_, k) => item(i * 10 + k));
      const alvo = lista[0];
      const at = iso(AGORA + minutos(i));
      const contexto = { tarotId: TAROT, actor: 'Osíris', at, version: estado.divergenceVersion(alvo) };
      const mudanca = sorteio([
        () => ({ kind: 'edit', values: { note: 'Nova nota.', minutes: sorteio([12, 30, 45]), date: '2026-10-19', time: sorteio(['10:00', '11:15']), channel: 'Telefone' } }),
        () => ({ kind: 'archive', reason: 'Já conferi.' }), () => ({ kind: 'delete', reason: 'Enviei por engano.' }),
        () => ({ kind: 'comment', text: 'Mais um detalhe.' }), () => ({ kind: 'restore' }), () => ({ kind: 'trash' }),
      ])();
      const r = mudanca.kind === 'trash'
        ? tentar(() => modelo.clearReaderDivergenceTrash(lista, [{ id: alvo.id, version: estado.divergenceVersion(alvo) }], { tarotId: TAROT, actor: 'Osíris', at }))
        : tentar(() => modelo.changeReaderDivergence(lista, alvo.id, mudanca, contexto));
      if (r.erro) { recusas.push({ antes: alvo, mudanca, erro: r.erro }); continue; }
      const depois = r.ok.find((x) => x.id === alvo.id);
      if (JSON.stringify(depois) === JSON.stringify(alvo)) continue;
      casos.push({ antes: alvo, depois, mudanca: mudanca.kind, outras: lista.slice(1), at });
    }
    // Comentário da equipe (appendDivergenceComment com source "staff"): o único trecho puro da equipe.
    const staff = [];
    for (let i = 0; i < 60; i += 1) {
      const alvo = item(5000 + i);
      const r = tentar(() => modelo.appendDivergenceComment([alvo], alvo.id, 'Comentário da equipe.', { actor: 'Clara', at: iso(AGORA + minutos(i)), source: 'staff', role: sorteio(['administradora', 'assistente', 'supervisora', 'atendente']), version: estado.divergenceVersion(alvo) }));
      if (r.ok) staff.push({ antes: alvo, depois: r.ok[0] }); else recusas.push({ antes: alvo, mudanca: { kind: 'staff-comment' }, erro: r.erro });
    }
    // Visibilidade da taróloga.
    for (let i = 0; i < 120; i += 1) {
      const it = item(9000 + i); if (chance(0.3)) it.kind = 'Financeira';
      visibilidade.push({ item: it, visivel: modelo.readerDivergences([it], TAROT).length === 1, dela: modelo.ownsReaderDivergence(it, TAROT), aberta: estado.isOpenDivergence(it), outra: modelo.readerDivergences([it], 'outra').length === 1 });
    }
    const saida = path.join(__dirname, 'apoio-gf-divergencias', 'ouro-divergencias-front.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'features/tarologas/tarologist-divergences-model.ts e domain/divergence-state.ts', tarotId: TAROT, casos, staff, recusas: recusas.length, visibilidade }, null, 1));
    const porTipo = {}; for (const c of casos) porTipo[c.mudanca] = (porTipo[c.mudanca] || 0) + 1;
    console.log(`ouro gravado: ${casos.length} mudanças aceitas pelo front (${JSON.stringify(porTipo)}), ${staff.length} comentários da equipe, ${recusas.length} recusas do front, ${visibilidade.length} visibilidades`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
