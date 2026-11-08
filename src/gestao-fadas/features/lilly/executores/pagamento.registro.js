'use strict';

/**
 * Monta o `PaymentRecord` do painel para o lançamento da Lilly (Maturacao/60, item 4), com as MESMAS funções de domínio do front
 * (`pagamentos-lancamento.js`, `pagamentos-preco.js`), para o serviço `POST /payments` refazê-lo e aceitá-lo sem atalho:
 *  - `method` PIX e `bank` Mercado Pago (único meio que a Lilly confirma); sem `confirmation` (só Financeiro confirma pelo painel);
 *  - pagador = `payload.payerName` (NUNCA copiado para o nome da cliente) ou, sem ele, o rótulo da cliente, como o painel faz (`client-create-dialog.tsx:306`);
 *  - `paidAt` = `payload.date` (data AAAA-MM-DD ou instante) quando vier; senão o instante do servidor;
 *  - duplicidade do painel (mesmo valor, 15 min): sem `distinctAmountConfirmed` recusa; com ele grava o evento "Duplicidade conferida".
 */

const Lc = require('../../../_comum/dominio/pagamentos-lancamento');
const P = require('../../../_comum/dominio/pagamentos-preco');
const Dup = require('../../../_comum/dominio/pagamentos-duplicidade');
const L = require('../../../_comum/dominio/pagamentos-livro');
const base = require('../../../_comum/dominio/financeiro-base');
const { contextoDoLancamento } = require('../../financeiro-cliente/pagamentos.contexto');
const { rotuloParaPagamento } = require('./pagamento.rotulo');
const { recusar, texto } = require('./executores.comum');
const cfg = require('./executores.config');

const PREFIXO_DA_CONFERENCIA = 'Outro recebimento confirmado após comparar os pagamentos ';

/** @returns {Promise<{ registro: object, contexto: object }>} */
async function montarRegistro(executor, p, agoraIso) {
  const contexto = await contextoDoLancamento(executor, p.clientId);
  const valor = Number(p.amount);
  const em = p.paidAt || agoraIso;
  const ref = P.referenciaDePreco(valor, p.clientId, em, base.PRECOS_PADRAO, { consultations: contexto.consultations, profiles: { [p.clientId]: contexto.profile }, history: contexto.history }, null, 'PIX');
  const nome = await rotuloParaPagamento(p.clientId);
  const entrada = {
    paidAt: p.paidAt, amount: Lc.textoDoDinheiro(valor), method: 'PIX', bank: 'Mercado Pago', payerName: texto(p.payerName) || nome,
    authorization: p.authorization || '', note: p.note || '', purchase: ref.purchase, cashUnitValue: ref.cashUnitValue,
  };
  let registro;
  try {
    registro = Lc.criarPagamento(entrada, { clientId: p.clientId, client: nome }, cfg.NOME_DO_SERVICO, agoraIso, p.id, undefined, base.precoVigente(contexto.history, agoraIso));
  } catch (e) {
    if (e && e.name === 'PagamentoInvalidoError') recusar('LILLY_PAYMENT_INVALID', e.message);
    throw e;
  }
  const candidatos = Dup.candidatosDeDuplicidade(contexto.payments, { clientId: p.clientId, amount: registro.amount }, agoraIso, p.id);
  if (candidatos.length) {
    if (!p.distinctAmountConfirmed) recusar('LILLY_PAYMENT_DUPLICATE', Dup.MSG_DUPLICIDADE, 409);
    const conferido = L.eventoDeAuditoria('Duplicidade conferida', `${PREFIXO_DA_CONFERENCIA}${candidatos.map((c) => c.id).join(', ')}. Conferência em ${agoraIso}.`, cfg.NOME_DO_SERVICO, agoraIso);
    registro = { ...registro, audit: [...registro.audit, conferido] };
  }
  return { registro, contexto };
}

module.exports = { montarRegistro };
