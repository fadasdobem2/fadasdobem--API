'use strict';

/**
 * Gravações da ABERTURA (Saldo Migrado): rascunho da revisão 1, confirmação e correção (revisão N+1, com a N preservada).
 * Porte de `insertOpening`, `insertDebt`, `insertAdjustment`, `draftOpening`, `confirmOpening` e `correctOpening` de
 * `db/finance-store.ts`, com os mesmos FOR UPDATE na mesma ordem.
 */

const { moneyToCents } = require('../helpers/dinheiro');
const { childKey } = require('../repasse.dto');
const { RepasseStoreError } = require('./erro');
const { linhas, lerAberturas, somente } = require('./registros');
const sql = require('./sql');

/** MySQL (mysql2 `execute`) não aceita `undefined` como parâmetro. */
const consulta = (ex, instrucao, valores) => ex.execute(instrucao, valores.map((v) => (v === undefined ? null : v)));

function exigirQuitadoAntesDoCorte({ settledThrough, migrationCut }) {
  if (settledThrough >= migrationCut) throw new RepasseStoreError('settled-after-cut');
}

/** A linha corrigida, travada até o fim da transação; só uma linha válida pode ser substituída. */
async function travarValida(ex, instrucao, id) {
  const [encontrada] = await linhas(ex, instrucao, [id]);
  if (!encontrada || encontrada.situacao !== 'valido') throw new RepasseStoreError('not-valid');
  return encontrada.tarot_id;
}

/** A dívida e as suas parcelas, com a soma conferida no banco antes de seguir: diferente do valor, nada fica. */
async function inserirDivida(ex, r, campos) {
  await consulta(ex, sql.INSERT_DEBT, [
    r.id, r.tarotId, campos.kind, r.origin, r.openingId, campos.amount, r.originalDeliveryOn, r.deliveredOn, r.referenceDate,
    r.corrects, r.correctionReason, r.sheetRef, campos.note, r.registeredBy, r.registeredAt, r.operationKey,
  ]);
  for (const [i, parcela] of campos.installments.entries()) await consulta(ex, sql.INSERT_INSTALLMENT, [r.id, i + 1, parcela.date, parcela.amount]);
  const [total] = await linhas(ex, sql.INSTALLMENT_TOTAL, [r.id]);
  if (!total || moneyToCents(total.valor) !== moneyToCents(total.soma)) throw new RepasseStoreError('installments-mismatch');
}

async function inserirAjuste(ex, r, c) {
  await consulta(ex, sql.INSERT_ADJUSTMENT, [
    r.id, r.tarotId, c.kind, c.amount, c.description, c.date, c.periodStart, c.periodEnd, r.openingId, r.corrects, r.correctionReason,
    r.registeredBy, r.registeredAt, r.operationKey,
  ]);
}

/**
 * Uma revisão nova em rascunho, com as pendências, as dívidas da migração (referência na data do último pagamento) e
 * os ajustes que estavam em aberto. Um só rascunho aberto por tarólogo, fora o que a própria correção descarta, e só a
 * última revisão se corrige: as revisões dele ficam travadas até o fim. Na correção, a dívida de cada posição do corpo
 * aponta para a da mesma posição na N (`replaces`), com o motivo da correção.
 */
async function inserirAbertura(ex, deps, agora, a) {
  const revisoes = await linhas(ex, sql.TAROT_OPENINGS, [a.tarotId]);
  if (revisoes.some((r) => r.situacao === 'rascunho' && Number(r.revisao) !== a.corrects)) throw new RepasseStoreError('draft-exists');
  if (a.corrects === null && revisoes.length > 0) throw new RepasseStoreError('opening-exists');
  if (a.corrects !== null && Math.max(...revisoes.map((r) => Number(r.revisao))) !== a.corrects) throw new RepasseStoreError('not-latest');
  const f = a.fields;
  const id = deps.novoId();
  await consulta(ex, sql.INSERT_OPENING, [
    id, a.tarotId, Math.max(0, ...revisoes.map((r) => Number(r.revisao))) + 1, a.corrects, a.reason, f.lastPayment.paidOn,
    f.lastPayment.amount, f.lastPayment.sheetRef, f.settledThrough, f.remainingBalance, f.balanceNote, f.migrationCut,
    f.rate, a.actor.accountId, agora, a.operationKey,
  ]);
  for (const item of f.differences) await consulta(ex, sql.INSERT_DIFFERENCE, [deps.novoId(), id, item.description, item.amount]);
  const filho = { tarotId: a.tarotId, corrects: null, correctionReason: null, registeredBy: a.actor.accountId, registeredAt: agora };
  for (const [i, item] of f.debts.entries()) {
    const corrige = a.replaces[i] ?? null;
    await inserirDivida(ex, {
      ...filho, id: deps.novoId(), origin: 'migracao', openingId: id, originalDeliveryOn: item.originalDeliveryOn, deliveredOn: null,
      referenceDate: f.lastPayment.paidOn, corrects: corrige, correctionReason: corrige === null ? null : a.reason, sheetRef: item.sheetRef,
      operationKey: childKey(a.operationKey, 'divida', i),
    }, item);
  }
  for (const [i, item] of f.adjustments.entries()) {
    await inserirAjuste(ex, { ...filho, id: deps.novoId(), openingId: id, operationKey: childKey(a.operationKey, 'ajuste', i) }, item);
  }
  return id;
}

/** Os campos do corpo que a repetição compara (o que o servidor deriva fica de fora). */
const pedidoDaAbertura = (f) => ({
  lastPayment: f.lastPayment, settledThrough: f.settledThrough, remainingBalance: f.remainingBalance, balanceNote: f.balanceNote,
  migrationCut: f.migrationCut, rate: f.rate, differences: f.differences, debts: f.debts, adjustments: f.adjustments,
});

async function estadoDaAbertura(ex, openingId) {
  const [estado] = await linhas(ex, sql.OPENING_STATE, [openingId]);
  if (!estado) throw new RepasseStoreError('not-found');
  return estado;
}

function criarAberturas({ deps, exigirTarologo, executar }) {
  return {
    rascunho: (entrada) => {
      exigirQuitadoAntesDoCorte(entrada);
      return executar({
        action: 'payout.opening.draft', entity: 'payout.opening', operationKey: entrada.operationKey, actor: entrada.actor,
        request: { tarotId: entrada.tarotId, ...pedidoDaAbertura(entrada) },
        check: () => exigirTarologo(entrada.tarotId),
        apply: async (ex, agora) => {
          const id = await inserirAbertura(ex, deps, agora, { tarotId: entrada.tarotId, corrects: null, reason: null, replaces: [], actor: entrada.actor, operationKey: entrada.operationKey, fields: entrada });
          return { result: somente(await lerAberturas(ex, entrada.tarotId), id) };
        },
      });
    },

    confirmar: (entrada) => executar({
      action: 'payout.opening.confirm', entity: 'payout.opening', operationKey: entrada.operationKey, actor: entrada.actor,
      request: { id: entrada.openingId },
      check: async () => undefined,
      apply: async (ex, agora) => {
        const estado = await estadoDaAbertura(ex, entrada.openingId);
        if (estado.situacao !== 'rascunho') throw new RepasseStoreError('not-a-draft');
        exigirQuitadoAntesDoCorte({ settledThrough: estado.quitado_ate, migrationCut: estado.corte_migracao });
        const before = somente(await lerAberturas(ex, estado.tarot_id), entrada.openingId);
        await consulta(ex, sql.CONFIRM_OPENING, [entrada.actor.accountId, agora, entrada.openingId]);
        await consulta(ex, sql.REPLACE_OLDER_MIGRATED_DEBTS, [estado.tarot_id, entrada.openingId]);
        return { result: somente(await lerAberturas(ex, estado.tarot_id), entrada.openingId), before };
      },
    }),

    corrigir: (entrada) => {
      exigirQuitadoAntesDoCorte(entrada);
      return executar({
        action: 'payout.opening.correct', entity: 'payout.opening', operationKey: entrada.operationKey, actor: entrada.actor,
        request: { tarotId: entrada.tarotId, correctsId: entrada.openingId, correctionReason: entrada.reason, ...pedidoDaAbertura(entrada) },
        check: async () => undefined,
        apply: async (ex, agora) => {
          const estado = await estadoDaAbertura(ex, entrada.openingId);
          if (estado.tarot_id !== entrada.tarotId) throw new RepasseStoreError('invalid-input');
          const before = somente(await lerAberturas(ex, estado.tarot_id), entrada.openingId);
          // A dívida da migração de cada posição da N (`before.debts` já vem nessa ordem) é corrigida pela da mesma posição
          // na N+1, que herda os descontos pela corrige_id. Da confirmada, as dívidas seguem valendo enquanto ela é a
          // vigente e saem quando a N+1 é confirmada (FR-030); as sem par também.
          const substituidas = before.debts.filter((d) => d.origin === 'migracao' && d.status === 'valido');
          for (const divida of substituidas) await travarValida(ex, sql.DEBT_STATE, divida.id);
          // Corrigir o rascunho o descarta: fica no histórico e não pode mais ser confirmado (PO, 2026-10-24). As dívidas
          // dele, que nunca valeram, saem já.
          if (estado.situacao === 'rascunho') {
            for (const divida of substituidas) await consulta(ex, sql.REPLACE_DEBT, [divida.id]);
            await consulta(ex, sql.DISCARD_OPENING, [entrada.openingId]);
          }
          const id = await inserirAbertura(ex, deps, agora, {
            tarotId: estado.tarot_id, corrects: Number(estado.revisao), reason: entrada.reason, replaces: substituidas.map((d) => d.id),
            actor: entrada.actor, operationKey: entrada.operationKey, fields: entrada,
          });
          return { result: somente(await lerAberturas(ex, estado.tarot_id), id), before, reason: entrada.reason };
        },
      });
    },
  };
}

module.exports = { criarAberturas, exigirQuitadoAntesDoCorte };
