'use strict';

/**
 * Ações que a Lilly executa na Umbler (`note`, `public_reply`, `mark_attention`, `update_contact`) e a proposta de conhecimento local
 * (`knowledge_proposal`): o Gestão só VALIDA (Maturacao/59, 5.1). Nunca executa: sem `executar` no registro, `POST /lilly/actions` responde 422.
 * Quando há cliente na ação, a conversa precisa estar vinculada a ela (vínculo ativo e verificado). `update_contact` devolve o `contactId` do vínculo.
 */

const { registrar } = require('../acoes/acoes.registro');
const { conferirBaseComVinculo, conferirTarologo, permitido, nao } = require('./validacao.base');
const { texto, ehObjeto } = require('./executores.comum');

const idDoContato = (acao, conversation, vinculo) => texto(vinculo && vinculo.contactId)
  || texto(conversation && conversation.contact && conversation.contact.id) || texto(conversation && conversation.contactId);

function validarComCliente(acao, { exigirCliente = false } = {}) {
  return conferirBaseComVinculo(acao, { exigirCliente, exigirVinculo: acao.clientId !== undefined && acao.clientId !== null });
}

const validarTexto = (acao) => (ehObjeto(acao.payload) && texto(acao.payload.text) ? null : nao('A ação não traz o texto.'));

function registrarSoUmbler() {
  for (const kind of ['note', 'public_reply', 'mark_attention']) {
    registrar(kind, {
      async validar(acao) {
        if (kind !== 'mark_attention') { const sem = validarTexto(acao); if (sem) return sem; }
        const { recusa } = await validarComCliente(acao);
        if (recusa) return recusa;
        if (acao.tarologistId && !String(acao.tarologistId).startsWith('afila')) { const t = await conferirTarologo(`${acao.tarologistId}`); if (t) return t; }
        return permitido(acao);
      },
    });
  }
  registrar('update_contact', {
    async validar(acao, { conversation } = {}) {
      const sem = ehObjeto(acao.payload) && texto(acao.payload.name) ? null : nao('A ação não traz o novo nome do contato.');
      if (sem) return sem;
      const { recusa, vinculo } = await validarComCliente(acao, { exigirCliente: true });
      if (recusa) return recusa;
      const contactId = idDoContato(acao, conversation, vinculo);
      if (!contactId) return nao('Não encontrei o contato desta conversa.');
      return permitido(acao, { contactId });
    },
  });
  registrar('knowledge_proposal', {
    async validar(acao) {
      const p = ehObjeto(acao.payload) ? acao.payload : {};
      if (!texto(p.question) || !texto(p.answer)) return nao('A proposta precisa de pergunta e resposta.');
      return permitido(acao);
    },
  });
}

module.exports = { registrarSoUmbler };
