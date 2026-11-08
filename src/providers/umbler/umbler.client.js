'use strict';

/**
 * Provider Umbler Talk (API v1, https://app-utalk.umbler.com/api).
 *
 * Leitura sempre liberada. ESCRITA (nota, mensagem) só com UMBLER_ESCRITA_ENABLED=true: sem isso a chamada
 * é recusada antes de sair da API, para um deploy novo nunca falar com cliente por acidente.
 * O token fica só no servidor (UMBLER_API_TOKEN) e nunca entra em log nem em resposta.
 */

const axios = require('axios');

const BASE_PADRAO = 'https://app-utalk.umbler.com/api';

class UmblerErro extends Error {
  constructor(mensagem, { status = null, codigo = 'UMBLER' } = {}) {
    super(mensagem);
    this.name = 'UmblerErro';
    this.status = status;
    this.codigo = codigo;
  }
}

function config() {
  return {
    base: `${process.env.UMBLER_BASE_URL || BASE_PADRAO}`.replace(/\/+$/, ''),
    token: `${process.env.UMBLER_API_TOKEN || ''}`.trim(),
    organizationId: `${process.env.UMBLER_ORGANIZATION_ID || ''}`.trim(),
    escrita: `${process.env.UMBLER_ESCRITA_ENABLED || ''}`.trim().toLowerCase() === 'true',
  };
}

function http() {
  const { base, token } = config();
  if (!token) throw new UmblerErro('Umbler não configurada (UMBLER_API_TOKEN).', { codigo: 'UMBLER_SEM_TOKEN' });
  return axios.create({ baseURL: base, timeout: 20_000, headers: { Authorization: `Bearer ${token}` } });
}

function organizacao() {
  const { organizationId } = config();
  if (!organizationId) throw new UmblerErro('Umbler sem UMBLER_ORGANIZATION_ID.', { codigo: 'UMBLER_SEM_ORGANIZACAO' });
  return organizationId;
}

function exigirEscrita() {
  if (!config().escrita) {
    throw new UmblerErro('Escrita na Umbler desligada (UMBLER_ESCRITA_ENABLED).', { codigo: 'UMBLER_ESCRITA_DESLIGADA' });
  }
}

/** Erro da Umbler sem o corpo (pode ter dado de cliente) e sem o token. */
function traduzir(err) {
  if (err instanceof UmblerErro) return err;
  const status = err?.response?.status ?? null;
  return new UmblerErro(`Falha na Umbler${status ? ` (HTTP ${status})` : ''}.`, { status, codigo: status ? 'UMBLER_HTTP' : 'UMBLER_REDE' });
}

async function chamar(fn) {
  try {
    return (await fn()).data;
  } catch (err) {
    throw traduzir(err);
  }
}

const enc = encodeURIComponent;

/* ---------- Leitura ---------- */

const lerContato = (contactId) => chamar(() => http().get(`/v1/contacts/${enc(contactId)}/`, { params: { organizationId: organizacao() } }));

const buscarContatoPorTelefone = (telefone) =>
  chamar(() => http().get('/v1/contacts/phone/', { params: { organizationId: organizacao(), phone: telefone } }));

const listarNotas = (contactId) => chamar(() => http().get(`/v1/contacts/${enc(contactId)}/notes/`, { params: { organizationId: organizacao() } }));

const listarCamposPersonalizados = () => chamar(() => http().get('/v1/custom-field-definitions/', { params: { organizationId: organizacao() } }));

const listarRobos = () => chamar(() => http().get('/v1/bots/', { params: { organizationId: organizacao() } }));

const listarWebhooks = () => chamar(() => http().get('/v1/webhooks/', { params: { organizationId: organizacao() } }));

/**
 * Leituras para conferir um evento (webhook): devolvem só o que o `events/resolve` precisa, sem copiar o resto da conversa.
 * Os nomes dos campos são os da Umbler (`organization`, `contact`, `eventAtUTC`...), os mesmos que o serviço Lilly lê.
 */
async function lerConversa(chatId) {
  const chat = await chamar(() => http().get(`/v1/chats/${enc(chatId)}/`, { params: { organizationId: organizacao() } }));
  const org = chat && (chat.organization?.id ?? chat.organizationId);
  return {
    organizationId: org == null ? '' : `${org}`,
    contact: {
      id: chat?.contact?.id == null ? '' : `${chat.contact.id}`, tags: Array.isArray(chat?.contact?.tags) ? chat.contact.tags : [],
      // Conversa interna da equipe (Lilly v708): tipo do contato e membros, só para o `events/resolve` conferir quem conversa com quem.
      contactType: typeof chat?.contact?.contactType === 'string' ? chat.contact.contactType : null,
      organizationMembers: (Array.isArray(chat?.contact?.organizationMembers) ? chat.contact.organizationMembers : [])
        .map((m) => (m && typeof m === 'object' ? m.id : m)).filter((id) => id != null).map(String),
    },
    channel: chat?.channel ? { id: chat.channel.id == null ? '' : `${chat.channel.id}`, type: chat.channel._t ?? chat.channel.Type ?? chat.channel.type ?? null } : null,
  };
}

async function lerMensagem(chatId, messageId) {
  const m = await chamar(() => http().get(`/v1/messages/${enc(messageId)}/`, { params: { organizationId: organizacao() } }));
  return {
    id: `${m?.id ?? ''}`,
    isPrivate: m?.isPrivate === true,
    source: m?.source ?? null,
    sentByOrganizationMember: m?.sentByOrganizationMember ?? null,
    fromContact: m?.fromContact === true,
    content: typeof m?.content === 'string' ? m.content : '',
    eventAt: m?.eventAtUTC ?? m?.eventAt ?? null,
    botInstance: m?.botInstance ?? null,
    automated: m?.automated === true,
    metadata: m?.metadata ?? null,
    file: m?.file ?? null,
  };
}

/** Leitor completo que o `events/resolve` usa por padrão. */
const leitorDeEventos = { lerConversa, lerMensagem };

/* ---------- Escrita (desligada por padrão) ---------- */

/** Nota no contato, visível só para a equipe. `content` é texto puro. */
async function criarNota(contactId, content) {
  exigirEscrita();
  const texto = `${content ?? ''}`.trim();
  if (!texto) throw new UmblerErro('Nota vazia.', { codigo: 'UMBLER_NOTA_VAZIA' });
  return chamar(() => http().post(`/v1/contacts/${enc(contactId)}/notes/`, { content: texto, organizationId: organizacao() }));
}

module.exports = {
  UmblerErro,
  lerContato,
  buscarContatoPorTelefone,
  listarNotas,
  listarCamposPersonalizados,
  listarRobos,
  listarWebhooks,
  lerConversa,
  lerMensagem,
  leitorDeEventos,
  criarNota,
};
