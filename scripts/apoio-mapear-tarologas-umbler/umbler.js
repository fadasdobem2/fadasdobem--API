'use strict';

/**
 * Procura de UM telefone na Umbler pelo provider existente (somente `buscarContatoPorTelefone`, GET /v1/contacts/phone/; nada de escrita é entregue a
 * este módulo). O formato exato da resposta real ainda não foi conferido: a leitura aceita objeto com `id`, `{ contact }` ou lista (`items`, `contacts`, `data`
 * ou array puro) e procura o id do chat em nomes comuns. O que não for reconhecido vira "sem chat" e aparece no relatório, nunca é inventado.
 */

const { variantes, mascarar } = require('./telefone');

const texto = (v) => (v === null || v === undefined || v === '' ? null : `${v}`);

function listaDe(resposta) {
  if (!resposta) return [];
  if (Array.isArray(resposta)) return resposta;
  for (const k of ['items', 'contacts', 'data', 'results']) if (Array.isArray(resposta[k])) return resposta[k];
  if (resposta.contact && typeof resposta.contact === 'object') return [resposta.contact];
  return typeof resposta === 'object' && resposta.id !== undefined ? [resposta] : [];
}

const chatDe = (c) => texto(c.chatId ?? c.lastChatId ?? c.lastActiveChatId ?? (c.chat && c.chat.id) ?? (c.lastChat && c.lastChat.id) ?? (c.currentChat && c.currentChat.id)
  ?? (c.openChat && c.openChat.id) ?? (Array.isArray(c.chats) && c.chats[0] ? c.chats[0].id : null) ?? null);

/** Contatos reconhecidos na resposta: `{ contactId, nome, chatId }` (só o necessário; telefone e o resto da resposta não saem). */
const contatosDe = (resposta) => listaDe(resposta).filter((c) => c && typeof c === 'object' && texto(c.id)).map((c) => ({ contactId: `${c.id}`, nome: texto(c.name ?? c.contactName ?? c.displayName), chatId: chatDe(c) }));

/**
 * @param {{ buscarContatoPorTelefone: (tel: string) => Promise<any> }} provider
 * @param {string} telefone
 * @returns {Promise<{ resultado: 'encontrado'|'nao_encontrado'|'sem_variante'|'erro', contatos: object[], variante?: string, erro?: object }>}
 */
async function procurar(provider, telefone) {
  const formas = variantes(telefone);
  if (!formas.length) return { resultado: 'sem_variante', contatos: [] };
  for (const forma of formas) {
    try {
      const contatos = contatosDe(await provider.buscarContatoPorTelefone(forma));
      if (contatos.length) return { resultado: 'encontrado', contatos, variante: mascarar(forma) };
    } catch (e) {
      // 404 = esse número não existe na Umbler (segue para a outra forma); qualquer outra falha para aqui, só com código e status (o provider já tira token e corpo).
      if (e && e.status === 404) continue;
      return { resultado: 'erro', contatos: [], erro: { codigo: (e && e.codigo) || 'ERRO', status: (e && e.status) || null } };
    }
  }
  return { resultado: 'nao_encontrado', contatos: [] };
}

module.exports = { procurar, contatosDe };
