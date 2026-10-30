'use strict';

/**
 * Gera o ouro do ciclo da Consulta (scripts/apoio-gf-consulta/ouro-consulta-front.json) A PARTIR DO CÓDIGO REAL DO FRONT:
 * `startTarologistConsultation`, `prepareStaffConsultationStart`, `pauseConsultation`, `resumeConsultation`, `reportTarologistFinish`,
 * `reportStaffFinish`, `requestTarologistMoreTime`, `cancelTarologistConsultation`, `requestFinishCorrection`, `commissionRateForNewConsultation`, `timeLimitFromMinutes`, `advanceConsultationClock`,
 * `resolveAgendaWithConsultation` e `reconcileAttendedAgenda`, com os cenários de scripts/apoio-gf-consulta/cenarios.js. Só precisa
 * rodar de novo quando o front mudar essas regras. Uso (o FRONT tem de ter node_modules):
 *   node scripts/gerar-ouro-gf-consulta.js --front=<pasta do FRONT com node_modules>
 * Nada no front é alterado. Roda o vite em modo SSR com a marca de artefato Node e FADAS_MODE=real (sem o calendário de demonstração).
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { CENARIOS } = require('./apoio-gf-consulta/cenarios');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }

const json = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error' });
  const cal = await vite.ssrLoadModule('/features/domain/operation-calendar.ts');
  if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
  const sessao = await vite.ssrLoadModule('/features/tarologas/tarologist-consultation-session.ts');
  const equipe = await vite.ssrLoadModule('/features/consultas/staff-consultation-start.ts');
  const pausaM = await vite.ssrLoadModule('/features/domain/consultation-pause.ts');
  const termino = await vite.ssrLoadModule('/features/tarologas/tarologist-finish-report.ts');
  const comissao = await vite.ssrLoadModule('/features/finance/tarologist-commission-policy.ts');
  const limite = await vite.ssrLoadModule('/features/domain/consultation-time-limit.ts');
  const cancelamento = await vite.ssrLoadModule('/features/tarologas/tarologist-cancellation.ts');
  const resolucao = await vite.ssrLoadModule('/features/agenda/agenda-consultation-resolution.ts');
  const PERFIL = { atendente: 'atendente', tarologa: 'tarologa' };
  const saida = [];
  for (const c of CENARIOS) {
    let r;
    try {
      if (c.tipo === 'iniciar') r = { item: json(sessao.startTarologistConsultation(c.item, c.tarotId, c.ator, c.agora, [c.item, ...c.outras])) };
      else if (c.tipo === 'iniciar-equipe') {
        const out = equipe.prepareStaffConsultationStart({ consultations: [c.item], profile: { id: c.tarotId }, consultationId: c.item.id, actor: { id: 'u1', name: c.ator }, role: 'atendente', date: '2026-11-10', now: Date.parse(c.agora) });
        r = { item: json(out.consultation) };
      } else if (c.tipo === 'pausar') r = { item: json(pausaM.pauseConsultation(c.item, c.ator, c.agora, { role: PERFIL[c.perfil], ownTarotId: c.tarotIdProprio })) };
      else if (c.tipo === 'retomar') r = { item: json(pausaM.resumeConsultation(c.item, c.ator, c.agora)) };
      else if (c.tipo === 'termino') r = { item: json(termino.reportTarologistFinish(c.item, c.minutos, c.tarotId, c.ator, c.agora, undefined, c.antecipado, c.opcoes)) };
      else if (c.tipo === 'termino-equipe') r = { item: json(termino.reportStaffFinish(c.item, c.minutos, c.ator, c.agora, { payments: [], consultations: [c.item] })) };
      else if (c.tipo === 'mais-tempo') r = { item: json(termino.requestTarologistMoreTime(c.item, c.tarotId, c.ator, c.agora)) };
      else if (c.tipo === 'devolver') {
        const out = cancelamento.cancelTarologistConsultation({ consultationId: c.item.id, ...c.entrada }, { tarotId: c.tarotId, tarotName: c.ator, now: c.agora, consultations: [c.item], payments: [], agenda: [] });
        const { billing: _cobranca, ...semCobranca } = json(out.consultation); r = { item: semCobranca };
      } else if (c.tipo === 'correcao') r = { item: json(termino.requestFinishCorrection(c.item, c.minutos, c.motivo, c.tarotId, c.ator, c.agora)) };
      else if (c.tipo === 'comissao') r = { taxa: comissao.commissionRateForNewConsultation(c.taxa === undefined ? undefined : { commissionRate: c.taxa }, c.origem) };
      else if (c.tipo === 'limite') r = { limite: json(limite.timeLimitFromMinutes(c.minutos, c.perfil)) };
      else if (c.tipo === 'relogio') r = { duracao: sessao.advanceConsultationClock(c.item, Date.parse(c.item.tarologistStartedAt || c.item.startedAt), Date.parse(c.agora)).durationSeconds };
      else if (c.tipo === 'agenda-inicio') r = { item: json(resolucao.resolveAgendaWithConsultation(c.agenda, c.visita, 'Atendimento', c.agora, '2026-11-10', false)) };
      else if (c.tipo === 'agenda-fim') r = { item: json(resolucao.reconcileAttendedAgenda([c.agenda], [c.visita], Date.parse(c.agora))[0]) };
    } catch (e) { r = { erro: e.message }; }
    saida.push({ nome: c.nome, tipo: c.tipo, ...r });
  }
  await vite.close();
  const destino = path.join(__dirname, 'apoio-gf-consulta', 'ouro-consulta-front.json');
  fs.writeFileSync(destino, `${JSON.stringify({ gerado: 'a partir do código do front (tarologist-consultation-session, consultation-pause, tarologist-finish-report, staff-consultation-start, tarologist-commission-policy, consultation-time-limit, agenda-consultation-resolution)', cenarios: saida }, null, 1)}\n`);
  console.log(`${saida.length} cenários gravados em ${path.relative(process.cwd(), destino)} (${saida.filter((s) => s.erro).length} com recusa)`);
})().catch((e) => { console.error(e); process.exit(2); });
