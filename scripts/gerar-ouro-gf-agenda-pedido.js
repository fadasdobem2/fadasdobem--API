'use strict';

/**
 * Gera o OURO do pedido de agendamento, da identidade (cliente OU contato), do aviso manual, do retorno combinado e do "Pode agora" da Agenda
 * (v706 da Nice) A PARTIR DO CÓDIGO REAL DO FRONT:
 *   node scripts/gerar-ouro-gf-agenda-pedido.js --front=<pasta do FRONT com node_modules>
 * Grava scripts/apoio-gf-agenda/ouro-agenda-pedido.json. Cada caso = entrada + saída (ou a mensagem do erro) da função REAL do front.
 * Todo valor é fictício; modo real (sem o calendário de demonstração).
 */

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { alea, sorteio, chance, iso, soma, FONES, IDS, item, contato, pedido } = require('./apoio-gf-agenda/aleatorio-pedido');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'vite'))) { console.error('Informe --front=<pasta do FRONT com node_modules>.'); process.exit(2); }
const roda = (fn) => { try { const v = fn(); return { v: v === undefined ? null : v }; } catch (e) { return { e: e.message }; } };
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const HOJE_BASE = '2026-11-09';
// Relógio fixo: o front e o domínio da API leem Date.now() (sameAgendaOccurrence); sem isto o ouro depende da hora em que foi gerado.
require('./apoio-gf-agenda/relogio-fixo-pedido').fixar();

(async () => {
  process.env.FADAS_MODE = 'real';
  const { createServer } = await import(pathToFileURL(path.join(front, 'node_modules', 'vite', 'dist', 'node', 'index.js')).href);
  const vite = await createServer({ root: front, appType: 'custom', configFile: false, define: { __FADAS_NODE_ARTIFACT__: 'true' }, resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'error', cacheDir: '/private/tmp/fadas-ouro-agenda-pedido', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const l = (p) => vite.ssrLoadModule(p);
    const cal = await l('/features/domain/operation-calendar.ts');
    if (cal.DEMO_CALENDAR.enabled) throw new Error('o calendário de demonstração está ligado: o ouro precisa do modo real');
    const id = await l('/features/agenda/agenda-identity.ts');
    const im = await l('/features/agenda/agenda-intake-model.ts');
    const fila = await l('/features/agenda/request-queue-order.ts');
    const pc = await l('/features/agenda/consultation-request-contact.ts');
    const desfaz = await l('/features/agenda/request-client-link-undo.ts');
    const tempo = await l('/features/agenda/consultation-request-time.ts');
    const aviso = await l('/features/agenda/manual-agenda-notice.ts');
    const ret = await l('/features/agenda/agenda-contact-return.ts');
    const pronta = await l('/features/agenda/reader-ready-presence.ts');
    const lanc = await l('/features/agenda/agenda-launch-eligibility.ts');
    const hoje = cal.operationToday();
    const out = { hoje, gerado: 'agenda-identity, agenda-intake-model, request-queue-order, consultation-request-contact, request-client-link-undo, consultation-request-time, manual-agenda-notice, agenda-contact-return, reader-ready-presence, agenda-launch-eligibility (código real do front v706)' };
    const dia = (n) => soma(hoje, n);

    const identidades = () => ({ clientId: sorteio([undefined, '', ' ', '900001', ' 900002 ']), leadId: sorteio([undefined, '', ' ', 'lead-1', 'lead-2']) });
    out.identidade = N(300, () => {
      const a = identidades(); const b = identidades();
      const contatos = chance(0.5) ? N(3, (i) => contato(i + 1, { id: `lead-${i + 1}`, name: sorteio(['Ana', ' ']), whatsapp: sorteio(['+5511987654321', '', ' ']) })) : null;
      const p = pedido(1, { contactId: sorteio([undefined, 'lead-1']), clientId: sorteio(['', '900001', ' 900001 ']) });
      const it = item({ clientId: sorteio(['', '900001']), leadId: sorteio([undefined, 'lead-1']) });
      return { a, b, contatos, p, it, esperado: { chave: id.agendaIdentityKey(a), mesma: id.sameAgendaIdentity(a, b), erro: id.agendaIdentityError(a, contatos || undefined), doPedido: id.requestAgendaIdentity(p), combina: id.requestMatchesAgendaIdentity(p, it) } };
    });
    out.aplicarContato = N(300, (i) => {
      const alvo = sorteio(['900001', '900002', undefined]);
      const c = { id: 'lead-1', name: sorteio(['Ana', 'Ana Maria']), whatsapp: '+5511987654321', clientId: alvo, ...(chance(0.25) ? { identityUndo: { clientId: '900001', agendaIds: ['a1'], by: 'Khloe', at: iso(Date.parse('2026-11-09T12:00:00Z')) } } : {}) };
      const agenda = N(sorteio([1, 2, 3, 4]), (k) => item({ id: `a${k + 1}`, tarotId: sorteio(['osiris', 'nyx']), clientId: sorteio(['', '', '900001', '900002']), leadId: chance(0.7) ? 'lead-1' : sorteio([undefined, 'lead-2']), sourceLeadId: chance(0.2) ? 'lead-1' : undefined, date: sorteio([hoje, dia(1), dia(-1)]), client: sorteio(['Ana', 'Outro']), ...(chance(0.15) ? { agendaOutcome: 'Cancelada' } : {}) }));
      const ator = 'Khloe'; const em = '2026-11-09T15:00:00.000Z';
      const r = roda(() => { const novo = id.applyContactToAgenda(agenda, c, ator, em); return { igual: novo === agenda, agenda: novo }; });
      return { agenda, c, ator, em, hoje, esperado: r, i };
    });

    out.fone = [...FONES, ...N(120, () => sorteio(['+55', '55', '5511', '+5511 9 8765 4321', '(11) 98765-4321', '11 3456-7890', '+55 (11) 3456-7890', '0055 11 98765-4321', '11 08765-4321', '119876543', '+5527999990000', '+1415555', '(31) 3333-3333', '+5511987654321x']))].map((f) => ({ f, esperado: im.normalizeIntakeWhatsapp(f) ?? null }));
    out.valida = N(300, () => {
      const identidade = { clientId: sorteio(IDS), whatsapp: sorteio(FONES) };
      const candidatos = N(sorteio([0, 1, 2, 3]), (i) => ({ id: sorteio(['900001', '900002', '900003']), phone: sorteio(FONES), name: `c${i}` }));
      const r = im.validateIntakeIdentity(identidade, candidatos);
      return { identidade, candidatos, esperado: { error: r.error ?? null, client: r.client ? r.client.id : null, idx: r.client ? candidatos.indexOf(r.client) : -1 } };
    });
    out.contatos = N(200, () => {
      const contatos = N(sorteio([0, 1, 2, 4]), (i) => contato(i + 1));
      return { contatos, esperado: { codigo: im.nextAgendaContactCode(contatos), formatados: contatos.map((c) => im.formatAgendaContactCode(c.displayCode)), ativos: contatos.map((c) => im.activeAgendaContact(c)), vazio: im.formatAgendaContactCode(undefined) } };
    });
    out.resolver = N(400, () => {
      const contatos = N(sorteio([0, 1, 2, 3]), (i) => contato(i + 1, { whatsapp: sorteio(['+5511987654321', '+5521934567890', '']) }));
      const perfis = Object.fromEntries(['900001', '900002', '900003'].filter(() => chance(0.6)).map((k) => [k, { name: `P${k}`, whatsapp: sorteio(['+5511987654321', '+5521934567890', '', '+5531912345678']) }]));
      const diretorio = Object.fromEntries(Object.keys(perfis).filter(() => chance(0.8)).map((k) => [k, `D${k}`]));
      const identidade = { clientId: sorteio(['', '900001', '900002', '900009']), name: 'x', whatsapp: sorteio(['+5511987654321', '+5521934567890', '+5531912345678', '', 'x']) };
      const r = im.resolveIntakeContact(identidade, contatos, perfis, diretorio);
      return { identidade, contatos, perfis, diretorio, esperado: { clientId: r.clientId ?? null, contact: r.contact ? r.contact.id : null, ambiguous: r.ambiguous, error: r.error ?? null } };
    });
    out.duplicado = N(300, () => {
      const contatos = N(3, (i) => contato(i + 1, { id: `lead-${i}`, whatsapp: sorteio(['+5511987654321', '+5521934567890']), name: sorteio(['Ana', 'Bia']) }));
      const pedidos = N(sorteio([0, 1, 3]), (i) => pedido(i + 1, { tarotId: 'osiris', date: '2026-11-09', ...(chance(0.5) ? { contactId: `lead-${Math.floor(alea() * 3)}` } : {}) }));
      const candidato = pedido(99, { tarotId: chance(0.8) ? 'osiris' : 'nyx', date: chance(0.9) ? '2026-11-09' : '2026-11-10' });
      const achado = im.duplicateIntakeRequest(pedidos, candidato, chance(0.7) ? contatos : []);
      return { pedidos, candidato, contatos, comContatos: true, esperado: achado ? achado.id : null };
    });
    out.registro = N(250, () => {
      const registro = { events: [], contacts: N(sorteio([0, 1, 3]), (i) => contato(i + 1, { id: `lead-${i + 1}` })), requests: N(sorteio([1, 2, 4]), (i) => pedido(i + 1, { contactId: chance(0.6) ? `lead-${1 + Math.floor(alea() * 3)}` : undefined })) };
      return { registro, esperado: im.normalizeAgendaIntakeRecord(JSON.parse(JSON.stringify(registro))) };
    });
    out.procedencia = N(200, () => {
      const it = item({ createdAt: chance(0.8) ? '2026-11-08T10:00:00.000Z' : undefined, createdBy: chance(0.7) ? 'Khloe' : undefined,
        departures: chance(0.6) ? N(2, (i) => ({ action: sorteio(['cancel', 'reschedule', 'transfer']), actor: `A${i}`, at: iso(Date.parse('2026-11-08T10:00:00Z') + i * 3600000), restored: chance(0.2) })) : undefined,
        scheduleHistory: chance(0.5) ? [{ id: 'h1', actor: 'Rose', at: '2026-11-08T14:00:00.000Z' }] : undefined, resolutionHistory: chance(0.5) ? [{ action: sorteio(['Agendamento concluído', 'Consulta gerada', 'x']), actor: 'Lia', createdAt: '2026-11-08T18:00:00.000Z' }] : undefined });
      const acao = sorteio(['descheduled', 'rescheduled', 'agenda_closed', 'linked']);
      return { item: it, acao, observadoEm: '2026-11-09T09:00:00.000Z', esperado: im.agendaRequestChangeProvenance(it, acao, '2026-11-09T09:00:00.000Z') };
    });
    out.pedidoAgenda = N(400, () => {
      const p = pedido(1, { tarotId: 'osiris', date: hoje, clientId: sorteio(['', '900001']), contactId: sorteio([undefined, 'lead-1']), agendaId: chance(0.2) ? 'ag-9' : undefined });
      const agenda = N(sorteio([0, 1, 2, 3]), (k) => item({ id: `ag-${k + 1}`, tarotId: sorteio(['osiris', 'osiris', 'nyx']), clientId: sorteio(['', '900001']), leadId: sorteio([undefined, 'lead-1']), date: sorteio([hoje, hoje, dia(1)]), requestId: chance(0.1) ? 'rq-1' : undefined, ...(chance(0.15) ? { workflowStatus: 'Em consulta' } : {}) }));
      if (chance(0.2)) agenda.push(item({ id: 'ag-9', tarotId: 'osiris', clientId: '900001', date: hoje }));
      const consultas = chance(0.3) ? [{ id: 'c1', agendaItemId: sorteio(['ag-1', 'ag-2']), status: sorteio(['Em curso', 'Concluída']) }] : [];
      const a = im.requestAppointment(p, agenda); const e = im.eligibleRequestAppointment(p, agenda, consultas); const lig = im.linkedRequestAppointment(p, agenda);
      return { pedido: p, agenda, consultas, esperado: { direto: a ? a.id : null, elegivel: e ? e.id : null, ligado: lig ? lig.id : null, etapa: im.agendaRequestStage(p), pendente: im.agendaRequestPending(p) } };
    });
    out.fila = N(300, () => {
      const agendas = N(sorteio([0, 1, 2, 4]), (i) => ({ key: `agenda:a${i + 1}` }));
      const pedidos = N(sorteio([0, 1, 3, 4]), (i) => ({ key: `request:r${i + 1}`, request: { id: `r${i + 1}`, queuePlacement: chance(0.7) ? { beforeAgendaId: sorteio(['a1', 'a2', 'a9', undefined]), afterAgendaId: sorteio(['a1', 'a3', undefined]), order: sorteio([0, 1, 2, undefined]) } : undefined } }));
      const blocos = [...agendas, ...pedidos].sort(() => alea() - 0.5);
      const chaves = blocos.map((b) => b.key); const origem = sorteio([...chaves, 'zz']); const destino = sorteio([...chaves, undefined, 'zz']);
      const pedidosReais = pedidos.map((b) => ({ ...b.request, tarotId: 'osiris', date: hoje, stage: 'ask' }));
      return { blocos, chaves, origem, destino, pedidos: pedidosReais, esperado: { ordem: fila.arrangeRequestQueue(blocos).map((b) => b.key), mover: fila.moveRequestQueueBlock(chaves, origem, destino), lugares: fila.requestQueuePlacements(chaves), revisao: fila.requestQueueRevision(pedidosReais) } };
    });
    out.contatoPedido = N(400, () => {
      const p = pedido(1, { tarotId: 'osiris', date: hoje, contactId: sorteio([undefined, 'lead-1']) });
      if (chance(0.4)) Object.assign(p, { contact: { attempt: 1, date: hoje, tags: sorteio([[], ['Avisada'], ['Pode agora'], ['Não respondeu']]) }, contactHistory: chance(0.5) ? [{ id: 'e1', actor: 'K', at: '2026-11-09T10:00:00.000Z', date: hoje, attempt: 1, tag: 'Avisada', active: chance(0.8) }] : undefined, contactPlan: chance(0.4) ? { who: sorteio(['staff', 'client']), timing: 'none', callback: chance(0.5) } : undefined });
      const agenda = chance(0.25) ? [item({ id: 'ag-1', requestId: 'rq-1' })] : [];
      const alvo = item({ id: 'ag-2', clientId: '900001', ...(chance(0.3) ? { contact: { attempt: 1, date: hoje, tags: ['Pode agora'] } } : {}), ...(chance(0.2) ? { contactHistory: [{ id: 'z', actor: 'K', at: '2026-11-09T10:00:00.000Z', date: hoje, attempt: 1, tag: 'Avisada', active: true }] } : {}), ...(chance(0.15) ? { agendaOutcome: 'Cancelada' } : {}) });
      const projecao = pc.consultationRequestContactItem(p, agenda);
      const adotado = pc.adoptRequestContact(alvo, p);
      return { pedido: p, agenda, alvo, esperado: { projecao, etapa: pc.consultationRequestContactStage(p, projecao), adotado, mesmo: adotado === alvo, naoAchada: pc.requestHasNotFoundIdentity(p),
        erroPergunta: ['ask_reader', 'asked_reader', 'not_located', undefined].map((s) => pc.requestReaderInquiryError(p, s) ?? null), confirma: pc.requestCanConfirm(p), campos: pc.requestContactFields(projecao) } };
    });
    out.desfazer = N(300, () => {
      const c = contato(1, { clientId: sorteio(['900001', undefined]), clientLinkSnapshot: chance(0.8) ? { name: 'Ana', whatsapp: '+5511987654321', classification: 'lead', agendaIds: ['a1'], clientId: sorteio(['900001', '900002']) } : undefined });
      const agenda = N(sorteio([0, 1, 2]), (k) => item({ id: `a${k + 1}`, clientId: sorteio(['900001', '']), leadId: sorteio([undefined, 'lead-1']), sourceLeadId: sorteio(['lead-1', undefined]), ...(chance(0.15) ? { paymentAmount: 50 } : {}), ...(chance(0.1) ? { workflowStatus: 'Em consulta' } : {}) }));
      const consultas = chance(0.2) ? [{ id: 'c', agendaItemId: 'a1' }] : []; const pagamentos = chance(0.2) ? [{ movements: [{ agendaItemId: 'a1' }] }] : [];
      const esperado = chance(0.5) ? '900001' : undefined;
      return { contato: c, agenda, consultas, pagamentos, esperado0: esperado, esperado: desfaz.contactClientLinkUndoError(c, agenda, consultas, pagamentos, esperado) };
    });
    out.horario = ['', '9', '09', '24', '23', '7:5', '9:30', '09:60', '12:3', '1230', 'abc', ' 8 ', '8:00', '00:00', '23:59', '24:00'].map((t) => ({ t, esperado: tempo.normalizeRequestTime(t), mascara: tempo.maskRequestTime(t) }));
    out.avisoManual = N(600, () => {
      const itens = N(sorteio([1, 2]), (k) => { const lead = chance(0.4); return item({ id: `ag-${k + 1}`, clientId: lead ? '' : '900001', leadId: lead ? 'lead-1' : undefined, manualNotices: chance(0.2) ? [{ id: 'n0' }] : undefined, ...(chance(0.1) ? { workflowStatus: 'Em consulta' } : {}), contact: { attempt: 1, date: '2026-11-09', tags: [] } }); });
      const av = { id: chance(0.9) ? sorteio(['n1', 'n0']) : '', at: chance(0.92) ? '2026-11-09T10:00:00.000Z' : 'x', actorId: chance(0.92) ? 'u1' : '', actorName: chance(0.92) ? 'Rose' : '', recipientId: chance(0.85) ? sorteio(['900001', 'lead-1']) : 'zz', recipientName: 'Ana', recipientKind: sorteio(['client', 'lead']), channel: chance(0.8) ? sorteio(['Umbler', 'WhatsApp', 'Telefone']) : 'Email' };
      const agendaId = sorteio(['ag-1', 'ag-2', 'ag-9']);
      const r = roda(() => { const novo = aviso.recordManualAgendaNotice(itens, agendaId, av); return { igual: novo === itens, itens: novo }; });
      return { itens, agendaId, aviso: av, esperado: r };
    });
    out.retorno = N(300, () => {
      const agora = Date.parse(`${hoje}T${sorteio(['01:30', '05:59', '06:00', '09:10', '14:20', '23:50'])}:00-03:00`);
      const escolha = sorteio([{ kind: 'none' }, { kind: 'minutes', minutes: sorteio([10, 20, 30, 15]) }, { kind: 'time', time: sorteio(['10', '23:59', '03:00', '05:59', '06:00', '9h30', '25:00', 'abc', '14:20', '14:19']) }]);
      const it = item({ contactReturn: chance(0.6) ? { id: 'r', at: '2026-11-09T10:00:00.000Z', by: 'K', attempt: sorteio([1, 2]), afterEventId: sorteio(['e1', 'e2']), dueAt: '2026-11-09T20:00:00.000Z' } : undefined,
        contact: { attempt: 1, date: hoje, tags: sorteio([['Chama depois'], ['Avisada'], []]) }, contactHistory: [{ id: 'e1', actor: 'K', at: '2026-11-09T10:00:00.000Z', date: hoje, attempt: 1, tag: 'Chama depois', active: chance(0.8) }], ...(chance(0.1) ? { workflowStatus: 'Em consulta' } : {}) });
      const ativo = ret.activeAgendaContactReturn(it);
      return { agora, escolha, item: it, esperado: { prazo: roda(() => ret.agendaContactReturnDueAt(escolha, agora)), vigente: ativo ? ativo.id : null } };
    });
    out.pronta = N(400, () => {
      const agora = Date.parse(`${hoje}T${sorteio(['03:00', '07:00', '12:00', '22:00'])}:00-03:00`);
      const perfil = { id: 'osiris', name: 'Osíris', online: chance(0.7), status: 'Disponível', shiftStatus: sorteio([undefined, 'Disponível', 'Offline', 'Em consulta', 'Em pausa']), ...(chance(0.3) ? { presenceConfirmedAt: iso(agora - sorteio([1, 5, 30]) * 3600000) } : {}), ...(chance(0.2) ? { shiftAvailableSince: iso(agora - sorteio([1, 30]) * 3600000) } : {}), ...(chance(0.3) ? { presenceHistory: [{ at: iso(agora - sorteio([1, 30]) * 3600000), after: sorteio(['Disponível', 'Disponível · x', 'Offline']) }] } : {}) };
      const consultas = chance(0.3) ? [{ id: 'c1', tarotId: 'osiris', status: sorteio(['Em curso', 'Concluída']), durationSeconds: sorteio([0, 600]), startedAt: iso(agora - sorteio([1, 30]) * 3600000), awaitingTarologistStart: chance(0.3), tarologistStartedAt: chance(0.3) ? iso(agora - 3600000) : undefined }] : [];
      const tag = sorteio(['Pode agora', 'Pode agora', 'Avisada']);
      const it = item({ tarotId: sorteio(['osiris', 'afila', 'nyx']), contact: { attempt: 1, date: sorteio([hoje, dia(-1)]), tags: sorteio([[], ['Pode agora']]) } });
      return { tag, item: it, perfis: [perfil], consultas, date: hoje, agora, esperado: pronta.readyContactError(tag, it, [perfil], consultas, hoje, agora) ?? null };
    });
    out.bloqueio = N(200, () => {
      const it = item({ clientId: sorteio(['', '900001', ' ']), leadId: sorteio([undefined, 'lead-1', '']), date: hoje, ...(chance(0.15) ? { agendaOutcome: 'Cancelada' } : {}) });
      const agora = Date.parse(`${hoje}T12:00:00-03:00`);
      return { item: it, hoje, agora, esperado: lanc.agendaLaunchBlock(it, hoje, agora) ?? null };
    });

    const destino = path.join(__dirname, 'apoio-gf-agenda', 'ouro-agenda-pedido.json');
    fs.writeFileSync(destino, `${JSON.stringify(out)}\n`);
    console.log(Object.entries(out).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k}: ${v.length}`).join(' | '));
    console.log(`-> ${path.relative(process.cwd(), destino)}`);
  } finally { await vite.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
