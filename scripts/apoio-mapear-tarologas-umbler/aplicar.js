'use strict';

/**
 * `--aplicar <arquivo-aprovado.json>`: grava `umblerContact` (`directory.umblerContact` do catálogo, o campo da v711 que a Lilly lê) SÓ dos itens com
 * `"aprovar": true`, um a um, pelo serviço oficial do perfil (`PUT /catalog/tarologists/:tarotId/profile`: valida, confere a revisão, audita, idempotente).
 * Recusa o que mudou desde o relatório (revisão diferente) e não troca um vínculo existente diferente sem `"sobrescrever": true`. Não toca no legado.
 * O catálogo e o serviço entram por parâmetro (o teste usa os falsos). `simular` só diz o que gravaria.
 */

const fs = require('fs');

const ATOR_NOME = 'script mapear-tarologas-umbler';
const ID = /^[\w.-]+$/;

function lerAprovados(arquivo) {
  const j = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  if (!j || !Array.isArray(j.itens)) throw new Error('O arquivo aprovado precisa ter a lista "itens" do relatório.');
  return j.itens;
}

/** Conferência de um item aprovado contra o catálogo de agora. Devolve `{ erro }` ou `{ contato, revisao }`. */
function conferir(item, atual) {
  if (!item.proposta || typeof item.proposta.contactId !== 'string' || !ID.test(item.proposta.contactId)) return { erro: 'sem contato válido em "proposta".' };
  const conv = item.proposta.conversationId;
  if (conv !== undefined && (typeof conv !== 'string' || !ID.test(conv))) return { erro: '"conversationId" inválido.' };
  if (!atual) return { erro: 'taróloga não está mais no catálogo.' };
  if (atual.registrationActive === false) return { erro: 'o cadastro da taróloga não está mais ativo.' };
  if (item.revisao !== atual.revision) return { erro: `o cadastro mudou depois do relatório (revisão ${item.revisao} -> ${atual.revision}); gere o relatório de novo.` };
  const contato = { contactId: item.proposta.contactId, ...(conv ? { conversationId: conv } : {}) };
  const vinc = atual.directory && atual.directory.umblerContact;
  if (vinc && vinc.contactId === contato.contactId && (vinc.conversationId || '') === (contato.conversationId || '')) return { jaIgual: true };
  if (vinc && vinc.contactId && vinc.contactId !== contato.contactId && item.sobrescrever !== true) return { erro: `o cadastro já tem o contato ${vinc.contactId}; use "sobrescrever": true para trocar.` };
  return { contato, revisao: atual.revision };
}

/**
 * @param {{ itens: object[], ator: string, simular?: boolean, catalogo: () => Promise<object[]>, gravarPerfil: (req: object) => Promise<object> }} e
 * @returns {Promise<{ gravados: string[], jaIguais: string[], ignorados: {tarotId:string,motivo:string}[], simulados: string[] }>}
 */
async function aplicar({ itens, ator, simular = false, catalogo, gravarPerfil }) {
  if (!ator || !/^[0-9a-f-]{36}$/i.test(ator)) throw new Error('Informe --ator com o ID (UUID) do usuário da A que assina a gravação.');
  const saida = { gravados: [], jaIguais: [], ignorados: [], simulados: [] };
  const aprovados = itens.filter((i) => i && i.aprovar === true);
  const atuais = new Map((await catalogo()).map((t) => [`${t.id}`, t]));
  for (const item of aprovados) {
    const tarotId = `${item.tarotId}`;
    const c = conferir(item, atuais.get(tarotId));
    if (c.erro) { saida.ignorados.push({ tarotId, motivo: c.erro }); continue; }
    if (c.jaIgual) { saida.jaIguais.push(tarotId); continue; }
    if (simular) { saida.simulados.push(tarotId); continue; }
    const req = {
      user: { id: ator, role: 'GESTORA', nome: ATOR_NOME }, params: { tarotId },
      body: { operationKey: `mapear-umbler:${tarotId}:${c.contato.contactId}:${c.revisao}`, expectedRevision: c.revisao, directory: { umblerContact: c.contato } },
    };
    try { await gravarPerfil(req); saida.gravados.push(tarotId); } catch (e) { saida.ignorados.push({ tarotId, motivo: `falhou ao gravar (${(e && (e.codigo || e.statusCode || e.name)) || 'erro'}): ${String((e && e.message) || e).slice(0, 120)}` }); }
  }
  return saida;
}

module.exports = { aplicar, lerAprovados, conferir };
