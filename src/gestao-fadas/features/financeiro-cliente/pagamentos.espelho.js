'use strict';

/**
 * Espelho do pagamento informado em `tbl_pagtoinformado` (legado primeiro, Maturacao/46; mapeamento PROVISÓRIO do doc 47/50, só DEV por ora). Flag `GF_LEGADO_PAGAMENTOS`.
 *   - lançar: INSERT no legado ANTES de gravar no Postgres (dentro do pedido). Legado fora do ar = 503 e nada é salvo. Canal que o catálogo não tem (PIX, Dinheiro,
 *     Mercado Pago, Itaú Jurídica, Caixa), Cartão ou cancelado: o pagamento é SALVO só no Postgres, com `legado_estado = 'recusada'` e o motivo em `legado_detalhe`;
 *     nada vai ao legado;
 *   - confirmar: UPDATE `id_status_pagto` -> 2 na linha espelhada;
 *   - corrigir valor, forma, banco, data ou cancelar uma linha já espelhada: o legado NÃO é tocado (nunca apaga) e a linha vira `desatualizada` (decisão da Nice).
 * O INSERT nunca se desfaz (sem DELETE): se o Postgres falha depois, a intenção fica `divergente` com o id do legado para decisão humana.
 */

const legado = require('../../legado-escrita');
const lp = require('../../legado-escrita/legado-primeiro');
const intencoes = require('../../legado-escrita/intencoes');
const { MapeamentoError } = legado.mapeamento;
const { ehIdDaFaixaNova } = require('../../_comum/dominio/cliente-faixa-nova');

const SEM_ESPELHO = { legadoId: null, estado: 'nao_espelhada', detalhe: null };

async function lancamento(ex, reg, atorNome, operationKey) {
  // Não há usuarios correspondente a esta faixa: espelhar criaria um recebimento
  // órfão no ASP, mesmo quando o espelho das clientes antigas estiver habilitado.
  if (ehIdDaFaixaNova(reg.clientId)) return { ...SEM_ESPELHO, detalhe: 'Cliente cadastrada no sistema novo, sem registro no legado.' };
  if (!lp.ativo('pagamentos')) return SEM_ESPELHO;
  let colunas;
  try { colunas = legado.pagamentos.linhaDoPagamento(reg, atorNome); } catch (e) { if (e instanceof MapeamentoError) return { legadoId: null, estado: 'recusada', detalhe: e.message }; throw e; }
  let intencaoId = null;
  try {
    const legadoId = await legado.emTransacao(async (lx) => {
      intencaoId = await intencoes.abrir({ entidade: 'pagamentos', entidadeId: reg.id, escopo: 'pagamentos.lancar', operationKey, depois: colunas });
      return legado.pagamentos.inserir(lx, colunas);
    }, { entidade: 'pagamentos' });
    await intencoes.concluirNaTransacao(ex, intencaoId, legadoId);
    if (Array.isArray(ex.compensacoes)) ex.compensacoes.push(() => intencoes.marcar(intencaoId, 'divergente', `o Postgres falhou depois de o legado receber o pagamento (idPagtoInformado ${legadoId}): decisão humana`, legadoId));
    return { legadoId, estado: 'espelhada', detalhe: `inserido; canal real ${reg.method}${reg.bank ? `/${reg.bank}` : ''} fica só no sistema novo; no legado forma ${colunas.idFormaPagto} + banco ${colunas.idBanco} (provisório, pendente da Nice; o rótulo do catálogo não afirma o canal)` };
  } catch (e) {
    if (intencaoId) await intencoes.marcar(intencaoId, 'revertida', `o legado não gravou: ${(e && (e.codigo || e.message)) || 'erro'}`);
    if (e instanceof MapeamentoError) return { legadoId: null, estado: 'recusada', detalhe: e.message };
    throw lp.falhaDoLegado(e);
  }
}

/** `antes` = linha de gf_pagamentos (com `legado_id`, `legado_estado`) e item anterior; `reg` = registro novo. Devolve os dados do legado ou `null` se nada muda. */
async function revisao(ex, linhaAntes, antes, reg, operationKey) {
  if (ehIdDaFaixaNova(antes.clientId)) return null;
  if (!lp.ativo('pagamentos') || linhaAntes.legado_estado !== 'espelhada' || !linhaAntes.legado_id) return null;
  if (ehIdDaFaixaNova(reg.clientId)) return { legadoId: linhaAntes.legado_id, estado: 'desatualizada', detalhe: 'cliente corrigida para cadastro do sistema novo; o recebimento no legado não foi alterado' };
  const confirmou = antes.confirmation !== 'Confirmado' && reg.confirmation === 'Confirmado';
  const campos = ['amount', 'method', 'bank', 'paidAt', 'authorization', 'note', 'payerName'];
  const mudou = reg.status === 'Cancelado' || campos.some((c) => antes[c] !== reg[c]);
  if (mudou) return { legadoId: linhaAntes.legado_id, estado: 'desatualizada', detalhe: reg.status === 'Cancelado' ? 'cancelado só no sistema novo (o legado nunca apaga)' : 'valor, forma, banco ou data corrigidos só no sistema novo (o legado não foi alterado)' };
  if (!confirmou) return null;
  let intencaoId = null;
  try {
    await legado.emTransacao(async (lx) => {
      intencaoId = await intencoes.abrir({ entidade: 'pagamentos', entidadeId: reg.id, escopo: 'pagamentos.revisar', operationKey, legadoId: linhaAntes.legado_id, depois: { id_status_pagto: legado.provisorio.STATUS_PAGTO_CONFIRMADO } });
      await legado.pagamentos.confirmar(lx, linhaAntes.legado_id, reg.clientId);
    }, { entidade: 'pagamentos' });
    await intencoes.concluirNaTransacao(ex, intencaoId, linhaAntes.legado_id);
    return { legadoId: linhaAntes.legado_id, estado: 'espelhada', detalhe: 'confirmado (id_status_pagto 2)' };
  } catch (e) {
    if (intencaoId) await intencoes.marcar(intencaoId, 'revertida', `o legado não gravou: ${(e && (e.codigo || e.message)) || 'erro'}`);
    throw lp.falhaDoLegado(e);
  }
}

async function marcar(ex, id, d) {
  await ex.execute('UPDATE gf_pagamentos SET legado_id = COALESCE(?, legado_id), legado_estado = ?, legado_detalhe = ?, legado_atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [d.legadoId ?? null, d.estado, d.detalhe ? String(d.detalhe).slice(0, 300) : null, id]);
}

module.exports = { lancamento, revisao, marcar };
