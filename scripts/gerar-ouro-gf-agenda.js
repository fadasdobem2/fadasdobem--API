'use strict';

/**
 * Gera os CASOS DE OURO da fatia Agenda a partir do código do front (Maturacao/29): roda `agendaQueueRevision` (impressão
 * `queue-v1`), `agendaIsClosed`, `agendaContactSnapshot` e `nextAgendaPosition` do front sobre 30 filas determinísticas e grava
 * entradas e saídas em scripts/apoio-gf-agenda/ouro-agenda.json. O verificador compara a API com este arquivo, byte a byte.
 *   node scripts/gerar-ouro-gf-agenda.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule), sem tocar nele. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

// Gerador pseudo-aleatório fixo: o mesmo ouro a cada execução.
let semente = 20261110;
const aleatorio = () => { semente = (Math.imul(semente, 1664525) + 1013904223) >>> 0; return semente / 4294967296; };
const sorteio = (lista) => lista[Math.floor(aleatorio() * lista.length)];

function fila(n) {
  const tarotId = sorteio(['osiris', 'nyx', 'afila', 'estrela']);
  const itens = [];
  for (let i = 0; i < n; i += 1) {
    const id = `ag-${Math.floor(aleatorio() * 1e6).toString(36)}${i}`;
    const item = { id, tarotId: aleatorio() < 0.15 ? 'nyx' : tarotId, position: i + 1, date: '2026-11-10', clientId: `${900000 + i}`, client: `Cliente ${i}`, time: '10:00', channel: 'WhatsApp', observation: '', response: 'Aguardando resposta', contact: { attempt: 1, date: '2026-11-10', tags: [] } };
    if (aleatorio() < 0.4) item.positionOverrides = { [`explicit:queue:${item.tarotId}`]: Math.floor(aleatorio() * 9) + 1 };
    if (aleatorio() < 0.2) item.positionOverrides = { ...(item.positionOverrides || {}), [`yield:queue:${item.tarotId}`]: i + 1 };
    if (aleatorio() < 0.25) item.orderCommand = { id: `cmd-${i}`, queueKey: `queue:${item.tarotId}`, baseRevision: 'queue-v1:0:x', at: '2026-11-10T10:00:00.000Z', actorRole: 'atendente', beforeIds: [], afterIds: [] };
    if (aleatorio() < 0.2) { item.agendaOutcome = sorteio(['Concluída', 'Cancelada']); item.contact = { ...item.contact, tags: [item.agendaOutcome] }; }
    if (aleatorio() < 0.15) item.contact = { attempt: 2, date: '2026-11-10', tags: ['Avisada', 'Vai pagar'] };
    if (aleatorio() < 0.1) item.contactHistory = [{ id: `ev-${i}`, actor: 'Teste', at: '2026-11-10T10:00:00.000Z', date: '2026-11-10', attempt: 1, tag: 'Avisada', active: true, before: [], after: ['Avisada'] }];
    itens.push(item);
  }
  return { tarotId, itens };
}

(async () => {
  const { createServer } = req('vite');
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent' });
  try {
    const ordem = await vite.ssrLoadModule('/features/agenda/agenda-order-command.ts');
    const contato = await vite.ssrLoadModule('/features/agenda/agenda-contact.ts');
    const casos = [];
    for (let k = 0; k < 30; k += 1) {
      const { tarotId, itens } = fila(1 + Math.floor(aleatorio() * 12));
      casos.push({
        tarotId, itens,
        revisao: ordem.agendaQueueRevision(itens, tarotId),
        encerrados: itens.map((i) => contato.agendaIsClosed(i)),
        fotos: itens.map((i) => JSON.parse(contato.agendaContactSnapshot(i))),
        proximaPosicao: contato.nextAgendaPosition(itens, tarotId, '2026-11-10'),
      });
    }
    const saida = path.join(__dirname, 'apoio-gf-agenda', 'ouro-agenda.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'features/agenda/agenda-order-command.ts e agenda-contact.ts do front', casos }, null, 1)}\n`);
    console.log(`${casos.length} casos de ouro em ${path.relative(process.cwd(), saida)}`);
  } finally { await vite.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
