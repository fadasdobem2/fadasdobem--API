'use strict';

/**
 * Conversas INTERNAS da equipe na Umbler (Lilly v708, docs/ALTERACOES_LILLY_V708 §7 da Nice): `MemberDirectMessage` (conversa individual atendente x Lilly),
 * `MemberGroup` e `PrivateMemberGroup` (grupos internos). Porta de `umbler-conversation-scope.mjs` e de `verifyTeamAssistantEvent`
 * (`team-assistant.mjs`). Grupo de WhatsApp continua FORA (o escopo interno exige o canal de membros).
 * A autoria vem da mensagem RELIDA na Umbler e dos membros da conversa, nunca do texto. DECISÃO DA NICE (confirmada no chat): TODOS os atendentes
 * online podem autorizar comandos da Lilly. "Online" só é conferido se o leitor souber dizer (`lerMembro`); um membro conhecido como NÃO online não autoriza.
 */

const { EventoRecusadoError } = require('./eventos.erros');

const ESCOPO_DO_TIPO = { MemberDirectMessage: 'direct', MemberGroup: 'group', PrivateMemberGroup: 'group' };
const CANAIS_DE_MEMBROS = ['ChatMembersChannelReferenceModel', 'MembersChannelModel'];

const recusa = (code, msg) => new EventoRecusadoError(code, msg);
const membrosDe = (conversa) => (Array.isArray(conversa && conversa.contact && conversa.contact.organizationMembers) ? conversa.contact.organizationMembers.map(String) : []);

/** `'direct'` | `'group'` | `null` (conversa de cliente, de tarólogo ou grupo de WhatsApp). */
function escopoInterno(conversa) {
  const tipo = conversa && conversa.contact && conversa.contact.contactType;
  const canal = conversa && conversa.channel && conversa.channel.type;
  if (canal && !CANAIS_DE_MEMBROS.includes(canal)) return null;
  return ESCOPO_DO_TIPO[tipo] || null;
}

/** O membro autor pode comandar a Lilly NESTA conversa interna? (membros, conta da Lilly, permissão, presença) */
function podeAutorizar(membro, conversa, escopo, { equipe, contasLilly, todos, online }) {
  if (!contasLilly.size) return false; // sem saber qual é a conta da Lilly, não dá para provar quem conversa com quem
  const membros = membrosDe(conversa);
  const comLilly = membros.some((m) => contasLilly.has(m));
  if (escopo === 'direct' && !(new Set(membros).size === 2 && membros.includes(membro) && comLilly)) return false;
  if (conversa.contact.contactType === 'PrivateMemberGroup' && !(membros.includes(membro) && comLilly)) return false;
  if (online === false) return false;
  return todos ? true : equipe.has(membro);
}

/**
 * Autoria de uma mensagem em conversa interna. `{ actor, internal:true, staffId?, staffMemberId?, staffAuthorized, automated, escopo, contactType }`.
 * Mensagem do contato numa conversa interna não existe: recusa.
 */
function autoriaInterna(mensagem, conversa, escopo, ambiente) {
  const membro = mensagem.sentByOrganizationMember && mensagem.sentByOrganizationMember.id ? `${mensagem.sentByOrganizationMember.id}` : null;
  const meta = mensagem.metadata && typeof mensagem.metadata === 'object' ? mensagem.metadata : {};
  const base = { internal: true, staffAuthorized: false, automated: false, escopo, contactType: conversa.contact.contactType };
  if (meta.lillyActionId || (membro && ambiente.contasLilly.has(membro))) return { ...base, actor: 'lilly' };
  if (mensagem.botInstance || mensagem.automated === true) return { ...base, actor: 'system', automated: true };
  if (!membro) throw recusa('LILLY_EVENT_AUTHOR_UNVERIFIED', 'Não foi possível confirmar quem enviou a mensagem interna.');
  const membroNativo = /^(member|organizationmember)$/i.test(`${mensagem.source || ''}`) && mensagem.forwardedFrom == null;
  return { ...base, actor: 'staff', staffId: membro, staffMemberId: membro, staffAuthorized: membroNativo && podeAutorizar(membro, conversa, escopo, ambiente) };
}

module.exports = { escopoInterno, autoriaInterna, podeAutorizar, membrosDe };
