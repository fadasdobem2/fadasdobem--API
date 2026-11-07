'use strict';

/**
 * Identidade do agendamento (domínio puro), v706 da Nice: cada agendamento tem exatamente UMA identidade atual, cliente OU contato (lead).
 * Porte de `features/agenda/agenda-identity.ts` do front: `agendaIdentityKey`, `sameAgendaIdentity`, `agendaIdentityError`,
 * `requestAgendaIdentity`, `requestMatchesAgendaIdentity`, `applyContactToAgenda`. Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 * Diferença única: o front lê `operationToday()` por dentro; aqui o dia operacional entra por parâmetro (`hoje`).
 */

const { encerrado, dataDeOrigem, ativoNoDia } = require('./agenda-contato');

/** ID vazio nunca identifica todos os contatos como a mesma pessoa. */
function chaveDeIdentidade(identidade) {
  const clientId = (identidade.clientId || '').trim();
  const leadId = (identidade.leadId || '').trim();
  if (Boolean(clientId) === Boolean(leadId)) return undefined;
  return clientId ? `client:${clientId}` : `lead:${leadId}`;
}
const ehDeCliente = (item) => (chaveDeIdentidade(item) || '').startsWith('client:');

function mesmaIdentidade(a, b) {
  const chave = chaveDeIdentidade(a);
  return Boolean(chave && chave === chaveDeIdentidade(b));
}

function erroDeIdentidade(identidade, contatos) {
  const clientId = (identidade.clientId || '').trim();
  const leadId = (identidade.leadId || '').trim();
  if (clientId && leadId) return 'Selecione uma cliente ou um contato para este agendamento.';
  if (!clientId && !leadId) return 'Localize a cliente ou informe um contato para agendar.';
  if (leadId && contatos) {
    const lead = contatos.find((c) => c.id === leadId);
    if (!lead || lead.archived || lead.clientId || lead.classification === 'client') return 'Este contato mudou. Localize a pessoa novamente antes de salvar.';
    if (!lead.name.trim() || !lead.whatsapp.trim()) return 'Complete o nome e o WhatsApp do contato.';
  }
  return '';
}

/** `contactId` fica como histórico após a conversão em cliente; não é uma segunda identidade atual. */
function identidadeDoPedido(pedido) {
  const clientId = (pedido.clientId || '').trim();
  return clientId ? { clientId } : { clientId: '', leadId: pedido.contactId };
}
const pedidoCombinaComIdentidade = (pedido, item) => mesmaIdentidade(identidadeDoPedido(pedido), item);

const CONFLITO = 'Esta cliente já tem outro agendamento ativo com a profissional nesta data. Confira os dois agendamentos antes de vincular o contato.';

/** Atualiza só os itens deste contato, preservando ids, datas, ordem e todo o histórico. Devolve o MESMO array quando nada muda. */
function aplicarContatoNaAgenda(agenda, contato, ator, em, hoje) {
  const destino = (contato.clientId || '').trim();
  if (destino) {
    for (const item of agenda.filter((i) => i.leadId === contato.id && !encerrado(i))) {
      const data = dataDeOrigem(item, hoje);
      const colisao = agenda.some((o) => o.id !== item.id && o.tarotId === item.tarotId && !encerrado(o)
        && (o.clientId === destino || o.leadId === contato.id)
        && (dataDeOrigem(o, hoje) === data || (ativoNoDia(item, hoje, hoje) && ativoNoDia(o, hoje, hoje))));
      if (colisao) throw new Error(CONFLITO);
    }
  }
  let mudou = false;
  const proxima = agenda.map((item) => {
    if (!contato.clientId && contato.identityUndo && item.sourceLeadId === contato.id) {
      if (item.clientId !== contato.identityUndo.clientId) throw new Error('A identificação da agenda mudou. Confira o vínculo antes de desfazer.');
      mudou = true;
      return { ...item, clientId: '', leadId: contato.id, sourceLeadId: undefined, client: contato.name, identityHistory: [...(item.identityHistory || []), { leadId: contato.id, clientId: '', by: contato.identityUndo.by, at: contato.identityUndo.at }] };
    }
    if (item.leadId !== contato.id) return item;
    if (item.clientId) throw new Error('O agendamento tem duas identificações. Confira o vínculo antes de continuar.');
    const clientId = (contato.clientId || '').trim();
    if (!clientId && item.client === contato.name) return item;
    mudou = true;
    return clientId
      ? { ...item, clientId, leadId: undefined, sourceLeadId: contato.id, client: contato.name, identityHistory: [...(item.identityHistory || []), { leadId: contato.id, clientId, by: ator, at: em }] }
      : { ...item, client: contato.name };
  });
  return mudou ? proxima : agenda;
}

module.exports = { chaveDeIdentidade, ehDeCliente, mesmaIdentidade, erroDeIdentidade, identidadeDoPedido, pedidoCombinaComIdentidade, aplicarContatoNaAgenda };
