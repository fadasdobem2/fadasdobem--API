'use strict';

/**
 * REGISTRO DE EXECUTORES das ações da Lilly: mapa `kind -> { validar, executar, transacional? }`. Nasce VAZIO; os módulos de cada
 * assunto (features/lilly/executores/*) se registram aqui. Sem executor, `validate` responde allowed:false e `actions` responde 422.
 *
 *   const { registrar } = require('./acoes.registro');
 *   registrar('schedule', {
 *     async validar(acao, { conversation, legacyBotRequest }) { return { allowed: true, context }; },   // ou { allowed:false, reason }
 *     async executar(acao, { executor, chave }) { return { id, position }; },                            // o `result`; recusar = lançar AcaoRecusadaError
 *   });
 *
 * - `executar` roda dentro de `emTransacao` (o `executor` é o da transação): o efeito e a marca 'confirmada' andam juntos. Se o
 *   efeito NÃO for só do banco novo, registre `transacional: false`: a guarda grava 'em_execucao' (já confirmado) antes do efeito.
 * - Kinds só-Umbler (note, public_reply, mark_attention, update_contact, knowledge_proposal) registram só `validar`: nunca executam aqui.
 */

const KINDS_GESTAO = ['register_client', 'update_client', 'schedule', 'remove_appointment', 'reschedule', 'payment', 'start_consultation', 'tarologist_schedule_note'];
const KINDS_SO_UMBLER = ['note', 'public_reply', 'mark_attention', 'update_contact', 'knowledge_proposal'];

const executores = new Map();

function registrar(kind, def) {
  if (![...KINDS_GESTAO, ...KINDS_SO_UMBLER].includes(kind)) throw new Error(`kind desconhecido: ${kind}`);
  if (!def || typeof def.validar !== 'function') throw new Error(`executor de ${kind} precisa de validar()`);
  const soUmbler = KINDS_SO_UMBLER.includes(kind);
  if (!soUmbler && typeof def.executar !== 'function') throw new Error(`executor de ${kind} precisa de executar()`);
  if (soUmbler && def.executar) throw new Error(`${kind} é só-Umbler: não pode ter executar()`);
  executores.set(kind, { transacional: true, ...def, soUmbler });
}

const obter = (kind) => executores.get(kind) || null;
const kindsRegistrados = () => [...executores.keys()];
/** Para testes. */
const limpar = () => executores.clear();

module.exports = { registrar, obter, kindsRegistrados, limpar, KINDS_GESTAO, KINDS_SO_UMBLER };
