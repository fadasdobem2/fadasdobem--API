'use strict';

/**
 * Gera os CASOS DE OURO dos Recados (Maturacao/30) a partir do CÓDIGO do front: `painel/operational-note-model.ts` e `staff-note-compose-model.ts`.
 * Cada caso é uma transição que a TELA faz de verdade (criar, editar, apagar, responder, confirmar OK, fixar, arquivar, importância, recibo) com
 * as contas, a lista de antes e o resultado; o servidor tem de ACEITAR e reproduzir o resultado. Mais a matriz de visibilidade.
 *   node scripts/gerar-ouro-gf-recados.js --front=<pasta do front>      (saída: scripts/apoio-gf-recados/ouro-recados-front.json; tudo fictício)
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));

const conta = (id, role, extra = {}) => ({ id, name: `Conta ${id}`, email: `${id}@x.test`, role, commission: '', access: 'Acesso ativo', active: true, ...extra });
const CONTAS = { adm: conta('adm', 'administradora'), ass: conta('ass', 'assistente'), sup: conta('sup', 'supervisora'), ate: conta('ate', 'atendente'), osi: conta('osi', 'tarologa', { tarotId: 'osiris' }), nyx: conta('nyx', 'tarologa', { tarotId: 'nyx' }) };
const PERFIS = [{ id: 'osiris', name: 'Osíris' }, { id: 'nyx', name: 'Nyx' }].map((p) => ({ ...p, online: false, status: 'Offline', official: [], today: '', weeklySchedule: {}, note: '' }));
const T = (n) => new Date(Date.parse('2026-10-12T10:00:00.000Z') + n * 60000).toISOString();

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-recados', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const m = await vite.ssrLoadModule('/features/painel/operational-note-model.ts');
    const c = await vite.ssrLoadModule('/features/painel/staff-note-compose-model.ts');
    const tentar = (fn) => { try { return { ok: JSON.parse(JSON.stringify(fn() ?? null)) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };
    const contas = Object.values(CONTAS);
    const casos = [];
    let n = 0; const novoId = () => `n${++n}`;
    const det = (subject = 'Diversos', d = '2026-10-12') => ({ subject, startDate: d, endDate: d });
    const rascunho = (extra) => ({ kind: 'board', audience: 'staff', tarotId: 'osiris', personId: '', excludedIds: [], text: 'Osíris chega mais tarde', originalQuote: 'Vou chegar às 15h', details: det('Mudança de horário'), ...extra });
    const guardar = (nome, perfil, antes, depois, extra = {}) => casos.push({ nome, perfil, antes, depois, ...extra });

    // 1) Criação pela equipe.
    const rasc = [rascunho({}), rascunho({ important: true }), rascunho({ kind: 'message', audience: 'person', personId: 'ate', details: det() }),
      rascunho({ kind: 'message', audience: 'tarologist', tarotId: 'nyx', details: det() }), rascunho({ kind: 'message', audience: 'staff', details: det(), excludedIds: ['sup'] }),
      rascunho({ kind: 'message', audience: 'tarologists', details: det() }), rascunho({ text: '   ' }), rascunho({ details: det('Inexistente') }), rascunho({ kind: 'message', audience: 'person', personId: 'zzz' })];
    for (const [i, d] of rasc.entries()) for (const quem of ['adm', 'ate', 'sup']) {
      const r = tentar(() => c.staffNoteCreate(d, CONTAS[quem], contas, PERFIS, '2026-10-12', T(i), novoId()));
      guardar(`criar-equipe-${i}-${quem}`, quem, [], r.ok || null, { erro: r.erro || null, tipo: 'criar' });
    }
    // Estado base: uma raiz de quadro e uma mensagem, da atendente.
    const raizQuadro = c.staffNoteCreate(rascunho({}), CONTAS.ate, contas, PERFIS, '2026-10-12', T(10), 'base-quadro');
    const raizMsg = c.staffNoteCreate(rascunho({ kind: 'message', audience: 'tarologist', tarotId: 'osiris', details: det() }), CONTAS.ate, contas, PERFIS, '2026-10-12', T(11), 'base-msg');
    const base = [raizMsg, raizQuadro];
    // 2) Taróloga.
    const own = (extra) => tentar(() => m.ownOperationalNoteChange({ messages: [], account: CONTAS.osi, profile: PERFIS[0], date: '2026-10-12', text: 'Chego às 14h', details: det('Escala'), at: T(20), newId: novoId, ...extra }));
    const o1 = own({}); guardar('taro-cria', 'osi', [], o1.ok.note, { tipo: 'criar' });
    guardar('taro-cria-vazio', 'osi', [], null, { erro: own({ text: ' ' }).erro, tipo: 'criar', pedidoRuim: { ...o1.ok.note, text: ' ' } });
    const o2 = tentar(() => m.ownOperationalNoteChange({ messages: [o1.ok.note], account: CONTAS.osi, profile: PERFIS[0], date: '2026-10-12', text: 'Chego às 15h', id: o1.ok.note.id, at: T(21), newId: novoId }));
    guardar('taro-edita', 'osi', [o1.ok.note], o2.ok.note, { tipo: 'editar' });
    const o3 = tentar(() => m.ownOperationalNoteChange({ messages: [o2.ok.note], account: CONTAS.osi, profile: PERFIS[0], date: '2026-10-12', text: '', id: o1.ok.note.id, remove: true, at: T(22), newId: novoId }));
    guardar('taro-apaga', 'osi', [o2.ok.note], o3.ok.note, { tipo: 'editar' });
    // 3) Edição da equipe.
    const e1 = tentar(() => m.staffOperationalNoteChange({ messages: base, account: CONTAS.ate, role: 'atendente', id: 'base-quadro', text: 'Texto novo', details: det('Folga'), originalQuote: 'Citação nova', at: T(30) }));
    guardar('equipe-edita', 'ate', base, e1.ok.note, { tipo: 'editar' });
    const e2 = tentar(() => m.staffOperationalNoteChange({ messages: base, account: CONTAS.sup, role: 'supervisora', id: 'base-quadro', text: 'X', at: T(31) }));
    guardar('equipe-edita-de-outro', 'sup', base, null, { erro: e2.erro, tipo: 'editar', pedidoRuim: { ...raizQuadro, text: 'X', updatedAt: T(31), revisions: [{ version: raizQuadro.at, text: raizQuadro.text, at: T(31), by: 'x' }] } });
    // 4) Respostas e OK.
    const resp = (quem, role, alvo, lista, texto = 'Combinado') => tentar(() => m.operationalNoteReply({ notes: lista, targetId: alvo, text: texto, role, account: quem.role === 'tarologa' ? quem : undefined, profile: quem.role === 'tarologa' ? PERFIS.find((p) => p.id === quem.tarotId) : undefined, staffAccount: quem.role === 'tarologa' ? undefined : quem, authorName: quem.name, date: '2026-10-12', at: T(40), newId: novoId }));
    const r1 = resp(CONTAS.osi, 'tarologa', 'base-msg', base); guardar('taro-responde', 'osi', base, r1.ok.note, { tipo: 'criar' });
    const r2 = resp(CONTAS.sup, 'supervisora', 'base-quadro', base); guardar('equipe-responde', 'sup', base, r2.ok.note, { tipo: 'criar' });
    const r3 = resp(CONTAS.nyx, 'tarologa', 'base-msg', base); guardar('outra-taro-responde', 'nyx', base, null, { erro: r3.erro, tipo: 'criar', pedidoRuim: { ...r1.ok.note, id: 'x1', actorId: 'nyx', by: 'Conta nyx' } });
    const tarolista = { ...o1.ok.note };
    const ok = tentar(() => m.operationalNoteOk({ notes: [tarolista], targetId: tarolista.id, text: 'OK', role: 'atendente', staffAccount: CONTAS.ate, authorName: 'Conta ate', date: '2026-10-12', at: T(41), newId: novoId }));
    guardar('equipe-ok', 'ate', [tarolista], ok.ok.note, { tipo: 'criar' });
    // 5) Organização pessoal, arquivo, importância, recibo.
    const pin = tentar(() => m.notePersonalOrganizationChange({ notes: base, targetId: 'base-quadro', account: CONTAS.sup, kind: 'pinned', active: true, at: T(50) }));
    guardar('fixar', 'sup', base, pin.ok.note, { tipo: 'pessoal' });
    const pri = tentar(() => m.notePersonalOrganizationChange({ notes: base, targetId: 'base-quadro', account: CONTAS.sup, kind: 'prioritized', active: true, at: T(51) }));
    guardar('prioridade', 'sup', base, pri.ok.note, { tipo: 'pessoal' });
    const arq = tentar(() => m.staffNoteArchiveChange({ notes: base, targetId: 'base-quadro', account: CONTAS.sup, role: 'supervisora', archived: true, at: T(52) }));
    guardar('arquivar-equipe', 'sup', base, { ...arq.ok.root, archivedByAccount: { sup: arq.ok.archive } }, { tipo: 'pessoal' });
    const arqT = tentar(() => m.ownNoteArchiveChange({ notes: base, targetId: 'base-msg', account: CONTAS.osi, profile: PERFIS[0], archived: true, at: T(53) }));
    guardar('arquivar-taro', 'osi', base, { ...arqT.ok.root, archivedByAccount: { osi: arqT.ok.archive } }, { tipo: 'pessoal' });
    const imp = tentar(() => m.noteImportanceChange({ notes: base, targetId: 'base-quadro', account: CONTAS.ate, important: true, at: T(54) }));
    guardar('importancia', 'ate', base, imp.ok.note, { tipo: 'especial' });
    const imp2 = tentar(() => m.noteImportanceChange({ notes: base, targetId: 'base-quadro', account: CONTAS.sup, important: true, at: T(54) }));
    guardar('importancia-de-outro', 'sup', base, null, { erro: imp2.erro, tipo: 'especial', pedidoRuim: { ...raizQuadro, importance: { byId: 'sup', at: T(54) } } });
    const rec = tentar(() => m.operationalNoteReceipt({ note: raizMsg, role: 'tarologa', account: CONTAS.osi, profile: PERFIS[0], authorName: 'Conta osi', at: T(55) }));
    guardar('leitura-taro', 'osi', base, { ...raizMsg, ...rec.ok }, { tipo: 'pessoal' });
    const rec2 = tentar(() => m.operationalNoteReceipt({ note: raizQuadro, role: 'supervisora', account: CONTAS.sup, authorName: 'Conta sup', at: T(56) }));
    guardar('leitura-equipe', 'sup', base, { ...raizQuadro, ...rec2.ok }, { tipo: 'pessoal' });
    // 6) Visibilidade: cada nota x cada conta.
    const notas = [...base, r1.ok.note, o1.ok.note, resp(CONTAS.ate, 'atendente', 'base-quadro', base).ok.note];
    const visibilidade = notas.flatMap((nota) => contas.map((a) => ({ nota, conta: a.id, ok: m.canViewOperationalNote(nota, a) })));
    const saida = path.join(__dirname, 'apoio-gf-recados', 'ouro-recados-front.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'operational-note-model.ts e staff-note-compose-model.ts do front', contas: CONTAS, casos, notas, visibilidade }, null, 1)}\n`);
    console.log(`OK: ${casos.length} casos (${casos.filter((x) => x.erro).length} recusas do front), ${visibilidade.length} de visibilidade -> ${path.relative(process.cwd(), saida)}`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
