'use strict';

/**
 * MUTANTES da Lilly v710: cada verificação `(impl) => boolean` roda com a implementação REAL (tem de passar) e com versões deliberadamente quebradas (têm de ser
 * REPROVADAS). A parte de banco (CHECK do nameArticle, comandos, idempotência) já é refutada nos casos anteriores com escritas inválidas diretas e recusas HTTP.
 */

module.exports = async (c) => {
  const { r, conferir, passo } = c;
  const base = 'src/gestao-fadas/features/lilly';
  const reserva = require(r(`${base}/executores/reserva`));
  const posicao = require(r(`${base}/executores/posicao.reordenar`));
  const fechar = require(r(`${base}/executores/consulta.fechar`));
  const continuar = require(r(`${base}/executores/consulta.continuar`));
  const comum = require(r(`${base}/v710/comum`));
  const revisao = require(r(`${base}/contexto/revisao`));
  const cadeia = require(r(`${base}/v710/cadeia`));
  const tempo = require(r(`${base}/v710/fechamento.tempo`));
  const cotacoes = require(r(`${base}/contexto/cotacoes.consulta`));
  const tarologos = require(r(`${base}/contexto/montador.tarologos`));
  const cfg = require(r(`${base}/executores/executores.config`));
  const cadastro = require(r('src/gestao-fadas/_comum/dominio/cadastro-tarologo'));

  const pedidoReserva = (p) => ({ clientId: '1', tarologistId: 'o', conversationId: 'c', payload: { appointmentId: 'a1', expectedRevision: 5, expectedAppointment: 'x', author: { id: 'u', name: 'U' }, sourceMessageId: 'm', ...p } });
  const pedidoPosicao = (p) => ({ clientId: '1', tarologistId: 'o', conversationId: 'c', payload: { appointmentId: 'a1', position: 2, expectedRevision: 5, expectedQueueRevision: 'queue-v1:1:x', expectedAppointment: 'x', orderedAppointmentIds: ['a1', 'a2'], author: { id: 'u', name: 'U' }, sourceEventId: 'e', sourceConversationId: 'c', ...p } });
  const pedidoFecha = (p) => ({ clientId: '1', tarologistId: 'o', payload: { consultationId: 'c1', expectedRevision: 5, expectedConsultation: 'x', quoteId: 'q', timing: { minutes: 20, source: 'reported' }, sourceAt: '2026-11-08T15:00:00.000Z', triggerEventId: 'e', ...p } });
  const pedidoAbre = (p) => ({ clientId: '1', tarologistId: 'o', payload: { sourceConsultationId: 'c1', expectedRevision: 5, expectedConsultation: 'x', expectedChain: 'y', minutes: 15, quoteId: 'q', sourceConversationId: 'chat', triggerEventId: 'e', ...p } });
  const linhaReserva = (extra = {}) => ({ id: 'a1', clientId: '1', tarologistId: 'afila', revision: 1, status: 'scheduled', position: 1, date: '2026-11-08', createdAt: '2026-11-08T10:00:00.000Z', ...extra });
  const fecha = (id, pai, extra = {}) => ({ id, clientId: '1', tarologistId: 'o', status: 'completed', durationSeconds: 600, ...(pai ? { continuation: { sourceConsultationId: pai } } : {}), ...extra });
  const itemCurto = { id: 'c1', clientId: '1', tarotId: 'o', status: 'Em curso', awaitingTarologistStart: false, startedAt: '2026-11-08T14:00:00.000Z', tarologistStartedAt: '2026-11-08T14:00:00.000Z', sentToTarologistAt: '2026-11-08T14:00:00.000Z', timeLimit: { kind: 'maximum', minutes: 30 }, audit: [], paymentProfile: 'Pós-paga' };

  const verificacoes = {
    'revisão do snapshot muda quando a versão de um agendamento muda': (i) => i.numeroDaRevisao({ agenda: [{ id: 'a', version: 1, agenda_outcome: null }], consultas: [] }) !== i.numeroDaRevisao({ agenda: [{ id: 'a', version: 2, agenda_outcome: null }], consultas: [] }),
    'revisão do snapshot muda quando a consulta muda de situação': (i) => i.numeroDaRevisao({ agenda: [], consultas: [{ id: 'c', version: 1, status: 'Em curso' }] }) !== i.numeroDaRevisao({ agenda: [], consultas: [{ id: 'c', version: 1, status: 'Concluída' }] }),
    'revisão do snapshot é inteiro seguro (a reserva só aceita inteiro)': (i) => Number.isSafeInteger(i.numeroDaRevisao({ agenda: [{ id: 'a', version: 1, agenda_outcome: null }], consultas: [] })),
    'assinatura da reserva enxerga a reserva vigente': (i) => i.assinaturaDaReserva(linhaReserva()) !== i.assinaturaDaReserva(linhaReserva({ queueReservation: { tarotId: 'o', tarologistId: 'o', at: '2026-11-08T11:00:00.000Z' } })),
    'assinatura da reserva enxerga a posição': (i) => i.assinaturaDaReserva(linhaReserva()) !== i.assinaturaDaReserva(linhaReserva({ position: 2 })),
    'impressão da linha muda com qualquer campo da linha': (i) => i.impressaoDaLinha({ id: 'c', status: 'in_progress', version: 1 }) !== i.impressaoDaLinha({ id: 'c', status: 'in_progress', version: 2 }),
    'reserva sem revisão inteira é recusada': (i) => Boolean(i.normalizarReserva(pedidoReserva({ expectedRevision: '5' })).motivo),
    'reserva sem autoria (id e nome) é recusada': (i) => Boolean(i.normalizarReserva(pedidoReserva({ author: { id: 'u' } })).motivo),
    'reserva sem a assinatura do agendamento é recusada': (i) => Boolean(i.normalizarReserva(pedidoReserva({ expectedAppointment: '' })).motivo),
    'posição zero ou fracionária é recusada': (i) => Boolean(i.normalizarPosicao(pedidoPosicao({ position: 0 })).motivo) && Boolean(i.normalizarPosicao(pedidoPosicao({ position: 1.5 })).motivo),
    'lista da fila com id repetido ou sem o alvo é recusada': (i) => Boolean(i.normalizarPosicao(pedidoPosicao({ orderedAppointmentIds: ['a1', 'a1'] })).motivo) && Boolean(i.normalizarPosicao(pedidoPosicao({ orderedAppointmentIds: ['a2'] })).motivo),
    'a origem da correção tem de ser a conversa da ação': (i) => Boolean(i.normalizarPosicao(pedidoPosicao({ sourceConversationId: 'outra' })).motivo),
    'fechamento sem a cotação ou sem o evento é recusado': (i) => Boolean(i.normalizarFecha(pedidoFecha({ quoteId: '' })).motivo) && Boolean(i.normalizarFecha(pedidoFecha({ triggerEventId: '' })).motivo),
    'fechamento com a cliente ou o tarólogo de outra pessoa é recusado': (i) => Boolean(i.normalizarFecha(pedidoFecha({ clientId: '2' })).motivo) && Boolean(i.normalizarFecha(pedidoFecha({ tarologistId: 'x' })).motivo),
    'continuação com minutos zero, fracionados ou acima de 1440 é recusada': (i) => [0, 1.5, 1441].every((m) => Boolean(i.normalizarAbre(pedidoAbre({ minutes: m })).motivo)),
    'continuação sem a conversa da cliente é recusada': (i) => Boolean(i.normalizarAbre(pedidoAbre({ sourceConversationId: '' })).motivo),
    'cadeia: ciclo na origem é recusado': (i) => i.cadeia([fecha('a', 'b'), fecha('b', 'a')], fecha('a', 'b')) === null,
    'cadeia: consulta ainda aberta no meio é recusada': (i) => i.cadeia([fecha('a', 'b'), fecha('b', null, { status: 'in_progress' })], fecha('a', 'b')) === null,
    'cadeia: outra cliente no meio é recusada': (i) => i.cadeia([fecha('a', 'b'), fecha('b', null, { clientId: '9' })], fecha('a', 'b')) === null,
    'cadeia soma os minutos de cada elo e o ID da raiz': (i) => { const x = i.cadeia([fecha('a', 'b'), fecha('b')], fecha('a', 'b')); return x && x.total === 20 && x.count === 2 && x.rootConsultationId === 'b'; },
    'fechamento: minuto relatado acima do relógio não fecha': (i) => i.tempoDoFechamento({ status: 'in_progress', startedAt: '2026-11-08T14:00:00.000Z', awaitingTarologistStart: false }, { at: '2026-11-08T14:10:00.000Z', data: { minutes: 25 } }) === null,
    'fechamento: pausa em aberto não vira minuto cobrado': (i) => { const t = i.tempoDoFechamento({ status: 'in_progress', startedAt: '2026-11-08T14:00:00.000Z', awaitingTarologistStart: false, pauseHistory: [{ startedAt: '2026-11-08T14:05:00.000Z' }] }, { at: '2026-11-08T14:30:00.000Z', data: {} }); return t && t.minutes === 5; },
    'cotação: terminar ANTES do previsto exige conferência (a regra real pede o motivo)': (i) => { const q = i.simularFechamento({ id: 'c1', item: itemCurto }, 20, '2026-11-08T14:21:00.000Z', null); return q.canCloseAutomatically === false && q.requiresReview === true; },
    'cotação: terminar no tempo previsto fecha sem conferência': (i) => { const q = i.simularFechamento({ id: 'c1', item: itemCurto }, 30, '2026-11-08T14:31:00.000Z', null); return q.canCloseAutomatically === true && q.requiresReview === false; },
    'nameArticle: nome conhecido NÃO vira artigo (nada deduzido de "Osíris")': (i) => { const t = i.montarTarologos({ catalogo: [{ id: 'osiris', name: 'Osíris', registrationActive: true }], presencas: [], escalas: [], citados: new Set(), hoje: '2026-11-08', amanha: '2026-11-09' }); return !('nameArticle' in t[0]); },
    'nameArticle: "a", "o" e null declarados são copiados do cadastro': (i) => { const t = i.montarTarologos({ catalogo: ['a', 'o', null].map((v, k) => ({ id: `t${k}`, name: 'X', registrationActive: true, directory: { nameArticle: v } })), presencas: [], escalas: [], citados: new Set(), hoje: '2026-11-08', amanha: '2026-11-09' }); return t[0].nameArticle === 'a' && t[1].nameArticle === 'o' && t[2].nameArticle === null; },
    'nameArticle: valor fora de o/a/null é recusado no cadastro': (i) => { try { i.tratamento('x'); return false; } catch (e) { return true; } },
    'fechar consulta e abrir continuação nascem DESLIGADAS': (i) => i.fecharLigado({}) === false && i.continuacaoLigada({}) === false,
  };

  const reais = {
    numeroDaRevisao: revisao.numeroDaRevisao, assinaturaDaReserva: comum.assinaturaDaReserva, impressaoDaLinha: comum.impressaoDaLinha,
    normalizarReserva: reserva.normalizar, normalizarPosicao: posicao.normalizar, normalizarFecha: fechar.normalizar, normalizarAbre: continuar.normalizar,
    cadeia: cadeia.cadeiaDeMinutos, tempoDoFechamento: tempo.tempoDoFechamento, simularFechamento: cotacoes.simularFechamento, montarTarologos: tarologos.montarTarologos,
    tratamento: cadastro.tratamentoDoProfissional, fecharLigado: cfg.fecharConsultaLigado, continuacaoLigada: cfg.continuacaoLigada,
  };
  const ok = () => ({ motivo: '' });
  const mutantes = {
    'revisão do snapshot muda quando a versão de um agendamento muda': { numeroDaRevisao: (e) => reais.numeroDaRevisao({ agenda: e.agenda.map((a) => ({ ...a, version: 1 })), consultas: e.consultas }) },
    'revisão do snapshot muda quando a consulta muda de situação': { numeroDaRevisao: (e) => reais.numeroDaRevisao({ agenda: e.agenda, consultas: e.consultas.map((x) => ({ ...x, status: 'x' })) }) },
    'revisão do snapshot é inteiro seguro (a reserva só aceita inteiro)': { numeroDaRevisao: (e) => `${reais.numeroDaRevisao(e)}` },
    'assinatura da reserva enxerga a reserva vigente': { assinaturaDaReserva: (a) => reais.assinaturaDaReserva({ ...a, queueReservation: undefined }) },
    'assinatura da reserva enxerga a posição': { assinaturaDaReserva: (a) => reais.assinaturaDaReserva({ ...a, position: 0 }) },
    'impressão da linha muda com qualquer campo da linha': { impressaoDaLinha: (l) => reais.impressaoDaLinha({ id: l.id }) },
    'reserva sem revisão inteira é recusada': { normalizarReserva: (a) => reais.normalizarReserva({ ...a, payload: { ...a.payload, expectedRevision: 5 } }) },
    'reserva sem autoria (id e nome) é recusada': { normalizarReserva: (a) => reais.normalizarReserva({ ...a, payload: { ...a.payload, author: { id: 'u', name: 'U' } } }) },
    'reserva sem a assinatura do agendamento é recusada': { normalizarReserva: (a) => reais.normalizarReserva({ ...a, payload: { ...a.payload, expectedAppointment: 'x' } }) },
    'posição zero ou fracionária é recusada': { normalizarPosicao: () => ok() },
    'lista da fila com id repetido ou sem o alvo é recusada': { normalizarPosicao: (a) => reais.normalizarPosicao({ ...a, payload: { ...a.payload, orderedAppointmentIds: ['a1', 'a2'] } }) },
    'a origem da correção tem de ser a conversa da ação': { normalizarPosicao: (a) => reais.normalizarPosicao({ ...a, payload: { ...a.payload, sourceConversationId: a.conversationId } }) },
    'fechamento sem a cotação ou sem o evento é recusado': { normalizarFecha: () => ok() },
    'fechamento com a cliente ou o tarólogo de outra pessoa é recusado': { normalizarFecha: (a) => reais.normalizarFecha({ ...a, payload: { ...a.payload, clientId: undefined, tarologistId: undefined } }) },
    'continuação com minutos zero, fracionados ou acima de 1440 é recusada': { normalizarAbre: () => ok() },
    'continuação sem a conversa da cliente é recusada': { normalizarAbre: () => ok() },
    'cadeia: ciclo na origem é recusado': { cadeia: () => ({ total: 0, count: 1, rootConsultationId: 'a', fingerprint: 'x' }) },
    'cadeia: consulta ainda aberta no meio é recusada': { cadeia: (todas, l) => reais.cadeia(todas.map((x) => ({ ...x, status: 'completed' })), l) },
    'cadeia: outra cliente no meio é recusada': { cadeia: (todas, l) => reais.cadeia(todas.map((x) => ({ ...x, clientId: '1' })), l) },
    'cadeia soma os minutos de cada elo e o ID da raiz': { cadeia: (todas, l) => { const x = reais.cadeia(todas, l); return x && { ...x, total: 10 }; } },
    'fechamento: minuto relatado acima do relógio não fecha': { tempoDoFechamento: (row, ev) => reais.tempoDoFechamento(row, { ...ev, data: { minutes: 5 } }) || { minutes: 25 } },
    'fechamento: pausa em aberto não vira minuto cobrado': { tempoDoFechamento: (row, ev) => reais.tempoDoFechamento({ ...row, pauseHistory: [] }, ev) },
    'cotação: terminar ANTES do previsto exige conferência (a regra real pede o motivo)': { simularFechamento: () => ({ canCloseAutomatically: true, covered: true, requiresReview: false }) },
    'cotação: terminar no tempo previsto fecha sem conferência': { simularFechamento: () => ({ canCloseAutomatically: false, covered: true, requiresReview: true }) },
    'nameArticle: nome conhecido NÃO vira artigo (nada deduzido de "Osíris")': { montarTarologos: (e) => reais.montarTarologos(e).map((t) => (t.name === 'Osíris' ? { ...t, nameArticle: 'o' } : t)) },
    'nameArticle: "a", "o" e null declarados são copiados do cadastro': { montarTarologos: (e) => reais.montarTarologos(e).map((t) => { const { nameArticle: _n, ...resto } = t; return resto; }) },
    'nameArticle: valor fora de o/a/null é recusado no cadastro': { tratamento: (v) => v },
    'fechar consulta e abrir continuação nascem DESLIGADAS': { fecharLigado: () => true },
  };
  const naoCobertos = Object.keys(verificacoes).filter((k) => !mutantes[k]);
  conferir('todo mutante tem verificação e toda verificação tem mutante', naoCobertos.length === 0 && Object.keys(mutantes).length === Object.keys(verificacoes).length, naoCobertos.join(' | '));

  console.log('mutantes v710 (cada verificação tem de aprovar o real e REPROVAR o quebrado)');
  for (const [nome, verificar] of Object.entries(verificacoes)) {
    await passo(`${nome}: real aprovado, mutante reprovado`, async () => {
      let real; let mutado;
      try { real = verificar(reais) === true; } catch (e) { real = false; }
      try { mutado = verificar({ ...reais, ...mutantes[nome] }) === true; } catch (e) { mutado = false; }
      conferir('implementação real passa', real);
      conferir('mutante é refutado', mutado === false);
    });
  }
};
