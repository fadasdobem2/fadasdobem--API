'use strict';

/**
 * REFAZER a regra financeira do pagamento no servidor (Maturacao/42): o navegador manda o registro que o front produziu; o servidor descobre
 * QUAL função do front rodou (pelo que mudou), refaz com o contexto REAL (pagamentos, consultas e saldo lidos do banco), exige registro IGUAL
 * ao do navegador (mesma regra, mesmo resultado; senão 422) e então grava o resultado refeito com o instante e o autor DO SERVIDOR.
 * Cada família de operação fica num módulo (`pagamentos-refazer-*.js`); aqui só o roteador. Sem relógio e sem banco: o contexto entra por parâmetro.
 */

const L = require('./pagamentos-livro');
const { PagamentoInvalidoError, PagamentoNegadoError } = require('./pagamentos-regras');
const { igual } = require('./pagamentos-igual');
const { corrigirMovimento } = require('./pagamentos-correcao-movimento');

const MSG_NAO_CONFERE = 'Não foi possível identificar esta alteração.';
const recusa = (m = MSG_NAO_CONFERE) => { throw new PagamentoInvalidoError(m); };
const MS = (v) => Date.parse(v);

/** Primeiro movimento cujo valor, data ou observação mudou (o que `correctPaymentMovement` edita); -1 se nenhum. */
function movimentoEditado(antes, depois) {
  const a = antes.movements || []; const d = depois.movements || [];
  if (!a.length || a.length !== d.length) return -1;
  if (a.some((m, i) => m.id !== d[i].id)) return -1;
  return a.findIndex((m, i) => m.amount !== d[i].amount || MS(m.occurredAt) !== MS(d[i].occurredAt) || m.note !== d[i].note);
}

/** Item 1: "Editar movimento" (`payment-movement-editor.tsx`) e planilha com movimento. */
function refazerCorrecaoDeMovimento(antes, depois, ator, agora, contexto) {
  const i = movimentoEditado(antes, depois);
  if (i < 0) return null;
  if (!ator.p.canViewAllPayments) throw new PagamentoNegadoError();
  const m = depois.movements[i];
  const entrada = { amount: m.amount, occurredAt: m.occurredAt, note: m.note };
  const conferido = corrigirMovimento(antes, m.id, entrada, depois.updatedBy, depois.updatedAt, contexto);
  if (conferido === antes || !igual(conferido, depois)) recusa();
  const gravado = corrigirMovimento(antes, m.id, entrada, ator.nome, agora, contexto);
  return { tipo: 'movimento-corrigido', registro: gravado };
}

/**
 * `antes` é o guardado, `depois` o do navegador. Devolve `{ tipo, registro }` com o resultado refeito (carimbado pelo servidor) ou `null` quando a
 * revisão não é uma das operações refeitas aqui (segue pelas conferências de forma e de campos de `pagamentos.validacao.js`).
 */
function refazerRevisao(antes, depois, ator, agora, contexto) {
  if (antes.status === 'Cancelado') return null;
  return refazerCorrecaoDeMovimento(antes, depois, ator, agora, contexto);
}

/** A revisão mexe em movimento ou ocorrência (operações refeitas aqui). */
const reconhece = (antes, depois) => antes.status !== 'Cancelado' && movimentoEditado(antes, depois) >= 0;

module.exports = { refazerRevisao, reconhece, MSG_NAO_CONFERE, movimentoEditado };
