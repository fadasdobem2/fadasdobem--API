'use strict';

/**
 * Cenários de ouro da AGENDA (Maturacao/44): roda as funções REAIS do front (contato, plano, observações, prazo, saídas, estorno) sobre
 * muitos estados e grava, por cenário, o item de antes, os comandos que `planAgendaCommands` REAL manda à API e o resumo do item
 * que o front mostra depois. O verificador reproduz os comandos no servidor e exige o MESMO item. As recusas do front (frases) viram
 * cenários de recusa com o que o navegador mandaria sem a conferência.
 */

const { sorteador, tentar } = require('./front');

const DIA = '2026-11-10'; const AMANHA = '2026-11-11';
const AGORA = '2026-11-10T15:00:00.000Z';
const ATOR = 'Clara';
const ETIQUETAS = ['Chamar cliente', 'Cliente vai chamar', 'Avisada', 'Pode agora', 'Não respondeu', 'Vai pagar', 'Não voltou', 'Não pode', 'Não pode agora', 'Chama depois', 'Avisar de novo', 'Em consulta', 'Concluída', 'Adiada', 'Cancelada', 'Próximo turno', 'Pediu estorno'];
const MOTIVOS_CANCELAR = ['Desistiu', 'Sem resposta', 'Não quis esperar', 'Não pôde esperar', 'Recusou amanhã', 'Pediu estorno', 'Erramos o tarólogo'];
const MOTIVOS_TRANSFERIR = ['Pediu outro tarólogo', 'Não quis esperar', 'Não pôde esperar', 'Erramos o tarólogo', 'Desistiu'];
const INCIDENTES = [undefined, 'Sem retorno', 'Ausente', 'Saiu cedo', 'Cliente desistiu/não podia', 'Lançamento errado', 'Não deu tempo', 'Tarólogo não respondeu', 'Tarólogo faltou'];
const PLANOS = [
  { who: 'staff', timing: 'none' }, { who: 'client', timing: 'none', callback: true }, { who: 'staff', timing: 'exact', time: '20:00' }, { who: 'staff', timing: 'exact', time: '8h' },
  { who: 'client', timing: 'approximate', time: '9:30' }, { who: 'staff', timing: 'after', time: '19h30', callback: true }, { who: 'staff', timing: 'shift', shift: { label: 'Noite', start: '18:00', end: '23:00' }, callback: true },
  { who: 'staff', timing: 'exact', time: '25:00' }, { who: 'staff', timing: 'exact', time: 'tarde' }, { who: 'staff', timing: 'shift', shift: { label: ' ', start: '18:00', end: '23:00' } },
  { who: 'staff', timing: 'shift', shift: { label: 'X', start: '18:00', end: '18:00' } }, { who: 'staff', timing: 'shift' }, { who: 'x', timing: 'none' }, { who: 'staff', timing: 'y' },
];

const base = (i, extra = {}) => ({
  id: `ag-${i}`, tarotId: 'osiris', time: '10:00', clientId: `${900000 + i}`, client: `Cliente ${i}`, channel: 'WhatsApp', observation: '', response: 'Aguardando resposta',
  position: i + 1, date: DIA, createdAt: '2026-11-10T09:00:00.000Z', createdBy: 'Clara', contact: { attempt: 1, date: DIA, tags: [] }, ...extra,
});

async function gerar(ctx) {
  const ct = await ctx.carregar('/features/agenda/agenda-contact.ts');
  const pl = await ctx.carregar('/features/agenda/agenda-contact-plan.ts');
  const ob = await ctx.carregar('/features/agenda/agenda-observations.ts');
  const rw = await ctx.carregar('/features/agenda/agenda-requested-wait.ts');
  const tr = await ctx.carregar('/features/agenda/agenda-transitions.ts');
  const plan = await ctx.carregar('/features/integration/agenda/real-agenda-plan.ts');
  const { sorteio, alea, inteiro } = sorteador(20261130);

  // 1) Estados: cadeias aleatórias de toggles reais (contato) mais acessórios (observações, prazo, saídas, plano).
  const estados = [base(0)];
  for (let i = 1; i <= 90; i += 1) {
    let item = base(i, { date: sorteio([DIA, AMANHA]) });
    item.contact = { attempt: 1, date: item.date, tags: [] };
    const passos = inteiro(0, 6);
    for (let k = 0; k < passos; k += 1) {
      const dia = sorteio([DIA, DIA, AMANHA]);
      item = ct.toggleAgendaTag(item, sorteio(ETIQUETAS), ATOR, `2026-11-10T1${k}:00:00.000Z`, dia, alea() < 0.2, undefined, alea() < 0.2 ? 'activate' : 'toggle');
    }
    if (alea() < 0.2) item = ob.changeAgendaObservation(item, { id: `o-${i}`, action: 'add', observationId: `n-${i}`, text: 'Pediu horário.' }, ATOR, '2026-11-10T11:00:00.000Z');
    if (alea() < 0.15 && !ct.agendaIsClosed(item) && item.workflowStatus !== 'Em consulta') item = { ...item, requestedWaitHistory: [{ id: `w-${i}`, minutes: 30, at: '2026-11-10T11:30:00.000Z', by: ATOR, attempt: item.contact.attempt, afterEventId: item.contactHistory?.at(-1)?.id || '' }] };
    if (alea() < 0.15) item = { ...item, contactPlan: sorteio(PLANOS.slice(0, 7)) };
    if (alea() < 0.1) item = { ...item, standbyDate: DIA, date: AMANHA };
    estados.push(item);
  }
  // Estados notáveis garantidos.
  const encerrado = ct.toggleAgendaTag(base(100), 'Concluída', ATOR, AGORA, DIA, true);
  const cancelado = ct.toggleAgendaTag(base(101), 'Cancelada', ATOR, AGORA, DIA, true);
  const emConsulta = ct.toggleAgendaTag(base(102), 'Em consulta', ATOR, AGORA, DIA, true);
  const avisada = ct.toggleAgendaTag(base(103), 'Avisada', ATOR, AGORA, DIA);
  const estorno = ct.toggleAgendaTag(encerrado, 'Pediu estorno', ATOR, AGORA, DIA);
  estados.push(encerrado, cancelado, emConsulta, avisada, estorno, ct.restoreAgendaContact(cancelado));

  const cenarios = [];
  const unicos = new Map();
  const ref = (item) => { const k = JSON.stringify(item); if (!unicos.has(k)) unicos.set(k, unicos.size); return unicos.get(k); };
  const registrar = (acao, antes, depois, extra = {}) => {
    if (depois === antes || JSON.stringify(depois) === JSON.stringify(antes)) { cenarios.push({ tipo: 'nada', acao, ...extra, antes: ref(antes) }); return; }
    const comandos = plan.planAgendaCommands([antes], [depois]);
    cenarios.push({ tipo: 'comando', acao, ...extra, antes: ref(antes), comandos, depois, at: extra.at || AGORA });
  };
  const recusar = (acao, antes, erro, forjado, extra = {}) => cenarios.push({ tipo: 'recusa', acao, ...extra, antes: ref(antes), erro, comandos: forjado ? plan.planAgendaCommands([antes], [forjado]) : [], depois: forjado, at: AGORA });

  for (const item of estados) {
    // Contato: toggle (2 intenções) / outcome; remover; ativar; restaurar.
    for (const tag of ETIQUETAS) {
      for (const intent of ['toggle', 'activate']) {
        if (intent === 'activate' && alea() < 0.5) continue;
        const dia = alea() < 0.7 ? DIA : AMANHA;
        const depois = ct.toggleAgendaTag(item, tag, ATOR, AGORA, dia, tag === 'Concluída' || tag === 'Cancelada' ? alea() < 0.5 : false, undefined, intent);
        // A tela não oferece a etiqueta que `agendaTagIsReadOnly` trava (agenda-tag-control.tsx): sem caminho na tela, o servidor pode recusar.
        if (ct.agendaTagIsReadOnly(item, tag) && depois !== item) cenarios.push({ tipo: 'bloqueado-na-tela', acao: `toggle:${tag}:${intent}`, antes: ref(item) });
        else registrar(`toggle:${tag}:${intent}`, item, depois);
      }
      registrar(`remover:${tag}`, item, ct.removeAgendaTag(item, tag, ATOR, AGORA, DIA, alea() < 0.3 ? ct.agendaContactSnapshot(item) : undefined));
    }
    registrar('ativar', item, ct.activateAgendaClient(item, ATOR, AGORA, DIA));
    registrar('restaurar', item, ct.restoreAgendaContact(item));

    // Plano de contato (o que o front normaliza) com e sem remarcar/liberar reserva.
    for (const p of PLANOS) {
      const reagendar = alea() < 0.3; const liberar = alea() < 0.2;
      const r = tentar(() => pl.applyAgendaContactPlan(item, p, { actor: ATOR, at: AGORA, date: item.date || DIA, reschedule: reagendar, releaseReservation: liberar }));
      if (r.ok) { registrar(`plano:${p.who}/${p.timing}`, item, r.ok); continue; }
      if (r.erro.startsWith('Finalize a consulta')) {
        // Mudança de combinado com consulta em andamento: o servidor a reconhece quando o combinado muda sem etiqueta nova.
        const normal = tentar(() => pl.normalizedAgendaContactPlan(p)).ok;
        const mudou = normal && JSON.stringify(normal) !== JSON.stringify(tentar(() => pl.normalizedAgendaContactPlan(pl.readAgendaContactPlan(item))).ok);
        if (mudou && !reagendar && !liberar) recusar(`plano-em-consulta`, item, r.erro, { ...item, contactPlan: normal }, { grupo: 'plano' }); else cenarios.push({ tipo: 'so-no-front', acao: 'plano-em-consulta', antes: ref(item), erro: r.erro });
        continue;
      }
      cenarios.push({ tipo: 'recusa-frase', acao: `plano:${JSON.stringify(p)}`, grupo: 'plano', plano: p, antes: ref(item), erro: r.erro });
    }

    // Observações.
    const notas = ob.agendaObservations(item);
    const alvo = notas[0];
    const casos = [
      { action: 'add', observationId: 'n-novo', text: 'Cliente pediu à noite.' }, { action: 'add', observationId: 'n-novo', text: '   ' }, { action: 'add', observationId: notas[0]?.id || 'n-x', text: 'duplicada' },
      ...(alvo ? [
        { action: 'edit', observationId: alvo.id, text: 'Texto editado.', expected: ob.agendaObservationSnapshot(alvo) }, { action: 'edit', observationId: alvo.id, text: '', expected: ob.agendaObservationSnapshot(alvo) },
        { action: 'edit', observationId: alvo.id, text: 'x', expected: 'velho' }, { action: 'delete', observationId: alvo.id, expected: ob.agendaObservationSnapshot(alvo) }, { action: 'restore', observationId: alvo.id, expected: ob.agendaObservationSnapshot(alvo) },
        { action: 'edit', observationId: 'n-fantasma', text: 'x', expected: 'x' },
      ] : [{ action: 'delete', observationId: 'n-fantasma', expected: 'x' }]),
    ];
    for (const c of casos) {
      const r = tentar(() => ob.changeAgendaObservation(item, { id: `ev-${c.action}-${c.observationId}`, ...c }, ATOR, AGORA));
      if (r.ok) { registrar(`obs:${c.action}`, item, r.ok); continue; }
      // O que o navegador mandaria sem a conferência: a anotação alterada à força.
      const notas2 = c.action === 'add' ? [...notas, { id: c.observationId, text: (c.text || '').trim(), createdAt: AGORA, createdBy: ATOR }] : notas.map((n) => (n.id === c.observationId ? { ...n, text: c.text ?? n.text, ...(c.action === 'delete' ? { deletedAt: AGORA } : {}) } : n));
      const evento = { id: `ev-${c.action}-${c.observationId}`, observationId: c.observationId, action: c.action, at: AGORA, actor: ATOR };
      const forjado = { ...item, observations: notas2, observation: notas2.map((n) => n.text).join('\n\n'), observationHistory: [...(item.observationHistory || []), evento] };
      // Texto de concorrência (o instantâneo da anotação ficou velho): o servidor o cobre com `expectedVersion` (409), não com o delta.
      if (r.erro.startsWith('Esta observação mudou') && notas.some((n) => n.id === c.observationId)) { cenarios.push({ tipo: 'versao', acao: `obs:${c.action}`, antes: ref(item), erro: r.erro }); continue; }
      recusar(`obs:${c.action}`, item, r.erro, forjado, { grupo: 'observacoes' });
    }

    // Prazo combinado.
    for (const minutos of [1, 30, 1440, 0, 1441, -5, 2.5]) {
      for (const esperado of [item.requestedWaitHistory?.at(-1)?.id, 'velho']) {
        const r = tentar(() => rw.appendRequestedWait([item], item.id, minutos, ATOR, Date.parse(AGORA), esperado)[0]);
        if (r.ok) { registrar(`prazo:${minutos}`, item, r.ok); continue; }
        const hist = rw.requestedWaitHistory(item);
        const forjado = { ...item, requestedWaitHistory: [...hist, { id: `wait-${item.id}-${Date.parse(AGORA)}`, minutes: minutos, at: AGORA, by: ATOR, attempt: ct.agendaContact(item).attempt, afterEventId: item.contactHistory?.at(-1)?.id || '' }] };
        recusar(`prazo:${minutos}`, item, r.erro, forjado, { grupo: 'prazo', esperadoUltimo: esperado, minutos });
        const ultimo = cenarios[cenarios.length - 1];
        for (const c of ultimo.comandos) if (c.kind === 'item' && c.route === '/requested-wait') c.delta.expectedLatestId = esperado;
      }
    }

    // Saídas: cancelar, transferir, remarcar, próximo turno.
    const fechado = ct.agendaIsClosed(item);
    for (const incidente of INCIDENTES.slice(0, 4)) {
      for (const motivo of MOTIVOS_CANCELAR) registrar(`saida:cancel:${motivo}`, item, tr.changeAgendaDestination(item, item, { action: 'cancel', reason: motivo, actor: ATOR, at: AGORA, date: DIA, incident: incidente, note: alea() < 0.3 ? 'obs' : undefined }));
      for (const motivo of MOTIVOS_TRANSFERIR) registrar(`saida:transfer:${motivo}`, item, tr.changeAgendaDestination(item, { ...item, tarotId: 'nyx' }, { action: 'transfer', reason: motivo, actor: ATOR, at: AGORA, date: DIA, incident: incidente }));
    }
    registrar('saida:reschedule', item, tr.changeAgendaDestination(item, { ...item, date: AMANHA }, { action: 'reschedule', reason: 'Reagendou', actor: ATOR, at: AGORA, date: DIA }));
    registrar('saida:reschedule-remarcou', item, tr.changeAgendaDestination(item, { ...item, date: AMANHA }, { action: 'reschedule', reason: 'Remarcou amanhã', actor: ATOR, at: AGORA, date: DIA, incident: 'Lançamento errado' }));
    registrar('saida:next-shift', item, tr.changeAgendaDestination(item, { ...item, date: AMANHA }, { action: 'next-shift', reason: 'Reagendou', actor: ATOR, at: AGORA, date: DIA }));
    void fechado;
  }
  return { estados: [...unicos.keys()].map((k) => JSON.parse(k)), cenarios };
}

module.exports = { gerar, base, DIA, AMANHA, AGORA, ATOR };
