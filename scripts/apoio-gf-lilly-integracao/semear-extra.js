'use strict';

/** Vínculos extras (clientes do legado simulado) para as ações: uma cliente por assunto, para as ações não colidirem entre si. */
async function semearExtra({ r, avulso }) {
  const vinculos = require(r('src/gestao-fadas/features/lilly/dados/vinculos.repo'));
  const pares = [['900103', 'chat-C', 'ct-C'], ['900104', 'chat-D', 'ct-D'], ['900105', 'chat-E', 'ct-E'], ['900106', 'chat-F', 'ct-F'], ['900107', 'chat-G', 'ct-G'], ['900108', 'chat-H', 'ct-H'], ['900109', 'chat-I', 'ct-I']];
  for (const [clientId, conversationId, contactId] of pares) await vinculos.salvarVinculo(avulso, { clientId, contactId, conversationId, verified: true, active: true });
}

module.exports = { semearExtra };
