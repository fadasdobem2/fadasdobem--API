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
const { registrarMovimento } = require('./pagamentos-movimento');
const { devolverCreditoRestante } = require('./pagamentos-credito');
const RO = require('./pagamentos-refazer-ocorrencias');
const RC = require('./pagamentos-refazer-campos');
const RL = require('./pagamentos-refazer-lancamento');

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

/** Movimento NOVO direto (`payment-movements-dialog.tsx`: `recordPaymentMovement` ou `recordRemainingCreditRefund`): exatamente um no fim do histórico. */
function movimentoNovo(antes, depois) {
  const a = antes.movements || []; const d = depois.movements || [];
  if (d.length !== a.length + 1 || a.some((m, i) => m.id !== d[i].id)) return null;
  const m = d[d.length - 1];
  return m.kind === 'balance-transfer' ? null : m;
}

/** A entrada do movimento = a assinatura que o front guardou (`operationSignature`) sem o autor. */
function entradaDoMovimento(m) {
  let a; try { a = JSON.parse(m.operationSignature); } catch { return recusa(); }
  if (!a || typeof a !== 'object' || Array.isArray(a) || a.actor !== m.actor) return recusa();
  const { actor: _autor, ...entrada } = a;
  return entrada;
}

function refazerMovimentoNovo(antes, depois, ator, agora, contexto) {
  const m = movimentoNovo(antes, depois);
  if (!m) return null;
  if (!ator.p.canViewAllPayments) throw new PagamentoNegadoError();
  const entrada = entradaDoMovimento(m);
  const rodar = (nome, em) => {
    if (m.creditSnapshot) {
      const credito = { ...entrada, amount: entrada.creditAmount };
      return devolverCreditoRestante(antes, credito, contexto, nome, m.id, em);
    }
    return registrarMovimento(antes, entrada, nome, m.id, em);
  };
  const conferido = rodar(depois.updatedBy, depois.updatedAt);
  if (conferido === antes || !igual(conferido, depois)) recusa();
  return { tipo: 'movimento-novo', registro: RO.comMotivos(rodar(ator.nome, agora), depois) };
}

/** Que família de operação a revisão representa (`null` se nenhuma das refeitas aqui). Ocorrência e transferência recusam se mexeram em mais de uma coisa. */
function reconhece(antes, depois) {
  if (antes.status === 'Cancelado') return null;
  if (RO.pernasNovas(antes, depois).length) return 'transferencia';
  if (RO.comandoDeOcorrencia(antes, depois)) return 'ocorrencia';
  if (movimentoNovo(antes, depois)) return 'movimento-novo';
  if (movimentoEditado(antes, depois) >= 0) return 'movimento';
  if (RC.reconhece(antes, depois)) return 'campos';
  return null;
}

/**
 * `antes` é o guardado, `depois` o do navegador, `tipo` o de `reconhece`. Devolve `{ tipo, registro }` com o resultado refeito (carimbado pelo servidor).
 * `contexto`: pagamentos, consultas, perfil e (transferência) perfis, nomes e valor do minuto regular, lidos do banco.
 */
function refazerRevisao(antes, depois, ator, agora, contexto, tipo = reconhece(antes, depois)) {
  if (tipo === 'transferencia') return RO.refazerTransferencia(antes, depois, ator, agora, contexto);
  if (tipo === 'ocorrencia') return RO.refazerOcorrencia(antes, depois, ator, agora, contexto);
  if (tipo === 'movimento-novo') return refazerMovimentoNovo(antes, depois, ator, agora, contexto);
  if (tipo === 'movimento') return refazerCorrecaoDeMovimento(antes, depois, ator, agora, contexto);
  if (tipo === 'campos') return RC.refazerCampos(antes, depois, ator, agora, contexto);
  return null;
}

module.exports = { refazerLancamento: RL.refazerLancamento, refazerRevisao, reconhece, MSG_NAO_CONFERE, movimentoEditado, pernasNovas: RO.pernasNovas, dadosDaTransferencia: RO.dadosDaTransferencia };
