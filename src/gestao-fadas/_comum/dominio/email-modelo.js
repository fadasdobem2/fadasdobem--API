'use strict';

/**
 * Configuração de e-mails (v711), regras do CÓDIGO do front: features/email/email-model.ts (validMailbox, validMailId, emptyEmailSettings,
 * validateEmailSettings). Puro e sem rede. Quatro finalidades, cada uma com remetente próprio e uma conexão (SMTP 465/TLS, 587/STARTTLS ou Resend).
 * O segredo da conexão NUNCA entra aqui: `hasSecret` só diz que existe um guardado.
 */

const FINALIDADES = Object.freeze(['financeiro', 'usuarios', 'marketing', 'institucional']);
const ROTULOS = Object.freeze({ financeiro: 'Financeiro', usuarios: 'Usuários', marketing: 'Marketing', institucional: 'Institucional' });
const MSG_CONFIG = 'Confira a configuração de e-mails.';

const validMailbox = (s) => typeof s === 'string' && s.length <= 254
  && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(s);
const validMailId = (s) => typeof s === 'string' && !['__proto__', 'constructor', 'prototype'].includes(s) && /^[a-zA-Z0-9_-]{1,80}$/.test(s);
const semQuebra = (v) => !/[\r\n\0]/.test(v);

const emptyEmailSettings = () => ({
  revision: 0,
  connections: [],
  purposes: Object.fromEntries(FINALIDADES.map((p) => [p, { senderName: '', from: '', replyTo: '', connectionId: '' }])),
});

function conexao(c, ids) {
  if (!c || !validMailId(c.id) || ids.has(c.id) || typeof c.label !== 'string' || !c.label.trim() || c.label.length > 100 || !semQuebra(c.label)) {
    throw new Error('Confira o nome e a identificação das conexões.');
  }
  ids.add(c.id);
  if (c.transport === 'resend') return { id: c.id, label: c.label.trim(), transport: c.transport, hasSecret: Boolean(c.hasSecret) };
  const portaSegura = (c.port === 465 && c.security === 'tls') || (c.port === 587 && c.security === 'starttls');
  if (c.transport !== 'smtp' || typeof c.host !== 'string' || !/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(c.host) || c.host.length > 253
    || /\.(localhost|local|internal)$/i.test(c.host) || !portaSegura || typeof c.username !== 'string' || !c.username.trim() || c.username.length > 254 || !semQuebra(c.username)) {
    throw new Error('Confira o servidor SMTP, usuário e conexão segura (465/TLS ou 587/STARTTLS).');
  }
  return { id: c.id, label: c.label.trim(), transport: c.transport, host: c.host.toLowerCase(), port: c.port, security: c.security, username: c.username.trim(), hasSecret: Boolean(c.hasSecret) };
}

function validateEmailSettings(value) {
  if (!value || typeof value !== 'object') throw new Error(MSG_CONFIG);
  const s = value;
  if (!Number.isSafeInteger(s.revision) || s.revision < 0 || !Array.isArray(s.connections) || s.connections.length > 20 || !s.purposes) throw new Error(MSG_CONFIG);
  const ids = new Set();
  const connections = s.connections.map((c) => conexao(c, ids));
  const purposes = {};
  for (const p of FINALIDADES) {
    const c = s.purposes[p];
    if (!c || [c.senderName, c.from, c.replyTo, c.connectionId].some((v) => typeof v !== 'string' || !semQuebra(v))) throw new Error(`Confira o remetente de ${ROTULOS[p]}.`);
    const n = { senderName: c.senderName.trim(), from: c.from.trim().toLowerCase(), replyTo: c.replyTo.trim().toLowerCase(), connectionId: c.connectionId };
    if (Object.values(n).some(Boolean) && (!n.senderName || n.senderName.length > 120 || !validMailbox(n.from) || (n.replyTo && !validMailbox(n.replyTo)) || !ids.has(n.connectionId))) {
      throw new Error(`Complete o remetente e escolha uma conexão para ${ROTULOS[p]}.`);
    }
    purposes[p] = n;
  }
  return { revision: s.revision, connections, purposes };
}

module.exports = { FINALIDADES, ROTULOS, validMailbox, validMailId, emptyEmailSettings, validateEmailSettings };
