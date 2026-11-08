'use strict';

/**
 * `team_reply` (Lilly v708, docs/ALTERACOES_LILLY_V708 §7): resposta INTERNA da Lilly a uma pergunta da equipe (conversa individual com a Lilly ou
 * grupo interno). O Gestão só VALIDA: o envio é do adaptador Umbler (`isPrivate:true`, `skipReassign:true`), nunca uma gravação em
 * `POST /lilly/actions` (sem `executar`, a rota responde 422 como as demais ações só-Umbler). Valida:
 *  - texto (`payload.text`, até 4096) e, se vier, `payload.templateValues.resposta_sugerida` (texto);
 *  - sem cliente: conversa da equipe nunca é cadastro, pagamento ou vínculo de cliente;
 *  - o evento da pergunta (`sourceEventId`) foi RESOLVIDO pelo Gestão (`gf_lilly_eventos`), é desta conversa, da equipe, com `staffAuthorized:true`
 *    e escopo interno (`direct`/`group`); a prova `teamAssistant` da Lilly, se vier, bate com o evento (autor, membro, mensagem original).
 */

const { registrar } = require('../acoes/acoes.registro');
const eventos = require('../dados/eventos.repo');
const { permitido, nao } = require('./validacao.base');
const { ehObjeto, texto } = require('./executores.comum');
const { avulso } = require('../dados/executor');

const LIMITE_UMBLER = 4096;

function registrarTeamReply() {
  registrar('team_reply', {
    async validar(acao) {
      const p = ehObjeto(acao.payload) ? acao.payload : {};
      if (typeof p.text !== 'string' || !p.text.trim()) return nao('A resposta interna não traz o texto.');
      if (p.text.length > LIMITE_UMBLER) return nao('A resposta interna é maior que o limite da Umbler.');
      const modelo = ehObjeto(p.templateValues) ? p.templateValues.resposta_sugerida : undefined;
      if (modelo !== undefined && typeof modelo !== 'string') return nao('resposta_sugerida precisa ser texto.');
      const conversa = texto(acao.conversationId);
      if (!conversa) return nao('A ação não informa a conversa.');
      if (texto(`${acao.clientId ?? ''}`)) return nao('Resposta interna não leva cliente: a conversa da equipe nunca é cadastro nem pagamento.');
      const origem = texto(acao.sourceEventId);
      if (!origem) return nao('Informe o evento da pergunta da equipe.');
      const evento = await eventos.buscarEventoAutorizado(avulso, origem, { conversationId: conversa });
      if (!evento) return nao('Não encontrei a autorização da equipe para esta conversa interna.');
      const d = evento.data || {};
      if (evento.actor !== 'staff' || d.conversationScope !== 'internal' || !['direct', 'group'].includes(d.internalScope)) return nao('A pergunta não veio de uma conversa interna da equipe.');
      const prova = acao.teamAssistant;
      if (prova !== undefined) {
        if (!ehObjeto(prova) || prova.verified !== true) return nao('A prova da pergunta interna não é válida.');
        if (texto(prova.conversationId) !== conversa) return nao('A prova da pergunta interna é de outra conversa.');
        if (texto(prova.authorMemberId) !== texto(d.staffMemberId) || texto(prova.staffId) !== texto(d.staffId)) return nao('Quem perguntou não confere com a atendente autorizada.');
        if (texto(prova.sourceMessageId) !== texto(d.messageId)) return nao('A mensagem original não confere com a pergunta resolvida.');
        if (prova.scope !== undefined && prova.scope !== d.internalScope) return nao('O tipo da conversa interna não confere.');
      }
      return permitido(acao);
    },
  });
}

module.exports = { registrarTeamReply };
