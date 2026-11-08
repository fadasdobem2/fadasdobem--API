'use strict';

/**
 * Autoria de uma mensagem da Umbler (Maturacao/59, 4.5 itens 3, 4, 5 e 7). Tudo vem da mensagem RELIDA na Umbler e do ambiente,
 * nunca do texto, do nome de perfil ou do webhook. `staffAuthorized` só é verdadeiro para membro nativo (nunca a Lilly) em Nota privada
 * (decisão da Nice na v708: todos os atendentes online; com `todos` falso, só a lista `LILLY_STAFF_AUTORIZADA`).
 */

const { EventoRecusadoError } = require('./eventos.erros');

const semAcento = (s) => `${s || ''}`.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const nomesDasEtiquetas = (tags) => (Array.isArray(tags) ? tags : []).map((t) => semAcento(typeof t === 'string' ? t : t && t.name));

/** Papel do contato pelas etiquetas DO CONTATO: grupo/equipe excluem; "tarólogo" não é cliente. */
function papelDoContato(conversa) {
  const tags = nomesDasEtiquetas(conversa && conversa.contact && conversa.contact.tags);
  if (tags.includes('grupo')) return 'group';
  if (tags.includes('equipe')) return 'internal';
  if (tags.includes('tarologo') || tags.includes('tarologa')) return 'tarologist';
  return 'client';
}

const recusa = (code, msg) => new EventoRecusadoError(code, msg);

/**
 * @returns {{ actor, internal, staffId?, staffAuthorized, automated }}
 */
function autoriaDaMensagem(mensagem, conversa, { equipe, contasLilly, temVinculo, todos = false, online }) {
  if (typeof mensagem.isPrivate !== 'boolean') throw recusa('LILLY_EVENT_PRIVACY_UNKNOWN', 'A Umbler não informou se a mensagem é privada.');
  const internal = mensagem.isPrivate;
  const membro = mensagem.sentByOrganizationMember && mensagem.sentByOrganizationMember.id ? `${mensagem.sentByOrganizationMember.id}` : null;
  const meta = mensagem.metadata && typeof mensagem.metadata === 'object' ? mensagem.metadata : {};
  const base = { internal, staffAuthorized: false, automated: false };

  if (meta.lillyActionId || (membro && contasLilly.has(membro))) return { ...base, actor: 'lilly' };
  if (mensagem.botInstance || mensagem.automated === true) return { ...base, actor: 'system', automated: true };
  if (membro) {
    // Decisão da Nice (v708): todos os atendentes online autorizam (`todos`); com `todos` falso vale só a lista do ambiente. Membro sabidamente offline não autoriza.
    const autorizada = internal && online !== false && (todos || equipe.has(membro));
    return { ...base, actor: 'staff', staffId: membro, staffAuthorized: autorizada };
  }
  const doContato = mensagem.source === 'Contact' && mensagem.fromContact && conversa.contact
    && `${mensagem.fromContact.id}` === `${conversa.contact.id}`;
  if (!doContato) throw recusa('LILLY_EVENT_AUTHOR_UNVERIFIED', 'Não foi possível confirmar quem enviou a mensagem.');
  if (internal) throw recusa('LILLY_EVENT_AUTHOR_UNVERIFIED', 'Mensagem privada não pode ser do contato.');
  if (papelDoContato(conversa) === 'tarologist') return { ...base, actor: 'tarologist' };
  return { ...base, actor: temVinculo ? 'client' : 'contact' };
}

module.exports = { autoriaDaMensagem, papelDoContato, semAcento };
