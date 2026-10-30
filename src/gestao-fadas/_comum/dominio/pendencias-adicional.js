'use strict';

/**
 * Pendências, a pendência `addition:` (Adicional: quantidade a conferir) derivada no servidor (Maturacao/43). Porte do CÓDIGO do front:
 *   - `painel/panel-pending-items.tsx` `payoutAdditionPendingItems` (uma pendência por ocorrência `pending` de regra POR UNIDADE com data até a data da tela;
 *     o nome é o da profissional, senão o próprio id) e o `referenceDate` que `panelPendingItems` carimba em todas;
 *   - `painel/staff-operations-context.tsx` (`originIds`: `addition:<ocorrência>` de TODA ocorrência do armazém, pendente ou não).
 * A fonte é `gf_adicionais_itens` (regras e ocorrências do armazém de Adicionais). Sem relógio nem banco. Ouro: `scripts/gerar-ouro-gf-estado-financeiro.js`.
 */

const dataBr = (d) => d.split('-').reverse().join('/');

/** `loja`: armazém `{ categories, rules, occurrences }`; `nomes`: `Map`/objeto `tarotId -> nome`; `ate`: a data da tela. Devolve snapshots com `referenceDate = ate`. */
function itensDeAdicional(loja, nomes, ate) {
  const nome = (id) => (nomes instanceof Map ? nomes.get(id) : nomes && nomes[id]) ?? id;
  return [...loja.occurrences].filter((o) => o.status === 'pending' && o.date <= ate).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).flatMap((o) => {
    const regra = loja.rules.find((r) => r.id === o.ruleId);
    if (!regra || regra.value.kind !== 'unit') return [];
    return [{ id: `addition:${o.id}`, occurrence: o.id, referenceDate: ate, financial: true, tone: 'addition', title: 'Adicional: quantidade a conferir', who: nome(regra.tarotId), detail: `${regra.categoryName} · ${dataBr(o.date)} · informar ${regra.value.unitLabel}` }];
  });
}

/** `originIds`: toda ocorrência do armazém é origem lida. */
const origensDeAdicional = (loja) => loja.occurrences.map((o) => `addition:${o.id}`);

module.exports = { itensDeAdicional, origensDeAdicional };
