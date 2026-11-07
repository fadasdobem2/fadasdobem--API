'use strict';

/**
 * Auxiliares das ações: monta a ação no formato que o motor da Lilly emite (engine.mjs:122-125 `emit`: id = idempotencyKey =
 * `<evento>:<sufixo>:<conversa>`, status pending, createdAt, sourceEventId) e obtém a PROVA de autorização pelo caminho real: uma nota privada de
 * membro autorizado passa por `adapter.resolveEvent` (a API grava o evento, que depois vale como `authorizedEventId`).
 */

function criarAuxiliares({ adapter, umbler, AGORA, r }) {
  let n = 0;
  const unico = () => `${Date.now().toString(36)}${(n += 1)}`;
  const ISO = () => new Date().toISOString();

  /** Ação como a Lilly a emite. A chave é longa e com ":" de propósito (formato real). */
  function acao(kind, { conversationId, clientId = '', tarologistId = '', payload = {}, evento, sufixo } = {}) {
    const ev = evento || `umbler:EV${unico()}`;
    const chave = `${ev}:${sufixo || kind}-${'x'.repeat(40)}:${conversationId}`;
    return { id: chave, idempotencyKey: chave, kind, conversationId, clientId, tarologistId, payload, status: 'pending', createdAt: ISO(), sourceEventId: ev };
  }

  /** Evento humano autorizado resolvido pela API (nota privada de membro da lista de ambiente) na conversa `conversationId`. */
  async function autorizar(conversationId, contactId, id = `AUT${unico()}`) {
    umbler.conversa = { organizationId: 'org-teste', contact: { id: contactId, tags: [] } };
    umbler.mensagem = { id: `msg-${id}`, chatId: conversationId, isPrivate: true, source: 'Member', fromContact: null, sentByOrganizationMember: { id: 'membro-autorizada' }, content: 'sim, pode fazer', eventAt: ISO() };
    const wh = { EventId: id, EventDate: ISO(), Type: 'Message', Payload: { Type: 'Chat', Content: { Id: conversationId, LastMessage: { Id: `msg-${id}` } } } };
    const r = await adapter.resolveEvent(wh, 'umbler');
    if (r.event.data.staffAuthorized !== true) throw new Error('evento de autorização não ficou autorizado');
    return { proposalId: `prop-${id}`, authorizedBy: r.event.data.staffId || 'staff', authorizedEventId: r.event.id };
  }

  /** Consulta PREPARADA pelo serviço real da equipe (`ciclo.lancar`): é o que a Lilly vê como `prepared` e depois inicia. */
  async function prepararConsulta(id, clientId, tarotId) {
    const ciclo = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
    const equipe = { user: { id: process.env.LILLY_SERVICE_USER_ID, nome: 'Khloe', role: 'ATENDENTE' }, accessContext: { roleIds: [] }, params: {} };
    await ciclo.lancar({ ...equipe, body: { operationKey: `prep-${id}-${unico()}-abcdef`, record: { id, clientId, client: `Cliente ${clientId}`, tarotId, tarot: tarotId, paymentProfile: 'Pós-paga', channel: 'WhatsApp Áudio', observation: 'x', expectedMinutes: 30 } } });
  }

  /** Resolve a promessa em `{ valor }` ou `{ erro }` (IntegrationError da Lilly). */
  const tentar = (promessa) => promessa.then((valor) => ({ valor }), (erro) => ({ erro }));

  return { acao, autorizar, prepararConsulta, tentar, unico, ISO };
}

module.exports = { criarAuxiliares };
