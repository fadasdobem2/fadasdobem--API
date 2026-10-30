'use strict';

/**
 * Observações da cliente (Maturacao/36): porte de `appendClientNote` e `editClientNote` de `clientes/client-profile-model.ts` do front. O servidor
 * recebe o registro que a tela deixou e carimba autor, papel e instante com a sessão e o relógio dele. Mensagens iguais às do front.
 */

const { observacao, nome, RegraConsultaError } = require('./consulta-comum');
const { normalizar } = require('./texto-formatado');

class NotaInvalidaError extends Error { constructor(m) { super(m); this.name = 'NotaInvalidaError'; } }
const erro = (m) => { throw new NotaInvalidaError(m); };
const texto = (fn) => { try { return fn(); } catch (e) { if (e instanceof RegraConsultaError) throw new NotaInvalidaError(e.message); throw e; } };
const PAPEIS = ['atendente', 'assistente', 'supervisora', 'administradora'];
const ID_NOTA = /^[A-Za-z0-9._:-]{1,64}$/;
const mesmo = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Forma do que a tela manda: id, cliente, texto e formatação opcional. O resto (autor, instantes, histórico) é do servidor. */
function forma(pedido) {
  if (!pedido || typeof pedido !== 'object' || Array.isArray(pedido)) erro('Confira a observação.');
  if (typeof pedido.id !== 'string' || !ID_NOTA.test(pedido.id)) erro('Não foi possível identificar esta observação.');
  if (typeof pedido.clientId !== 'string' || !/^[1-9]\d{0,9}$/.test(pedido.clientId) || Number(pedido.clientId) > 2147483647) erro('Esta observação não pertence à cliente selecionada.');
  if (pedido.formatting !== undefined && JSON.stringify(pedido.formatting).length > 200000) erro('Confira a formatação da observação.');
  return pedido;
}

/** Criar (`appendClientNote`): texto 1 a 4000 caracteres; autor e papel da sessão; instante do servidor. */
function criar(pedido, { nome: autor, papel }, agora) {
  if (!PAPEIS.includes(papel)) erro('Este cadastro não está disponível para este perfil.');
  const checado = texto(() => observacao(pedido.text, 'Observação', true));
  const formatacao = normalizar(checado, pedido.formatting);
  return { id: pedido.id, clientId: pedido.clientId, text: checado, ...(formatacao ? { formatting: formatacao } : {}), author: texto(() => nome(autor, 'Autor')), createdAt: agora, authorRole: papel };
}

/** Editar (`editClientNote`): texto igual ao guardado não muda nada (devolve a mesma nota); senão a versão anterior vai para o histórico. */
function editar(atual, pedido, { nome: ator, papel }, agora) {
  if (!PAPEIS.includes(papel)) erro('Este cadastro não está disponível para este perfil.');
  if (!atual || atual.id !== pedido.id || atual.clientId !== pedido.clientId) erro('Esta observação não pertence à cliente selecionada.');
  const checado = texto(() => observacao(pedido.text, 'Observação', true));
  const autor = texto(() => nome(ator, 'Autor da alteração'));
  const nova = normalizar(checado, pedido.formatting); const anterior = normalizar(atual.text, atual.formatting);
  if (atual.text === checado && mesmo(anterior, nova)) return atual;
  const revisao = { text: atual.text, ...(anterior ? { formatting: anterior } : {}), author: atual.updatedBy || atual.author, at: atual.updatedAt || atual.createdAt };
  const { formatting: _f, ...resto } = atual;
  return { ...resto, text: checado, ...(nova ? { formatting: nova } : {}), updatedAt: agora, updatedBy: autor, history: [...(atual.history || []), revisao] };
}

module.exports = { NotaInvalidaError, forma, criar, editar };
