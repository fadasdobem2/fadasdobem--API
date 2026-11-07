'use strict';

/**
 * Montadores do que é da CONVERSA no snapshot (Maturacao/59, 3.7, 3.8, 3.10): `links`, `messages`, `notices`, `consultationQuotes`.
 * Fonte: `gf_lilly_vinculos`, `gf_lilly_eventos` (a prova dos eventos resolvidos), `gf_lilly_avisos`, `gf_lilly_cotacoes`.
 *  - `links`: TODOS os vínculos (ativos ou não, verificados ou não) das conversas e das clientes envolvidas: o contrato exige 1:1 e qualquer
 *    outro vínculo precisa ir junto para a Lilly ver o conflito.
 *  - `messages`: eventos de mensagem das conversas nas últimas `JANELA_MENSAGENS_DIAS`; mais que `MENSAGENS` = assunto incompleto (vazio).
 *    Eventos de atividade (sem mensagem) e do site não entram. Ator `system` automático vira `bot` (D19).
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');

const DIA_MS = 24 * 3600 * 1000;
const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

function linkParaLilly(v) {
  return sem({
    clientId: v.clientId, fadasClientId: v.clientId, conversationId: v.conversationId, conversationIds: [v.conversationId], contactId: v.contactId,
    verified: v.verified, active: v.active, attribution: v.attribution || undefined, firstContact: v.firstContact,
  });
}

/** Vínculos das conversas e da cliente do evento, mais os OUTROS vínculos das clientes achadas (para o conflito 1:1 aparecer). */
async function montarLinks(escopo, f) {
  if (!escopo.conversationIds.length && !escopo.clientId) return { links: [], brutos: [] };
  const primeiros = await f.vinculos({ conversationIds: escopo.conversationIds, clientIds: escopo.clientId ? [escopo.clientId] : [] });
  const conhecidos = new Set(escopo.clientId ? [escopo.clientId] : []);
  const novos = [...new Set(primeiros.map((v) => v.clientId))].filter((c) => !conhecidos.has(c));
  const outros = novos.length ? await f.vinculos({ conversationIds: [], clientIds: novos }) : [];
  const porChave = new Map([...primeiros, ...outros].map((v) => [`${v.contactId}|${v.conversationId}`, v]));
  const brutos = [...porChave.values()];
  return { links: brutos.map(linkParaLilly), brutos };
}

/** Cliente vinculada à conversa do evento (vínculo ativo e verificado), para o escopo. */
const clientesDosVinculos = (brutos) => [...new Set(brutos.filter((v) => v.active && v.verified).map((v) => v.clientId))];

async function montarMensagens(escopo, f, agora) {
  if (!escopo.conversationIds.length) return [];
  const desdeIso = new Date(agora.getTime() - LIMITES.JANELA_MENSAGENS_DIAS * DIA_MS).toISOString();
  const linhas = await f.eventos({ conversationIds: escopo.conversationIds, desdeIso, limite: LIMITES.MENSAGENS });
  if (linhas.length > LIMITES.MENSAGENS) throw new LimiteExcedido('messages'); // a leitura veio cortada: não é a janela inteira
  const mensagens = linhas.filter((e) => e.source === 'umbler' && Boolean(e.messageId)); // atividade (sem mensagem) e eventos do site ficam fora
  return mensagens.map((e) => ({ ...sem({
    id: e.id, conversationId: e.conversationId, actor: e.actor === 'system' ? 'bot' : e.actor, internal: e.internal, at: e.at,
    clientId: e.clientId, tarologistId: e.tarologistId, messageId: e.messageId, intent: typeof e.data.intent === 'string' ? e.data.intent : undefined,
    messageType: typeof e.data.messageType === 'string' ? e.data.messageType : undefined, transcriptVerified: typeof e.data.transcriptVerified === 'boolean' ? e.data.transcriptVerified : undefined,
  }), text: e.text })); // `text` obrigatório mesmo vazio (áudio sem transcrição)
}

/** Avisos enviados nas conversas; `tarologistId` vem do agendamento avisado (a tabela não o guarda). */
async function montarAvisos(escopo, f, tarologoDoAgendamento) {
  const saida = [];
  for (const conversa of escopo.conversationIds) {
    for (const a of await f.avisosDaConversa(conversa)) {
      saida.push(sem({
        id: a.id, conversationId: a.conversationId, clientId: a.clientId, appointmentId: a.appointmentId, messageId: a.messageId, sentAt: a.sentAt,
        tarologistId: a.appointmentId ? tarologoDoAgendamento.get(a.appointmentId) : undefined,
      }));
    }
  }
  return saida;
}

/** Cotações das conversas: `amount` em reais (a tabela guarda centavos), só campos do contrato. */
async function montarCotacoes(escopo, f) {
  const saida = [];
  for (const conversa of escopo.conversationIds) {
    for (const c of await f.cotacoesDaConversa(conversa)) {
      saida.push(sem({ id: c.id, conversationId: c.conversationId, clientId: c.clientId, current: c.current, createdAt: c.createdAt, amount: Number((c.amountCentavos / 100).toFixed(2)), minutes: c.minutes }));
    }
  }
  return saida;
}

/** `conversation`/`conversations`: só o id e, se houver vínculo, a origem verificada (anúncio) e o primeiro contato. */
function montarConversas(escopo, brutos) {
  return escopo.conversationIds.map((id) => {
    const v = brutos.find((x) => x.conversationId === id && x.active && x.verified);
    return sem({ id, firstContact: v ? v.firstContact : undefined, attribution: v && v.attribution ? v.attribution : undefined });
  });
}

module.exports = { montarLinks, clientesDosVinculos, montarMensagens, montarAvisos, montarCotacoes, montarConversas };
