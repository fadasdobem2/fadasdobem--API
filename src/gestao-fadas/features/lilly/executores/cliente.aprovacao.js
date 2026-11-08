'use strict';

/**
 * Prova da autorização humana do CADASTRO (`registrationApproval`, docs/banco/21 §2 da Nice): `proposalId`, `authorizedEventId`, `authorizedBy`
 * e `payloadSignature`, ligados à proposta da Lilly e aos dados autorizados. O Gestão não vê a proposta, mas confere o que dá para provar:
 * o evento existe em `gf_lilly_eventos` com `staffAuthorized:true` na MESMA conversa, quem autorizou é quem o evento diz, a proposta é a do
 * payload e a assinatura dos dados confere com o payload recebido (mesma canonização de `registration-policy.mjs`). Uma flag solta no
 * payload NUNCA vale. Funções puras + uma leitura de evento.
 */

const eventos = require('../dados/eventos.repo');
const { ehObjeto, texto } = require('./executores.comum');

function canonico(v) {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canonico(v[k])]));
  return v;
}

/** Assinatura dos dados autorizados: o payload sem os campos da própria autorização. */
function assinaturaDosDados(payload) {
  const { proposalId, authorizedBy, authorizedEventId, ...dados } = ehObjeto(payload) ? payload : {};
  return JSON.stringify(canonico(dados));
}

/** @returns {Promise<{ motivo: string|null }>} */
async function conferirAprovacao(executor, acao) {
  const ap = acao.registrationApproval;
  if (!ehObjeto(ap)) return { motivo: 'O cadastro novo aguarda a autorização de uma atendente nesta conversa.' };
  const dados = { proposalId: texto(ap.proposalId), authorizedEventId: texto(ap.authorizedEventId), authorizedBy: texto(ap.authorizedBy), payloadSignature: typeof ap.payloadSignature === 'string' ? ap.payloadSignature : '' };
  if (!dados.proposalId || !dados.authorizedEventId || !dados.authorizedBy || !dados.payloadSignature) return { motivo: 'A autorização do cadastro está incompleta.' };
  const p = ehObjeto(acao.payload) ? acao.payload : {};
  if (p.proposalId !== undefined && texto(p.proposalId) !== dados.proposalId) return { motivo: 'A proposta do cadastro não confere com a autorizada.' };
  if (assinaturaDosDados(p) !== dados.payloadSignature) return { motivo: 'Os dados do cadastro mudaram depois da autorização. Peça a confirmação de novo.' };
  const evento = await eventos.buscarEventoAutorizado(executor, dados.authorizedEventId, { conversationId: texto(acao.conversationId) });
  if (!evento) return { motivo: 'Não encontrei a autorização da equipe para esta conversa.' };
  const staff = evento.data && evento.data.staffId;
  if (staff && `${staff}` !== dados.authorizedBy) return { motivo: 'Quem autorizou o cadastro não confere com o evento da conversa.' };
  return { motivo: null, evento };
}

module.exports = { conferirAprovacao, assinaturaDosDados };
