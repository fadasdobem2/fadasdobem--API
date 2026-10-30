'use strict';

/**
 * Núcleo transacional das gravações de repasse (porte de `replay` e `write` de `db/finance-store.ts`):
 *   1. a MESMA `operationKey` já gravada devolve o registro guardado em `gf_auditoria.depois` (idempotência), ou
 *      `operation-key-conflict` se a ação, a entidade, a conta ou o corpo forem outros;
 *   2. a conferência no legado (`check`) roda ANTES de abrir a transação;
 *   3. a gravação e a sua linha de auditoria entram na MESMA transação: falhando uma, nada fica;
 *   4. se a transação falha, olha-se uma última vez se uma operação igual ganhou a corrida.
 */

const { AUDIT_INSERT, linhaDeAuditoria } = require('../../../_comum/auditoria');
const { RepasseStoreError } = require('./erro');
const { REPLAY } = require('./sql');

/** Corpo de agora contido no registro guardado: ausente vale nulo e listas comparam sem ordem (parcelas, pendências...). */
function mesmoPedido(pedido, guardado) {
  if (pedido === undefined || pedido === null) return guardado === undefined || guardado === null;
  if (Array.isArray(pedido)) {
    if (!Array.isArray(guardado) || guardado.length !== pedido.length) return false;
    const restante = [...guardado];
    return pedido.every((item) => {
      const em = restante.findIndex((candidato) => mesmoPedido(item, candidato));
      if (em < 0) return false;
      restante.splice(em, 1);
      return true;
    });
  }
  if (typeof pedido === 'object') {
    if (typeof guardado !== 'object' || guardado === null || Array.isArray(guardado)) return false;
    return Object.entries(pedido).every(([nome, valor]) => mesmoPedido(valor, guardado[nome]));
  }
  return pedido === guardado;
}

function lerDepois(depois) {
  if (typeof depois !== 'string') return depois;
  try {
    return JSON.parse(depois);
  } catch {
    throw new RepasseStoreError('malformed-row:depois');
  }
}

/** A mesma chave já gravada: o registro guardado, se ação, entidade, conta e corpo são os mesmos. */
async function repetir(deps, operacao) {
  const [encontradas] = await deps.avulso(REPLAY, [operacao.operationKey]);
  const linha = Array.isArray(encontradas) ? encontradas[0] : null;
  if (!linha) return null;
  if (linha.acao !== operacao.action || linha.entidade !== operacao.entity || linha.ator_conta_id !== operacao.actor.accountId) {
    throw new RepasseStoreError('operation-key-conflict');
  }
  const guardado = lerDepois(linha.depois);
  if (!guardado || typeof guardado.id !== 'string' || !mesmoPedido(operacao.request, guardado)) throw new RepasseStoreError('operation-key-conflict');
  return guardado;
}

/**
 * `operacao`: { action, entity, operationKey, actor, request, check(), apply(ex, agora, checado) -> { result, before?, reason? } }.
 * `deps`: { avulso, emTransacao, agora, novoId } (ver escrita.fabrica.js).
 */
async function executar(deps, operacao) {
  const repetida = await repetir(deps, operacao);
  if (repetida) return repetida;
  const checado = await operacao.check();
  try {
    return await deps.emTransacao(async (ex) => {
      const agora = deps.agora();
      const feito = await operacao.apply(ex, agora, checado);
      const fato = {
        actorUserId: operacao.actor.accountId, actorRole: operacao.actor.role, action: operacao.action, entity: operacao.entity,
        entityId: feito.result.id, before: feito.before, after: feito.result, reason: feito.reason,
      };
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(fato, { id: deps.novoId(), agora, chave: operacao.operationKey }));
      return feito.result;
    });
  } catch (erro) {
    let vencedora = null;
    try {
      vencedora = await repetir(deps, operacao);
    } catch (conflito) {
      if (conflito instanceof RepasseStoreError) throw conflito;
    }
    if (vencedora) return vencedora;
    throw erro;
  }
}

module.exports = { executar, repetir, mesmoPedido };
