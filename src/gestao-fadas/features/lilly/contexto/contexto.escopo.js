'use strict';

/**
 * Escopo do snapshot: do evento recebido, o que precisa ser lido (Maturacao/59, 2.1 e 3.1). Puro, sem banco. O snapshot cobre o necessário
 * para o evento (as conversas dele, as clientes dessas conversas, os tarólogos e a fila do dia), nunca o banco inteiro.
 */

const { LIMITES } = require('./contexto.limites');

const objeto = (v) => v && typeof v === 'object' && !Array.isArray(v);
const texto = (v, max = 160) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : '');
const idCliente = (v) => { const t = `${v ?? ''}`.trim(); return /^\d{1,10}$/.test(t) && Number(t) >= 1 && Number(t) <= 2147483647 ? t : ''; };
const unicos = (l) => [...new Set(l.filter(Boolean))];

/** Assuntos que todo evento exige para `complete:true` (3.1: "sem estes o motor não funciona" + presença + pagamentos). */
const ASSUNTOS_BASE = Object.freeze([
  'clients', 'links', 'tarologists', 'appointments', 'consultations', 'messages', 'payments', 'schedules',
  'scheduleNotes', 'notices', 'consultationQuotes', 'restrictions', 'divergences', 'financialSettings',
]);

/** Telefone do contato da conversa (lido da Umbler pela Lilly; o evento só o repassa). Nunca de `event.data` (isso vem da IA). */
function telefoneObservado(conversation) {
  const contato = objeto(conversation) && objeto(conversation.contact) ? conversation.contact : null;
  if (!contato) return '';
  const bruto = contato.phoneNumber ?? contato.phone ?? contato.number;
  return typeof bruto === 'string' || typeof bruto === 'number' ? `${bruto}`.slice(0, 40) : '';
}

/**
 * @returns {{ tipo, conversationIds, clientId, tarologistId, appointmentId, consultationId, paymentId, referencias, telefone,
 *             excedeuConversas, semConversa, revisaoDaManha, verificaCapacidade }}
 */
function derivarEscopo(body) {
  const event = objeto(body.event) ? body.event : {};
  const data = objeto(event.data) ? event.data : {};
  const referencias = Array.isArray(event.noticeReferences) ? event.noticeReferences.filter(objeto) : [];
  const conversas = unicos([texto(event.conversationId), ...referencias.map((r) => texto(r.conversationId))]);
  const tipo = texto(event.type, 60) || 'message';
  const relogio = tipo === 'timer';
  const revisaoDaManha = tipo === 'morning_review_page';
  const clientId = idCliente(event.clientId);
  return {
    tipo,
    conversationIds: conversas.slice(0, LIMITES.CONVERSAS),
    excedeuConversas: conversas.length > LIMITES.CONVERSAS,
    clientId,
    tarologistId: texto(event.tarologistId, 64),
    appointmentId: texto(data.appointmentId, 64),
    consultationId: texto(data.consultationId, 64),
    paymentId: texto(data.paymentId, 64),
    referencias: Object.fromEntries(['reference', 'mpPaymentId', 'externalTransactionId', 'endToEndId'].map((k) => [k, texto(data[k], 160)]).filter(([, v]) => v)),
    telefone: telefoneObservado(body.conversation),
    // Sem conversa nem cliente e fora do relógio/revisão: não há de onde escopar o que é da conversa. Fica incompleto (NÃO RESPONDIDO pelo contrato).
    // Exceção: a pergunta administrativa (`type:'query'`, só leitura) é do dia inteiro ("Osíris está?") e a Lilly manda `conversationId` vazio
    // quando não há conversa selecionada; sem isso toda pergunta de presença sairia "não consegui conferir" (achado da integração com a Lilly real).
    semConversa: !relogio && !revisaoDaManha && tipo !== 'query' && conversas.length === 0 && !clientId,
    revisaoDaManha,
    verificaCapacidade: relogio && event.capacityCheck === true,
  };
}

module.exports = { derivarEscopo, ASSUNTOS_BASE, idCliente, texto, objeto, unicos };
