'use strict';

/**
 * O SERVIDOR REFAZ o comando da conferência (Maturacao/38): conferir encerramento, decisão dos adicionais, recusar correção, encerrar pela equipe
 * (concluir, cancelar, devolver, não houve), revisão e decisão de cancelamento, compensação (bônus), anular e erro de lançamento.
 * Passo 1: refaz com o instante e o ator do NAVEGADOR e exige registro IGUAL ao que ele mandou (senão 422, frase do front se a regra recusa).
 * Passo 2: refaz com o instante e o ator do SERVIDOR e grava ESSE resultado (nunca o do navegador). Sem a fatia Pagamentos (sem saldo real) não refaz.
 * O que o navegador gera ao acaso (`audit-<Date.now()>-<aleatório>` e o `createdAt` desses eventos) não entra na comparação.
 */

const { RegraConsultaError } = require('../../_comum/dominio/consulta-comum');
const { estavel } = require('../financeiro-cliente/fin.comum');
const financeiro = require('./ciclo.financeiro');
const comandos = require('./ciclo.comandos');

const MSG_DIFERENTE = 'Não foi possível conferir esta alteração. Atualize a tela e tente novamente.';
const EVENTO_DO_FRONT = /^audit-\d+-[0-9a-f]+$/;

/** O registro como se compara: sem `undefined` e sem o que o navegador sorteia nos eventos novos. */
function comparavel(registro, nAntes) {
  const copia = JSON.parse(JSON.stringify(registro));
  // O front acrescenta `readerRevisions` (revisões do extrato da taróloga, derivadas do repasse) depois de cada alteração: não é regra da consulta.
  delete copia.readerRevisions;
  copia.audit = copia.audit.map((e, i) => (i >= nAntes && EVENTO_DO_FRONT.test(e.id) ? { ...e, id: '~', createdAt: '~' } : e));
  return estavel(copia);
}

/** `{ item, comando }` com o registro calculado pelo servidor, ou `null` quando este pedido não é um comando que esta fatia refaz. */
async function refazer(ex, { a, antes, pedido, versao, agora }) {
  // Primeiro a leitura barata do comando (sem saldo): só carrega pagamentos e legado quando o pedido é um comando que se refaz.
  let reconhecido;
  try { reconhecido = comandos.ler(antes, pedido, { papel: a.perfil, versao, fin: null }); } catch (_) { reconhecido = true; }
  if (!reconhecido) return null;
  const fin = await financeiro.contexto(ex, antes);
  if (!fin) return null;
  // Registro malformado (campo que falta, tipo errado) não é falha do servidor: é um pedido que não confere.
  const seguro = (fn) => { try { return fn(); } catch (e) { throw e instanceof RegraConsultaError ? e : new RegraConsultaError(MSG_DIFERENTE); } };
  const comando = seguro(() => comandos.ler(antes, pedido, { papel: a.perfil, versao, fin }));
  if (!comando) return null;
  const nAntes = antes.audit.length;
  const atorDoNavegador = pedido.audit[pedido.audit.length - 1].actor || a.nome;
  const comoOFront = seguro(() => comando.calcular(pedido.updatedAt, atorDoNavegador));
  if (comparavel(comoOFront, nAntes) !== comparavel(pedido, nAntes)) throw new RegraConsultaError(MSG_DIFERENTE);
  const feito = seguro(() => comando.calcular(agora, a.nome));
  // Os eventos que o front identifica por id sorteado mantêm o id dele; o instante e o autor são do servidor.
  feito.audit = feito.audit.map((e, i) => (i >= nAntes && EVENTO_DO_FRONT.test(e.id) && pedido.audit[i] && EVENTO_DO_FRONT.test(pedido.audit[i].id) ? { ...e, id: pedido.audit[i].id } : e));
  // `readerRevisions` segue como o navegador mandou, com o instante das revisões NOVAS carimbado pelo servidor.
  const antigas = (antes.readerRevisions || []).length;
  if (pedido.readerRevisions) feito.readerRevisions = pedido.readerRevisions.map((r, i) => (i >= antigas && r && typeof r === 'object' ? { ...r, at: agora } : r));
  return { item: { ...feito, id: antes.id }, comando: comando.nome };
}

module.exports = { refazer, comparavel, MSG_DIFERENTE };
