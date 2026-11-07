'use strict';

/**
 * `payment` (Maturacao/59, R1-R4; Maturacao/60, item 4): lança o pagamento pelo serviço EXISTENTE (`POST /payments`,
 * `financeiro-cliente/pagamentos.service.js`), que refaz as regras de dinheiro e só espelha no legado sob as flags `GF_LEGADO_*` (desligadas).
 * Exige: cliente real com vínculo fresco; autorização humana provada (`authorizedEventId` com `staffAuthorized:true` na MESMA conversa e
 * cliente); `proposalId`; `humanConfirmed` ou `providerConfirmed`; valor `^\d{1,12}(\.\d{1,2})?$`; referência do provedor única
 * (cruzando tipos), proposta única e autorização única. Grava as referências em `gf_lilly_pagamento_refs`.
 * Tabela `gf_lilly_pagamentos` NÃO foi criada: `gf_lilly_pagamento_refs` já guarda proposta, autorização e referências.
 * NÃO RESPONDIDO (doc 60): pagamento sem `mpPaymentId` nem `endToEndId` (que banco registrar): RECUSADO até a Nice decidir.
 */

const pagamentos = require('../../financeiro-cliente/pagamentos.service');
const refsRepo = require('../dados/pagamento-refs.repo');
const { registrar } = require('../acoes/acoes.registro');
const { provarAutorizacao } = require('./autorizacao');
const { montarRegistro } = require('./pagamento.registro');
const { referenciasDe, buscarConflito } = require('./pagamento.unicidade');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, sha, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const { avulso } = require('../dados/executor');

const VALOR = /^\d{1,12}(\.\d{1,2})?$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados do pagamento.' };
  const bruto = typeof p.amount === 'number' && Number.isFinite(p.amount) ? String(p.amount) : texto(p.amount);
  if (!VALOR.test(bruto) || Number(bruto) <= 0) return { motivo: 'O valor do pagamento é inválido (positivo, até duas casas).' };
  if (p.humanConfirmed !== true && p.providerConfirmed !== true) return { motivo: 'O pagamento precisa de confirmação humana ou do provedor.', code: 'LILLY_AUTHORIZATION_MISSING' };
  if (!texto(p.sourceEventId)) return { motivo: 'Informe o evento de origem do pagamento.' };
  const { refs, invalido } = referenciasDe(p);
  if (invalido) return { motivo: 'Uma das referências do pagamento é longa demais.' };
  if (!refs.mpPaymentId && !refs.endToEndId) return { motivo: 'Pagamento sem referência do Mercado Pago ou Pix (mpPaymentId ou endToEndId) ainda depende de decisão.', code: 'LILLY_PAYMENT_REFERENCE_REQUIRED' };
  const date = texto(p.date);
  if (date && !(DATA.test(date) ? !Number.isNaN(Date.parse(`${date}T12:00:00Z`)) : INSTANTE.test(date) && !Number.isNaN(Date.parse(date)))) return { motivo: 'A data do pagamento é inválida.' };
  if (p.payerName !== undefined && (typeof p.payerName !== 'string' || p.payerName.length > 200)) return { motivo: 'O nome do pagador é inválido.' };
  return { pedido: { amount: bruto, refs, date: date || undefined, payerName: texto(p.payerName) || undefined, distinctAmountConfirmed: p.distinctAmountConfirmed === true, reconciliationRequired: p.reconciliationRequired === true, authorization: texto(p.reference) || texto(p.mpPaymentId) || texto(p.endToEndId) } };
}

/** Os dados que o evento humano pode ter carregado e que devem coincidir (valor e referências). */
const propostoDe = (pedido) => ({ amount: pedido.amount, reference: pedido.refs.reference, mpPaymentId: pedido.refs.mpPaymentId, endToEndId: pedido.refs.endToEndId, externalTransactionId: pedido.refs.externalTransactionId });

const MENSAGENS = {
  referencia: ['LILLY_PAYMENT_ALREADY_RECORDED', 'Esta referência de pagamento já foi lançada'],
  proposta: ['LILLY_PROPOSAL_ALREADY_EXECUTED', 'Esta proposta já gerou um pagamento'],
  autorizacao: ['LILLY_AUTHORIZATION_ALREADY_USED', 'Esta autorização já foi usada em outro pagamento'],
};

/** Conflito -> recusa 409 (referência em outra cliente tem código próprio). */
function recusarConflito(c, clientId) {
  const [code, msg] = MENSAGENS[c.tipo];
  if (c.tipo === 'referencia' && c.clientId && c.clientId !== clientId) recusar('LILLY_PAYMENT_REFERENCE_OTHER_CLIENT', 'Esta referência de pagamento já está em outro cadastro. Exige revisão.', 409);
  return recusar(code, `${msg} (${c.paymentId}).`, 409);
}

async function conferirTudo(executor, acao, n, { ignorar, aoRecusar }) {
  const base = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirConta: true, executor });
  if (base.recusa) return aoRecusar('LILLY_PAYMENT_NOT_ALLOWED', base.recusa.reason);
  const a = await provarAutorizacao(executor, acao, { proposto: propostoDe(n.pedido) });
  if (a.motivo) return aoRecusar('LILLY_AUTHORIZATION_MISSING', a.motivo);
  const c = await buscarConflito(executor, { refs: n.pedido.refs, proposalId: a.dados.proposalId, authorizedEventId: a.dados.authorizedEventId, ignorar });
  if (c) return aoRecusar(null, null, c);
  return a.dados;
}

function registrarPagamento() {
  registrar('payment', {
    async validar(acao) {
      const n = normalizar(acao); if (n.motivo) return nao(n.motivo);
      const resposta = (code, motivo, conflito) => { const e = { allowed: false, reason: conflito ? `${MENSAGENS[conflito.tipo][1]} (${conflito.paymentId}).` : motivo }; return { recusa: e }; };
      const r = await conferirTudo(avulso, acao, n, { aoRecusar: resposta });
      return r.recusa ? r.recusa : permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const n = normalizar(acao); if (n.motivo) recusar(n.code || 'INVALID_INPUT', n.motivo);
      await executor.execute('SELECT pg_advisory_xact_lock(hashtext(?))', ['gf_lilly:pagamentos']);
      const clientId = `${acao.clientId}`;
      const id = `PG-${sha(chave.interna).slice(0, 40)}`;
      const aoRecusar = (code, motivo, conflito) => (conflito ? recusarConflito(conflito, clientId) : recusar(code, motivo));
      const autorizacao = await conferirTudo(executor, acao, n, { ignorar: id, aoRecusar });
      const [existente] = await executor.execute('SELECT id_cliente FROM gf_pagamentos WHERE id = ?', [id]);
      if (existente[0] && existente[0].id_cliente !== clientId) recusar('LILLY_PAYMENT_ALREADY_RECORDED', 'Este pagamento já existe para outra cliente.', 409);
      if (!existente[0]) { // sem pagamento ainda: lança. Com pagamento (retomada de uma tentativa cuja guarda não confirmou) só grava as referências
        const agoraIso = new Date().toISOString();
        const { registro } = await montarRegistro(executor, { id, clientId, amount: n.pedido.amount, paidAt: n.pedido.date, payerName: n.pedido.payerName, authorization: n.pedido.authorization, note: `Lançado pela Lilly. Autorizado por ${autorizacao.authorizedBy} (evento ${autorizacao.authorizedEventId}).`, distinctAmountConfirmed: n.pedido.distinctAmountConfirmed }, agoraIso);
        await chamarServico(() => pagamentos.lancar(pedidoDeServico({ body: { operationKey: chaveDaOperacao(chave, 'pagamento'), record: registro } })));
      }
      await refsRepo.gravarRefs(executor, { paymentId: id, ...n.pedido.refs, proposalId: autorizacao.proposalId, authorizedEventId: autorizacao.authorizedEventId });
      await auditar(executor, chave, {
        acao: 'payment', entidade: 'pagamento', entidadeId: id,
        depois: { clientId, amount: n.pedido.amount, ...autorizacao, reconciliationRequired: n.pedido.reconciliationRequired, reference: n.pedido.refs.reference, mpPaymentId: n.pedido.refs.mpPaymentId, endToEndId: n.pedido.refs.endToEndId, sourceEventId: n.pedido.refs.sourceEventId, conversationId: acao.conversationId },
      });
      return { id, clientId };
    },
  });
}

module.exports = { registrarPagamento, normalizar };
