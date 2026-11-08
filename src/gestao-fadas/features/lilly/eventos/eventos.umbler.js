'use strict';

/**
 * Resolução de eventos do provider 'umbler' (webhook nativo). O corpo do webhook é só gatilho: a conversa e a mensagem são RELIDAS na
 * Umbler (leitor injetável) e a organização é conferida contra `UMBLER_ORGANIZATION_ID`. Evento que não é mensagem (ChatClosed,
 * MemberTransfer, setor, privacidade, etiquetas...) volta como evento `actor:'system'` normalizado (decisão D2).
 *
 * Leitor (`deps.leitor`): `lerConversa(chatId) -> { organizationId, contact:{ id, tags } }` e
 * `lerMensagem(chatId, messageId) -> { id, isPrivate, source, sentByOrganizationMember, fromContact, content, eventAt, botInstance, automated, metadata, file }`.
 */

const { EventoRecusadoError, VerificacaoIndisponivelError } = require('./eventos.erros');
const { organizacaoEsperada, equipeAutorizada, contasDaLilly, todosAutorizam } = require('./eventos.config');
const { escopoInterno, autoriaInterna } = require('./eventos.interno');
const { autoriaDaMensagem, papelDoContato } = require('./eventos.autoria');
const { buscarAtivoDaConversa } = require('../dados/vinculos.repo');

const ATIVIDADE = { ChatClosed: 'close', MemberTransfer: 'transfer', MemberTranfer: 'transfer', ChatSectorChanged: 'sector', ChatPrivateStatusChanged: 'privacy' };
const MIMES_COMPROVANTE = ['image/jpeg', 'application/pdf'];
const texto = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const objeto = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Leitor padrão: a leitura de conversa/mensagem ainda não existe no provider; sem leitor injetado NÃO se verifica nada (falha fechada). */
const leitorIndisponivel = {
  async lerConversa() { throw new VerificacaoIndisponivelError('Leitura da conversa na Umbler indisponível.', 'LILLY_UMBLER_READER_UNAVAILABLE'); },
  async lerMensagem() { throw new VerificacaoIndisponivelError('Leitura da mensagem na Umbler indisponível.', 'LILLY_UMBLER_READER_UNAVAILABLE'); },
};

/** Leitor padrão: o provider da Umbler (só leitura). Sem token configurado ele falha (UMBLER_SEM_TOKEN) e a resolução fica indisponível (503). */
function leitorPadrao() {
  try { return require('../../../../providers/umbler/umbler.client').leitorDeEventos; } catch { return leitorIndisponivel; }
}

/** Falha da Umbler: rede/5xx/401/403 = 503 (tentar de novo); 404 = o provedor não conhece o evento (4xx). */
function traduzirFalhaUmbler(e) {
  if (e instanceof EventoRecusadoError) return e;
  if (e && e.status === 404) return new EventoRecusadoError('LILLY_EVENT_NOT_FOUND', 'A Umbler não encontrou a conversa ou a mensagem do evento.', 422);
  return new VerificacaoIndisponivelError('Falha ao verificar o evento na Umbler.', 'LILLY_UMBLER_UNAVAILABLE');
}

async function comTraducao(fn) {
  try { return await fn(); } catch (e) { throw traduzirFalhaUmbler(e); }
}

const instante = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** Forma mínima do webhook (400 se faltar). */
function lerWebhook(event) {
  const tipo = texto(event.Type);
  const conteudo = objeto(event.Payload) && objeto(event.Payload.Content) ? event.Payload.Content : null;
  const chatId = conteudo && texto(`${conteudo.Id ?? ''}`);
  const eventId = texto(`${event.EventId ?? ''}`);
  if (!tipo || !chatId) throw new EventoRecusadoError('INVALID_INPUT', 'Webhook da Umbler sem tipo ou conversa.', 400);
  const messageId = conteudo.LastMessage && texto(`${conteudo.LastMessage.Id ?? ''}`);
  if (!eventId && !(tipo === 'Message' && messageId)) throw new EventoRecusadoError('INVALID_INPUT', 'Webhook da Umbler sem EventId.', 400);
  const orgAlegada = texto(`${(conteudo.Organization && conteudo.Organization.Id) ?? conteudo.OrganizationId ?? event.OrganizationId ?? ''}`);
  return { tipo, chatId, messageId, eventId, orgAlegada, dataEvento: instante(event.EventDate), conteudo };
}

function conferirOrganizacao(w, conversa) {
  const esperada = organizacaoEsperada();
  if (!esperada) throw new VerificacaoIndisponivelError('Organização da Umbler não configurada.', 'LILLY_NOT_CONFIGURED');
  if (w.orgAlegada && w.orgAlegada !== esperada) throw new EventoRecusadoError('LILLY_EVENT_WRONG_ORGANIZATION', 'O evento é de outra organização.', 403);
  if (!conversa || `${conversa.organizationId}` !== esperada) throw new EventoRecusadoError('LILLY_EVENT_WRONG_ORGANIZATION', 'A conversa não é da organização autorizada.', 403);
}

function metaDoProvedor(vinculo) {
  const a = vinculo && vinculo.attribution;
  if (!a || a.verified !== true || !['ad', 'organic'].includes(a.kind)) return undefined;
  return { attribution: { kind: a.kind, verified: true }, firstContact: vinculo.firstContact === true };
}

function dadosDaMensagem(mensagem, autoria, conversa) {
  const papel = autoria.escopo ? 'internal' : papelDoContato(conversa);
  const data = {
    intent: undefined, messageId: `${mensagem.id}`, staffAuthorized: autoria.staffAuthorized,
    conversationScope: papel, automated: autoria.automated,
  };
  if (autoria.staffId) data.staffId = autoria.staffId;
  if (autoria.staffMemberId) data.staffMemberId = autoria.staffMemberId;
  if (autoria.escopo) { data.internalScope = autoria.escopo; data.contactType = autoria.contactType; } // conversa da equipe: nunca é cadastro nem pagamento de cliente
  const mime = mensagem.file && texto(mensagem.file.contentType);
  if (['client', 'contact'].includes(autoria.actor) && !autoria.internal && mime && MIMES_COMPROVANTE.includes(mime.toLowerCase())) {
    data.intent = 'receipt_received';
    data.receiptAttachment = { id: `${mensagem.file.id ?? mensagem.id}`, mimeType: mime.toLowerCase() };
  }
  if (data.intent === undefined) delete data.intent;
  return data;
}

/** Evento normalizado (ainda não gravado). `deps`: `{ leitor, executor }`. */
async function resolverUmbler(event, { leitor = leitorPadrao(), executor }) {
  const w = lerWebhook(event);
  const conversa = await comTraducao(() => leitor.lerConversa(w.chatId));
  conferirOrganizacao(w, conversa);
  const contactId = conversa.contact && conversa.contact.id ? `${conversa.contact.id}` : null;

  if (w.tipo !== 'Message') {
    return {
      id: `umbler:${w.eventId}`, at: w.dataEvento || new Date().toISOString(), type: 'message', source: 'umbler', conversationId: w.chatId, contactId,
      actor: 'system', internal: false, clientId: null, tarologistId: null, text: '',
      data: { staffAuthorized: false, conversationScope: papelDoContato(conversa), umblerType: w.tipo, ...(ATIVIDADE[w.tipo] ? { activityCode: ATIVIDADE[w.tipo] } : {}) },
    };
  }

  if (!w.messageId) throw new EventoRecusadoError('INVALID_INPUT', 'Webhook de mensagem sem a mensagem.', 400);
  const mensagem = await comTraducao(() => leitor.lerMensagem(w.chatId, w.messageId));
  if (!objeto(mensagem) || `${mensagem.id}` !== w.messageId) throw new EventoRecusadoError('LILLY_EVENT_NOT_FOUND', 'A mensagem relida não confere com o evento.', 422);
  if (mensagem.chatId && `${mensagem.chatId}` !== w.chatId) throw new EventoRecusadoError('LILLY_EVENT_NOT_FOUND', 'A mensagem não pertence à conversa do evento.', 422);

  const interno = escopoInterno(conversa);
  const vinculo = interno ? null : await buscarAtivoDaConversa(executor, w.chatId);
  const membro = mensagem.sentByOrganizationMember && mensagem.sentByOrganizationMember.id ? `${mensagem.sentByOrganizationMember.id}` : null;
  // "Online": só vale se o leitor souber; sem `lerMembro` a presença não é conferida (decisão da Nice: todos os atendentes online autorizam).
  const online = membro && typeof leitor.lerMembro === 'function' ? await comTraducao(async () => ((await leitor.lerMembro(membro)) || {}).online) : undefined;
  const ambiente = { equipe: equipeAutorizada(), contasLilly: contasDaLilly(), todos: todosAutorizam(), online };
  const autoria = interno
    ? autoriaInterna(mensagem, conversa, interno, ambiente)
    : autoriaDaMensagem(mensagem, conversa, { ...ambiente, temVinculo: Boolean(vinculo && vinculo.contactId === contactId) });
  const vinculoDoContato = vinculo && vinculo.contactId === contactId ? vinculo : null;
  const at = instante(mensagem.eventAt) || w.dataEvento;
  if (!at) throw new EventoRecusadoError('INVALID_INPUT', 'Mensagem sem instante válido.', 400);
  const providerMeta = metaDoProvedor(vinculoDoContato);
  return {
    id: `umbler:${w.eventId || `message:${w.messageId}`}`, at, type: 'message', source: 'umbler', conversationId: w.chatId, contactId, messageId: w.messageId,
    actor: autoria.actor, internal: autoria.internal, clientId: vinculoDoContato ? vinculoDoContato.clientId : null,
    tarologistId: null, text: typeof mensagem.content === 'string' ? mensagem.content : '', data: dadosDaMensagem(mensagem, autoria, conversa),
    ...(providerMeta ? { providerMeta } : {}),
  };
}

module.exports = { resolverUmbler, leitorIndisponivel, lerWebhook };
