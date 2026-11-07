'use strict';

/**
 * Prova da autorização humana (Maturacao/59, R1 e D10; Maturacao/60, item 4): `payload.authorizedEventId` precisa ser um evento JÁ
 * RESOLVIDO pela API com `staffAuthorized:true` (`gf_lilly_eventos`), da MESMA conversa e da mesma cliente. `authorizedBy` e `proposalId`
 * têm de estar presentes e, se o evento os trouxer, coincidir. A API não vê a proposta da Lilly: valor e referências só são comparados
 * quando o evento os traz (NÃO RESPONDIDO pelo contrato o que o evento humano carrega).
 */

const eventos = require('../dados/eventos.repo');
const { ehObjeto, texto } = require('./executores.comum');

const iguais = (a, b) => {
  const x = `${a}`.trim().toLowerCase(); const y = `${b}`.trim().toLowerCase();
  return x === y || (x !== '' && y !== '' && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) && Number(x) === Number(y)); // 67.5 == 67.50
};

/** @returns {Promise<{motivo:string|null, evento?:object, dados:{proposalId:string, authorizedBy:string, authorizedEventId:string}}>} */
async function provarAutorizacao(executor, acao, { proposto = {} } = {}) {
  const p = ehObjeto(acao.payload) ? acao.payload : {};
  const dados = { proposalId: texto(p.proposalId), authorizedBy: texto(p.authorizedBy), authorizedEventId: texto(p.authorizedEventId) };
  if (!dados.proposalId || !dados.authorizedBy || !dados.authorizedEventId) return { motivo: 'A ação precisa da autorização humana (proposta, autorizador e evento).', dados };
  const evento = await eventos.buscarEventoAutorizado(executor, dados.authorizedEventId, { conversationId: texto(acao.conversationId), clientId: acao.clientId ? `${acao.clientId}` : undefined });
  if (!evento) return { motivo: 'Não encontrei a autorização da equipe para esta conversa e esta cliente.', dados };
  const d = evento.data || {};
  if (d.staffId && dados.authorizedBy !== 'staff' && !iguais(d.staffId, dados.authorizedBy)) return { motivo: 'O autorizador informado não confere com quem autorizou na conversa.', dados, evento };
  if (d.proposalId && !iguais(d.proposalId, dados.proposalId)) return { motivo: 'A proposta informada não confere com a autorizada na conversa.', dados, evento };
  for (const [campo, valor] of Object.entries(proposto)) {
    if (valor !== undefined && d[campo] !== undefined && !iguais(d[campo], valor)) return { motivo: 'Os dados da ação não conferem com o que foi autorizado.', dados, evento };
  }
  return { motivo: null, evento, dados };
}

module.exports = { provarAutorizacao };
