'use strict';

/**
 * Fábrica do "store" de gravações de repasse (equivalente a `createFinanceStore` da B), com as dependências injetadas
 * para o teste offline: `avulso(sql, valores)`, `emTransacao(fn)`, `legado.tarologoExiste(id)`, `contaExiste(id)`,
 * `agora()` e `novoId()`; `contaExiste(id)` (opcional) substitui a conferência em `gf_auth_accounts` pelo usuário da A.
 * Em produção as dependências vêm de novo/escritor.js (Postgres por padrão, ou models/legado/escrita.js no modo mysql) e do legado (leitura).
 */

const { randomUUID } = require('crypto');
const { RepasseStoreError } = require('./erro');
const { executar } = require('./operacao');
const { criarAcordo } = require('./acordo');
const { criarAberturas } = require('./abertura');
const { ACCOUNT_EXISTS } = require('./sql');

function criarRepasseEscrita(deps) {
  const completas = { agora: Date.now, novoId: randomUUID, ...deps };
  // Antes de abrir a transação: o ID do legado (MyISAM não tem FK) e a conta que assina (gf_* tem FK para gf_auth_accounts).
  const exigirTarologo = async (tarotId) => {
    if (!(await completas.legado.tarologoExiste(tarotId))) throw new RepasseStoreError('legacy-id-missing');
  };
  const exec = (operacao) => executar(completas, {
    ...operacao,
    check: async () => {
      if (completas.contaExiste) {
        // Banco novo: a conta é o usuário da A (`users`), conferido fora do executor (que só enxerga `gf_*`).
        if (!(await completas.contaExiste(operacao.actor.accountId))) throw new RepasseStoreError('actor-account-missing');
      } else {
        const [contas] = await completas.avulso(ACCOUNT_EXISTS, [operacao.actor.accountId]);
        if (!Array.isArray(contas) || contas.length === 0) throw new RepasseStoreError('actor-account-missing');
      }
      return operacao.check();
    },
  });
  const base = { deps: completas, exigirTarologo, executar: exec };
  const acordo = criarAcordo(base);
  const aberturas = criarAberturas(base);
  return {
    setCommissionRate: acordo.percentual,
    setPaymentSchedule: acordo.calendario,
    draftOpening: aberturas.rascunho,
    confirmOpening: aberturas.confirmar,
    correctOpening: aberturas.corrigir,
  };
}

module.exports = { criarRepasseEscrita };
