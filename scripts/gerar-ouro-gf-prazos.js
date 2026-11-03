'use strict';

/**
 * Gera o OURO dos prazos de atendimento (Maturacao/56 grupo D) a partir do CÓDIGO REAL do front, com `Date.now` travado por caso:
 * `commonAgendaWait`, `requestedWaitTiming`, `panelContactClock`, `panelReadyWaitAlert`, `panelContactWaitAlert`, `panelWaitingDeadlineExpired`,
 * `panelWaitingNeedsAttention`, `moreTimeAgendaWait` e `readerShiftEnd` (fim de turno). Casos aleatórios com semente fixa MAIS bordas exatas
 * (4:59.999, 5:00, 9:59.999, 10:00, 14:59.999, 15:00, virada das 06:00 e do dia civil) e mutantes. Grava scripts/apoio-gf-prazos/ouro-prazos-front.json.
 *   node scripts/gerar-ouro-gf-prazos.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real, sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');
const { casoDeEspera, casoDeTurno, AGORAS, ATRASOS, clonar, iso } = require('./apoio-gf-prazos/cenarios');
const { MUTANTES } = require('./apoio-gf-prazos/mutantes');
const { resumirEspera, resumirTurno } = require('./apoio-gf-prazos/resumo');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

/** Caso mínimo de borda: uma cliente com a etapa iniciada exatamente `atraso` ms antes de `agora`. */
function casoDeBorda(tags, atraso, agora, n) {
  const dia = new Date(agora - 9 * 3600000).toISOString().slice(0, 10);
  const item = { id: `b${n}`, clientId: `cb${n}`, client: 'Cliente', tarotId: 'afila', date: dia, time: '09:00', createdAt: iso(agora - 5 * 3600000), channel: 'Telefone', observation: '', response: 'Aguardando resposta', position: 1, contact: { attempt: 1, date: dia, tags }, contactHistory: [] };
  item.contactHistory = tags.map((t, k) => ({ id: `${item.id}-${t}`, actor: 'Equipe', at: iso(agora - atraso + k), date: dia, attempt: 1, tag: t, active: true, before: [], after: tags.slice(0, k + 1) }));
  return { agora, entrada: { agenda: [item], consultations: [], payments: [], date: dia, now: agora }, item: item.id, perfil: null, continuacao: false };
}

/** Etapa de pagamento com um recibo informado logo depois da promessa (parcial, total, a confirmar). */
function casoDePagamento(atraso, valor, confirmacao, agora, n) {
  const c = casoDeBorda(['Vai pagar'], atraso, agora, n); const item = c.entrada.agenda[0]; item.paymentExpectedAmount = 88.8;
  c.entrada.payments.push({ id: `pg${n}`, clientId: item.clientId, client: 'C', amount: valor, status: 'Informado', ...(confirmacao ? { confirmation: confirmacao } : {}), method: 'PIX', paidAt: iso(agora - atraso + 5000), informedAt: iso(agora - atraso + 5000) });
  return c;
}
/** Continuação (pedido de mais tempo): aviso ou promessa há `atraso` ms, com ou sem recibo. */
function casoDeMaisTempo(tags, atraso, agora, n, valor) {
  const c = casoDeBorda(tags, atraso, agora, n); const item = c.entrada.agenda[0]; item.tarotId = 'r1';
  c.entrada.consultations.push({ id: 'korigem', clientId: item.clientId, client: 'Cliente', tarotId: 'r1', tarot: 'Leitora', status: 'Concluída', startedAt: iso(agora - 90 * 60000), endedAt: iso(agora - 40 * 60000), durationSeconds: 1200, audit: [], tarologistMoreTimeRequest: { active: true, requestedAt: iso(agora - 50 * 60000), reporterName: 'Leitora' } });
  item.continuationRequest = { sourceConsultationId: 'korigem', requestedAt: iso(agora - 50 * 60000), requestedBy: 'Leitora' };
  if (valor) c.entrada.payments.push({ id: `pm${n}`, clientId: item.clientId, client: 'C', amount: valor, status: 'Informado', method: 'PIX', paidAt: iso(agora - atraso + 5000), informedAt: iso(agora - atraso + 5000) });
  c.continuacao = true; return c;
}

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-prazos', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  const dateNow = Date.now;
  try {
    const cw = await vite.ssrLoadModule('/features/agenda/agenda-common-deadlines.ts');
    const rw = await vite.ssrLoadModule('/features/agenda/agenda-requested-wait.ts');
    const lf = await vite.ssrLoadModule('/features/agenda/agenda-launch-funding.ts');
    const cc = await vite.ssrLoadModule('/features/painel/panel-contact-clock.ts');
    const wd = await vite.ssrLoadModule('/features/painel/panel-waiting-deadline.ts');
    const mt = await vite.ssrLoadModule('/features/consultas/more-time-agenda.ts');
    const se = await vite.ssrLoadModule('/features/painel/panel-reader-shift-end.ts');
    const fns = {
      esperaComum: (i, e, p) => cw.commonAgendaWait(i, e, p), financiado: (i, e, p) => lf.agendaLaunchFunding(i, e, p).funded, prazoPedido: (i, n, e, p) => rw.requestedWaitTiming(i, n, e, p),
      relogioDeContato: (a) => cc.panelContactClock(a), inicioDoPodeAgora: (i, d) => cc.panelReadyStartedAt(i, d), alertaDeProntaEsperando: (a) => cc.panelReadyWaitAlert(a), alertaDeContatoEsperando: (a) => cc.panelContactWaitAlert(a),
      prazoDeEsperaExpirado: (i, e, p, w) => wd.panelWaitingDeadlineExpired(i, e, p, w), esperaPrecisaDeAtencao: (i, e, p, w) => wd.panelWaitingNeedsAttention(i, e, p, w),
      esperaDoMaisTempo: (o, i, c, pg, n, p) => mt.moreTimeAgendaWait(o, i, c, pg, n, p), fimDoTurno: (p, o, d, n) => se.readerShiftEnd(p, o, d, n),
    };
    const casos = []; const nomes = Object.keys(MUTANTES);
    const estat = { espera: 0, bordas: 0, mutantes: 0, mutantesQueMudam: 0, pausaParcial: 0, manual: 0, expiradas: 0, atencao: 0, maisTempo: 0, turnos: 0, fimBreve: 0, comRotulo: 0 };
    const montar = (c, n, borda) => {
      const ent = clonar(c.entrada);
      Date.now = () => c.agora;
      const base = resumirEspera(fns, ent, c.item, c.perfil);
      const caso = { agora: c.agora, borda, entrada: clonar(ent), item: c.item, perfil: c.perfil, esperado: base, mutantes: [] };
      if (base.wait && base.wait.expired) estat.expiradas += 1; if (base.wait && base.wait.attention) estat.atencao += 1; if (base.wait && base.wait.manual) estat.manual += 1; if (base.wait && base.wait.automationPaused) estat.pausaParcial += 1; if (base.maisTempo) estat.maisTempo += 1;
      if (!borda) {
        const quantos = 2; for (let m = 0; m < quantos; m += 1) {
          const nome = nomes[(n * 7 + m * 5) % nomes.length]; const mut = MUTANTES[nome](ent);
          Date.now = () => c.agora;
          const resultado = resumirEspera(fns, mut, c.item, c.perfil);
          const muda = JSON.stringify(resultado) !== JSON.stringify(base); estat.mutantes += 1; if (muda) estat.mutantesQueMudam += 1;
          caso.mutantes.push({ nome, entrada: mut, esperado: resultado, muda });
        }
      }
      return caso;
    };
    let n = 0;
    for (let k = 0; k < 700; k += 1) { casos.push(montar(casoDeEspera(k), n, false)); n += 1; estat.espera += 1; }
    // bordas exatas: etapa iniciada há `atraso` ms, em cada relógio de referência
    const ETAPAS = [['Avisada'], ['Vai pagar'], ['Avisada', 'Pode agora'], ['Pode agora'], ['Avisada', 'Vai pagar']];
    for (const agora of AGORAS) for (const tags of ETAPAS) for (const atraso of ATRASOS) { casos.push(montar(casoDeBorda(tags, atraso, agora, n), n, true)); n += 1; estat.bordas += 1; }
    for (const agora of AGORAS.slice(0, 2)) for (const atraso of ATRASOS) {
      for (const valor of [20, 44.4, 88.8, 0]) for (const conf of [undefined, 'Confirmado', 'A confirmar']) { casos.push(montar(casoDePagamento(atraso, valor, conf, agora, n), n, true)); n += 1; estat.bordas += 1; }
      for (const tags of [['Avisada'], ['Vai pagar'], ['Avisada', 'Pode agora'], ['Avisada', 'Vai pagar']]) for (const valor of [0, 44.4, 150]) { casos.push(montar(casoDeMaisTempo(tags, atraso, agora, n, valor), n, true)); n += 1; estat.bordas += 1; }
    }
    const turnos = [];
    for (let k = 0; k < 1500; k += 1) {
      const c = casoDeTurno(k); Date.now = () => c.now;
      const esperado = resumirTurno(fns, c); estat.turnos += 1; if (esperado && esperado.endingSoon) estat.fimBreve += 1; if (esperado && esperado.timeLabel) estat.comRotulo += 1;
      turnos.push({ ...c, esperado });
    }
    // horário de verão histórico (limite conhecido do servidor: UTC-3 fixo): o front (Intl) mostra -2 no verão antigo
    const historico = [];
    for (const dia of ['2018-12-20', '2018-11-10', '2018-10-10', '2017-12-20', '2019-01-15']) {
      for (const hora of ['18:00', '23:00']) {
        const c = { perfil: { id: 'r1', name: 'Ana', online: true, status: 'Disponível', official: [], today: '', note: '', weeklySchedule: Object.fromEntries(['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'].map((d) => [d, '9h às 23h'])) }, overrides: {}, date: dia, now: Date.parse(`${dia}T${hora}:00-03:00`) - 10 * 60000 };
        Date.now = () => c.now; historico.push({ ...c, esperado: resumirTurno(fns, c) });
      }
    }
    Date.now = dateNow;
    const saida = path.join(__dirname, 'apoio-gf-prazos', 'ouro-prazos-front.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'agenda-common-deadlines.ts, agenda-requested-wait.ts, agenda-launch-funding.ts, panel-contact-clock.ts, panel-waiting-deadline.ts, more-time-agenda.ts, panel-reader-shift-end.ts do front, com Date.now travado por caso', casos, turnos, historico })}\n`);
    console.log(`OK: ${casos.length} casos de espera (${estat.bordas} bordas), ${estat.expiradas} expiradas, ${estat.atencao} em atenção, ${estat.manual} com prazo combinado, ${estat.pausaParcial} em pausa por pagamento parcial, ${estat.maisTempo} de mais tempo; ${estat.mutantes} mutantes (${estat.mutantesQueMudam} mudam o resultado); ${turnos.length} turnos (${estat.fimBreve} acabando, ${estat.comRotulo} com rótulo); ${historico.length} históricos de verão.`);
  } finally { Date.now = dateNow; await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
