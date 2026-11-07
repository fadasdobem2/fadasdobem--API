'use strict';

/**
 * Aviso de agenda declarado pela atendente (domínio puro), v706 da Nice. Porte de `features/agenda/manual-agenda-notice.ts`
 * (`recordManualAgendaNotice`) e do que `agenda-unified-history-model.ts` mostra dele. Abrir WhatsApp ou copiar a mensagem NÃO
 * confirma que avisou: só este registro, com autora, destinatária, canal e hora. Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 */

const { encerrado } = require('./agenda-contato');

const CANAIS_DE_AVISO = Object.freeze(['Umbler', 'WhatsApp', 'Telefone']);

/** Devolve a MESMA lista quando o aviso já estava registrado (idempotente por id). */
function registrarAvisoManual(itens, agendaId, aviso) {
  const item = itens.find((r) => r.id === agendaId);
  if (!item) throw new Error('Este agendamento já saiu da agenda.');
  if ((item.manualNotices || []).some((r) => r.id === aviso.id)) return itens;
  if (encerrado(item) || item.workflowStatus === 'Em consulta') throw new Error('O agendamento já mudou de situação. Confira a ficha da cliente.');
  const destinatario = item.clientId || item.leadId;
  if (!destinatario || destinatario !== aviso.recipientId || aviso.recipientKind !== (item.clientId ? 'client' : 'lead')) throw new Error('A cliente deste agendamento mudou. Confira a ficha antes de registrar.');
  if (!aviso.id || !aviso.actorId || !aviso.actorName || !CANAIS_DE_AVISO.includes(aviso.channel) || !Number.isFinite(Date.parse(aviso.at))) throw new Error('Confira a conta, o horário e o canal do aviso.');
  return itens.map((r) => (r === item ? { ...r, manualNotices: [...(r.manualNotices || []), aviso] } : r));
}

module.exports = { CANAIS_DE_AVISO, registrarAvisoManual };
