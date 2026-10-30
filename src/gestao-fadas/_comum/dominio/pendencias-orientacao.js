'use strict';

/**
 * Pendências, a pendência `guidance:` (Orientação da supervisora) derivada no servidor (Maturacao/41). Porte do CÓDIGO do front:
 *   - `painel/panel-pending-items.tsx` `financialGuidancePendingItems` (uma pendência por cliente com orientação ativa e em revisão, ligada ao
 *     ÚLTIMO pedido do histórico; sem ícone nem ação);
 *   - `painel/staff-operations-context.tsx` (`originIds`: `guidance:<id>` de cada cliente conhecida; só com a ficha real, `realGuidance`).
 * A fonte é `gf_clientes_orientacoes` (Maturacao/36). O nome da cliente é o do registro de clientes reais (`/payments/accounts`: nome editado,
 * senão o do legado, senão "Cliente <id>"). Sem relógio nem banco. Ouro: `scripts/gerar-ouro-gf-pendencias-orientacao.js`.
 */

/** `orientacoes`: `[{ clientId, nome, guidance }]` (guidance = `ClientFinancialGuidance` guardada). Devolve os snapshots, sem `referenceDate`. */
function itensDeOrientacao(orientacoes) {
  return [...orientacoes].sort((a, b) => Number(a.clientId) - Number(b.clientId)).flatMap(({ clientId, nome, guidance }) => {
    if (!guidance || !guidance.active || !guidance.pendingReview) return [];
    const pedido = [...(guidance.history || [])].reverse().find((e) => e.action === 'request');
    if (!pedido) return [];
    return [{ id: `guidance:${clientId}`, occurrence: pedido.id, financial: false, tone: 'guidance', title: 'Orientação para novo atendimento', who: `${clientId} · ${nome}`, detail: guidance.reason }];
  });
}

/** Ids de origem lidos (`originIds`): toda cliente com orientação guardada, com ou sem pendência. */
const origensDeOrientacao = (orientacoes) => orientacoes.map((o) => `guidance:${o.clientId}`);

module.exports = { itensDeOrientacao, origensDeOrientacao };
