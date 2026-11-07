'use strict';

/**
 * Estado de uma divergência (v706), portado de `features/domain/divergence-state.ts` e de `tarologist-divergences-model.ts`
 * (`readerDivergenceTab`, `canRestoreReaderDivergence`). Funções puras sobre o registro `Divergence`; o ouro
 * (`scripts/gerar-ouro-gf-divergencias.js`) roda as funções reais do front e compara.
 *
 * Regra da Nice na v706 (substitui "arquivar"): a taróloga CANCELA o pedido em análise (`readerCancelledAt`, evento "Pedido cancelado",
 * situação interna `Arquivada`); só uma resolvida EXCLUÍDA pode ser restaurada. Arquivos antigos continuam legíveis (legado).
 */

/** Um arquivo antigo pode guardar uma decisão concluída ou um pedido retirado. */
function temResolucao(d) {
  if (d.status !== 'Arquivada') return d.status === 'Resolvida';
  if (d.statusBeforeArchive) return d.statusBeforeArchive === 'Resolvida';
  const arquivou = [...(d.history || [])].reverse().find((e) => e.action === 'Arquivada' || e.action === 'Retirada e arquivada');
  if (arquivou) return arquivou.action === 'Arquivada' && arquivou.before.status === 'Resolvida';
  return Boolean(d.resolvedAt || (d.decision && d.decision.trim()));
}

/** `divergenceRemoval`: cancelamento (taróloga ou arquivo antigo sem decisão) ou exclusão; `null` se não saiu da lista. */
function retirada(d) {
  if (d.deletedAt) return { tipo: 'deleted', em: d.deletedAt, autor: d.deletedBy, motivo: d.deleteReason };
  if (d.readerCancelledAt) return { tipo: 'cancelled', em: d.readerCancelledAt, autor: d.readerCancelledBy, motivo: d.archiveReason };
  if (d.status === 'Arquivada' && !temResolucao(d)) {
    const e = [...(d.history || [])].reverse().find((x) => x.action === 'Retirada e arquivada' || x.action === 'Pedido cancelado' || x.action === 'Arquivada');
    return { tipo: 'cancelled', em: d.archivedAt || (e && e.at), autor: d.archivedBy || (e && e.actor), motivo: d.archiveReason || (e && e.note) };
  }
  return null;
}

/** `divergenceListGroup` / `readerDivergenceTab`: 'abertas' | 'resolvidas' | 'excluidas'. */
function aba(d) {
  if (retirada(d)) return 'excluidas';
  return temResolucao(d) ? 'resolvidas' : 'abertas';
}

/** `canRestoreReaderDivergence`: só a resolvida que foi excluída (não a cancelada, nem a que saiu da lixeira). */
const podeRestaurar = (d) => Boolean(d.deletedAt) && !d.readerCancelledAt && !d.readerTrashClearedAt && temResolucao(d);

/** `isOpenDivergence` da v706: cancelada pela taróloga não é aberta. */
const aberta = (d) => !d.deletedAt && !d.readerCancelledAt && (d.status === 'Pendente' || d.status === 'Em conferência');

module.exports = { temResolucao, retirada, aba, podeRestaurar, aberta };
