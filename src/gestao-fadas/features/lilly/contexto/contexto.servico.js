'use strict';

/**
 * Orquestrador do snapshot `POST /lilly/context` (Maturacao/59, seções 2.1, 3 e 8.2; Maturacao/60). Do evento recebido deriva o escopo
 * (`contexto.escopo.js`), roda um montador por assunto e junta tudo no envelope (`contexto.base.js`).
 *
 * COBERTURA (3.11): cada assunto roda isolado (`Cobertura.montar`). Falha da fonte ou limite estourado => o array daquele assunto sai VAZIO e
 * `complete` sai false; nunca uma lista parcial como se fosse total. `complete:true` só quando TODOS os assuntos exigidos pelo evento
 * terminaram com cobertura total. Assunto que o contrato exige e a API não tem de onde ler (`morningReview` na revisão da manhã,
 * `queueDurationMetrics` no relógio com `capacityCheck`) mantém `complete:false`.
 *
 * v710: `revision` (inteiro derivado do estado operacional, `contexto/revisao.js`), `consultationClosingQuotes`, `consultationQuotes` de continuação (`cotacoes.consulta.js`) e
 * `appointmentPositionQuotes` (`cotacoes.posicao.js`), todas derivadas das regras reais; `effectivePosition` nos agendamentos com cotação de fila.
 *
 * `tarologistReturnMetrics` (Lilly v708, `montador.retorno.js`): agregado diário de retorno ao mesmo profissional; ausente sem dado válido ou com a flag desligada.
 *
 * Fora desta etapa (SEM FONTE, nunca enviados): handoffs, deliveryReceipts, queueDurationMetrics, morningReview, tarologistHistories, contact,
 * aliases/conversationId/umblerContactId dos tarólogos (`nameArticle` vem do cadastro, v710).
 */

const { envelope } = require('./contexto.base');
const { LIMITES } = require('./contexto.limites');
const { Cobertura, LimiteExcedido } = require('./contexto.cobertura');
const { derivarEscopo, ASSUNTOS_BASE } = require('./contexto.escopo');
const { fontes } = require('./fontes');
const { somarDias } = require('./contexto.tempo');
const { montarLinks, clientesDosVinculos, montarMensagens, montarAvisos, montarCotacoes, montarConversas } = require('./montador.conversa');
const { buscarPorTelefone, montarClientes } = require('./montador.clientes');
const { montarTarologos, FILA_GERAL } = require('./montador.tarologos');
const { montarAgenda } = require('./montador.agenda');
const { montarConsultas } = require('./montador.consultas');
const { montarPagamentos } = require('./montador.pagamentos');
const { montarEscalas, montarNotasDoHorario } = require('./montador.horarios');
const { montarRetorno } = require('./montador.retorno');
const { cotacoesDeFechamento, cotacoesDeContinuacao } = require('./cotacoes.consulta');
const { montarCotacoesDePosicao } = require('./cotacoes.posicao');
const { montarConfiguracaoFinanceira, montarRestricoes, montarDivergencias, urlBaseDaFicha } = require('./montador.configuracao');

const VAZIO_AGENDA = { linhas: [], appointments: [], clientIds: [], tarologistIds: [], tarologoDoAgendamento: new Map() };
const VAZIO_CONSULTAS = { linhas: [], consultations: [], clientIds: [], tarologistIds: [], ids: [] };

/** Cliente com vínculo ativo e verificado nas conversas do pedido: não precisa buscar por telefone. */
const conversaJaVinculada = (escopo, brutos) => brutos.some((v) => escopo.conversationIds.includes(v.conversationId) && v.active && v.verified);

/**
 * @param {{ event: object, conversation?: object }} body  corpo já validado (`event` objeto)
 * @param {{ agora?: Date, fontes?: object, env?: object }} [deps]
 * @returns {Promise<{ snapshot: object, cobertura: Cobertura, exigidos: Set<string> }>}
 */
async function montarContexto(body, deps = {}) {
  const agora = deps.agora || new Date();
  const f = deps.fontes || fontes();
  const base = envelope(agora);
  const hoje = base.operationalDate;
  const amanha = somarDias(hoje, 1);
  const escopo = derivarEscopo(body);
  const cob = new Cobertura();
  const exigidos = new Set(ASSUNTOS_BASE);

  if (escopo.semConversa || escopo.excedeuConversas) { cob.itens.scope = { ok: false, contagem: 0, motivo: escopo.semConversa ? 'sem-conversa' : 'limite' }; exigidos.add('scope'); }
  if (escopo.revisaoDaManha) { cob.semFonte('morningReview'); exigidos.add('morningReview'); }
  if (escopo.verificaCapacidade) { cob.semFonte('queueDurationMetrics'); exigidos.add('queueDurationMetrics'); }

  // 1) Conversa: vínculos (de onde saem as clientes em foco).
  const { links, brutos } = await cob.montar('links', () => montarLinks(escopo, f), { links: [], brutos: [] }, (r) => r.links.length);
  const focoIds = [...new Set([escopo.clientId, ...clientesDosVinculos(brutos)].filter(Boolean))];
  const contatos = new Map(brutos.filter((v) => v.active && v.verified).map((v) => [v.clientId, v.contactId]));

  // 2) Fila, consultas e pagamentos.
  const agenda = await cob.montar('appointments', () => montarAgenda({ hoje, focoIds, appointmentId: escopo.appointmentId, agora: agora.getTime() }, f), VAZIO_AGENDA, (r) => r.appointments.length);
  const inicioDoDiaIso = new Date(`${hoje}T06:00:00-03:00`).toISOString();
  const consultas = await cob.montar('consultations', () => montarConsultas({ agora, inicioDoDiaIso, focoIds, consultationId: escopo.consultationId }, f), VAZIO_CONSULTAS, (r) => r.consultations.length);
  const payments = await cob.montar('payments', () => montarPagamentos({ agora, focoIds, paymentId: escopo.paymentId, referencias: escopo.referencias }, f));

  // 3) Clientes: as da conversa, as candidatas do telefone e as da fila/consultas do dia.
  let busca = null;
  let phoneLookup;
  if (escopo.telefone && escopo.conversationIds.length && cob.itens.links.ok && !conversaJaVinculada(escopo, brutos)) {
    exigidos.add('phoneLookup');
    busca = await cob.montar('phoneLookup', () => buscarPorTelefone(escopo.telefone, f), null);
    if (!busca) phoneLookup = { phone: `${escopo.telefone}`.trim(), complete: false };
    else { phoneLookup = busca.phoneLookup; if (!busca.completa) cob.rebaixar('phoneLookup', busca.motivo); }
  }
  let saldosSemLeitura = 0;
  const clients = await cob.montar('clients', async () => {
    if (focoIds.length > LIMITES.CLIENTES_EM_FOCO) throw new LimiteExcedido('clients');
    const filaIds = [...new Set([...agenda.clientIds, ...consultas.clientIds])];
    const r = await montarClientes({ focoIds, filaIds, busca, contatos, profileBase: urlBaseDaFicha(deps.env) }, f);
    saldosSemLeitura = r.saldosSemLeitura;
    return r.clients;
  });
  if (saldosSemLeitura > 0) cob.rebaixar('clients', 'saldo');

  // 4) Tarólogos, escalas e notas do horário.
  const fonteTar = await cob.montar('tarologists', async () => ({ catalogo: await f.catalogoTarologos(), presencas: await f.presenca() }), null);
  const citados = new Set([...agenda.tarologistIds, ...consultas.tarologistIds, escopo.tarologistId].filter((t) => t && t !== FILA_GERAL));
  const idsEscala = fonteTar ? fonteTar.catalogo.filter((t) => t.registrationActive !== false || citados.has(`${t.id}`)).map((t) => `${t.id}`).filter((t) => t !== FILA_GERAL) : [];
  const escalas = fonteTar
    ? await cob.montar('schedules', async () => montarEscalas({ tarologistIds: idsEscala, dias: [hoje, amanha], horarios: await f.horarios({ de: hoje, ate: amanha }) }))
    : [];
  if (!fonteTar) cob.itens.schedules = { ok: false, contagem: 0, motivo: 'sem-tarologos' };
  let tarologists = [];
  if (fonteTar) {
    try {
      tarologists = montarTarologos({ catalogo: fonteTar.catalogo, presencas: fonteTar.presencas, escalas, citados, hoje, amanha, formas: await f.formasDoDia(hoje) });
      cob.itens.tarologists.contagem = tarologists.length;
    } catch (e) { cob.itens.tarologists = { ok: false, contagem: 0, motivo: e instanceof LimiteExcedido ? 'limite' : 'falha' }; }
  }
  const scheduleNotes = montarNotasDoHorario(await cob.montar('scheduleNotes', () => f.notasDoDia({ date: hoje, limite: LIMITES.NOTAS_HORARIO }).then((n) => {
    if (n.length > LIMITES.NOTAS_HORARIO) throw new LimiteExcedido('scheduleNotes');
    return n;
  })));

  // 5) Do que é da conversa e regras.
  const messages = await cob.montar('messages', () => montarMensagens(escopo, f, agora));
  const notices = await cob.montar('notices', () => montarAvisos(escopo, f, agenda.tarologoDoAgendamento));
  // v710: revisão do snapshot e cotações derivadas das regras reais (docs/banco/22 §4). Falha de uma cotação NÃO derruba o snapshot: a Lilly trata cotação
  // ausente como "pedir conferência". A revisão é obrigatória para agir (reserva, fechamento, posição): sem ela o campo sai ausente.
  const revision = await f.revisaoDoSnapshot(agora).catch(() => undefined);
  const evento = { at: (body.event && Number.isFinite(Date.parse(body.event.at)) ? body.event.at : agora.toISOString()), data: (body.event && body.event.data && typeof body.event.data === 'object') ? body.event.data : {} };
  const opcional = (fn) => fn().catch(() => []);
  const cotacaoDeFechamento = revision === undefined ? [] : await opcional(() => cotacoesDeFechamento({ consultas, evento, revisao: revision, agora }, f));
  const cotacaoDePosicao = revision === undefined ? [] : await opcional(() => montarCotacoesDePosicao(agenda, { agora, hoje, focoIds }, f));
  // `effectivePosition` (v710): lugar real na fila vigente, que a Lilly lê para confirmar uma correção (`position(row)`). Só para quem tem cotação de fila.
  for (const q of cotacaoDePosicao) { const a = agenda.appointments.find((x) => x.id === q.appointmentId); if (a) a.effectivePosition = q.orderedAppointmentIds.indexOf(q.appointmentId) + 1; }
  const cotacaoDeContinuacao = revision === undefined ? [] : await opcional(() => cotacoesDeContinuacao({ consultas, escopo, focoIds, evento, revisao: revision, agora }, f));
  const consultationQuotes = [...await cob.montar('consultationQuotes', () => montarCotacoes(escopo, f)), ...cotacaoDeContinuacao];
  const restrictions = await cob.montar('restrictions', () => montarRestricoes(focoIds, f));
  const divergences = await cob.montar('divergences', () => montarDivergencias(consultas.ids, f));
  const financialSettings = await cob.montar('financialSettings', () => montarConfiguracaoFinanceira(agora, f), undefined);

  // Indicador R (retorno ao mesmo profissional). Só a leitura do agregado: sem dado válido ele sai AUSENTE (nunca 0). Falha da fonte não derruba o snapshot.
  const tarologistReturnMetrics = await montarRetorno({ agora, hoje, semCache: deps.semCacheRetorno === true }, f).catch(() => undefined);

  const conversas = montarConversas(escopo, brutos);
  const profileBase = urlBaseDaFicha(deps.env);
  const snapshot = {
    ...base,
    complete: cob.completo(exigidos),
    clients, tarologists, appointments: agenda.appointments, consultations: consultas.consultations, payments, links, messages,
    schedules: escalas, scheduleNotes, notices, consultationQuotes,
    ...(revision !== undefined ? { revision } : {}), consultationClosingQuotes: cotacaoDeFechamento, appointmentPositionQuotes: cotacaoDePosicao, restrictions, divergences,
    ...(financialSettings ? { financialSettings } : {}),
    ...(tarologistReturnMetrics ? { tarologistReturnMetrics } : {}),
    ...(phoneLookup ? { phoneLookup } : {}),
    ...(profileBase ? { clientProfileBaseUrl: profileBase } : {}),
    ...(conversas.length === 1 ? { conversation: conversas[0] } : {}),
    conversations: conversas,
  };
  return { snapshot, cobertura: cob, exigidos };
}

/** Registro por pedido: só tipo do evento, `complete` e, por assunto, contagem ou motivo. Nenhum dado pessoal. */
function registrar(tipo, snapshot, cobertura, log = console.info) {
  log('[lilly] contexto', JSON.stringify({ tipo, complete: snapshot.complete, assuntos: cobertura.resumo() }));
}

module.exports = { montarContexto, registrar };
