'use strict';

/**
 * `payments` do snapshot (Maturacao/59, 3.6; Maturacao/60, seção 4). Duas origens, das clientes em foco nos últimos 45 dias (+ os pagamentos que
 * usam as MESMAS referências do evento, para a Lilly ver duplicidade entre clientes):
 *  - Legado `tbl_pagtoinformado`/`tbl_pagtoconfirmado` (leitura), conciliado pela regra R5 do projeto (`reconcileReceipts`): `id_status_pagto`
 *    2 = confirmado, 1 = informado (não confirmado), 0 = automático do Mercado Pago, conta como informado. Divergência entre os sinais
 *    (número x texto, par divergente) ou `não localizado` = `pending` (não conta como pago). `tbl_pagtonaolocalizado` não entra.
 *  - Lançados no Postgres (`gf_pagamentos`): `Confirmado` = confirmed, `Cancelado` = cancelled, `Em conferência` = pending, demais = informed.
 *    O espelho no legado (`legado_id`) não conta duas vezes. Referências do provedor vêm de `gf_lilly_pagamento_refs`.
 *  - SEM FONTE: `allocatedAmount` (líquido destinado à ocorrência; o contrato exige, o doc 60 não define) e `appointmentId`.
 */

const { LIMITES } = require('./contexto.limites');
const { LimiteExcedido } = require('./contexto.cobertura');
const { readLegacyPayment, reconcileReceipts, INFORMED_TABLE, CONFIRMED_TABLE } = require('../../clientes/helpers/recebimentos');

const DIA_MS = 24 * 3600 * 1000;
const sem = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));
const item = (l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item || {});
const iso = (v) => (v ? new Date(v).toISOString() : undefined);
/** `AAAA-MM-DDTHH:mm:ss` de São Paulo -> ISO com o offset fixo -03:00. */
const localParaIso = (t) => (t ? `${`${t}`.replace(' ', 'T').slice(0, 19)}-03:00` : undefined);
const SITUACAO = Object.freeze({ confirmado: 'confirmed', informado: 'informed', 'nao-localizado': 'pending', 'conferir-origem': 'pending' });

function statusDoPostgres(l, i, confirmadoPeloProvedor = false) {
  if (l.status === 'Cancelado' || i.status === 'Cancelado') return 'cancelled';
  // Pix conferido no provedor (Lilly v708, `providerConfirmed` guardado com a referência): a Lilly precisa ler o lançamento como confirmado.
  if (l.confirmacao === 'Confirmado' || i.confirmation === 'Confirmado' || confirmadoPeloProvedor) return 'confirmed';
  if (l.status === 'Em conferência') return 'pending';
  return 'informed';
}

/** Minutos do pacote (`purchase`) e crédito de continuação gravados NO LANÇAMENTO. Nunca calculados pela tarifa geral (docs/banco/22 §5). */
function creditoDoLancamento(i) {
  const compra = i.purchase && Number.isFinite(i.purchase.minutes) && i.purchase.minutes > 0 ? sem({ amount: Number.isFinite(i.purchase.amount) ? i.purchase.amount : undefined, minutes: i.purchase.minutes }) : undefined;
  const c = i.continuationCredit;
  const ok = c && typeof c.consultationId === 'string' && c.consultationId && [c.minutesBefore, c.addedMinutes, c.minutesAfter].every((n) => Number.isFinite(n) && n >= 0);
  return { purchase: compra, continuationCredit: ok ? { consultationId: c.consultationId, minutesBefore: c.minutesBefore, addedMinutes: c.addedMinutes, minutesAfter: c.minutesAfter } : undefined };
}

function pagamentoDoPostgres(l, refs, conversaDoEvento) {
  const i = item(l);
  const ref = refs.get(`${l.id}`);
  const doProvedor = Boolean(ref && ref.providerConfirmed);
  return sem({
    id: l.id,
    clientId: l.id_cliente,
    amount: Number(l.valor_centavos) / 100,
    status: statusDoPostgres(l, i, doProvedor),
    consultationId: l.id_consulta || (typeof i.linkedConsultationId === 'string' ? i.linkedConsultationId : undefined),
    conversationId: ref && ref.sourceEventId ? conversaDoEvento.get(ref.sourceEventId) : undefined,
    reference: ref && ref.reference, mpPaymentId: ref && ref.mpPaymentId, externalTransactionId: ref && ref.externalTransactionId,
    endToEndId: ref && ref.endToEndId, sourceEventId: ref && ref.sourceEventId,
    createdAt: iso(l.informado_em),
    paidAt: typeof i.paidAt === 'string' ? i.paidAt : undefined,
    payerName: typeof i.payerName === 'string' ? i.payerName : undefined, authorization: typeof i.authorization === 'string' ? i.authorization : undefined,
    ...sem(creditoDoLancamento(i)),
    method: l.metodo, bank: typeof i.bank === 'string' ? i.bank : undefined,
    ...(doProvedor ? { confirmation: 'Confirmado', providerConfirmed: true, authorizedBy: ref.authorizedBy } : {}),
    date: typeof i.paidAt === 'string' ? i.paidAt.slice(0, 10) : iso(l.informado_em).slice(0, 10),
  });
}

function pagamentoDoLegado(r) {
  const valor = r.amount === null || r.amount === undefined ? undefined : Number(r.amount);
  return sem({
    id: r.key, clientId: r.clientId, amount: valor, status: SITUACAO[r.situation] || 'pending',
    createdAt: localParaIso(r.launchedAtLocal), date: r.paidOn || undefined,
  });
}

/** @returns {Promise<object[]>} */
async function montarPagamentos({ agora, focoIds, paymentId, referencias }, f) {
  const desde = new Date(agora.getTime() - LIMITES.JANELA_PAGAMENTOS_DIAS * DIA_MS);
  const desdeIso = desde.toISOString();
  const desdeLocal = new Date(desde.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const max = LIMITES.PAGAMENTOS;

  const iguais = Object.keys(referencias).length ? await f.pagamentosPorReferencias(referencias) : [];
  const extras = [...new Set([paymentId, ...iguais].filter(Boolean))];
  const [linhasPg, bruto] = await Promise.all([
    f.pagamentos({ clientIds: focoIds, desdeIso, paymentIds: extras, limite: max }),
    f.pagamentosLegado(focoIds, desdeLocal, max),
  ]);
  if (linhasPg.length > max || bruto.informed.length > max || bruto.confirmed.length > max) throw new LimiteExcedido('payments');

  const refs = new Map((await f.refsDePagamentos(linhasPg.map((l) => l.id))).map((r) => [r.paymentId, r]));
  const eventos = [...new Set([...refs.values()].map((r) => r.sourceEventId).filter(Boolean))];
  if (eventos.length > LIMITES.PAGAMENTOS) throw new LimiteExcedido('payments');
  const conversaDoEvento = new Map();
  for (const id of eventos) { const e = await f.eventoPorId(id); if (e && e.conversationId) conversaDoEvento.set(id, e.conversationId); }

  const espelhados = new Set(linhasPg.map((l) => l.legado_id).filter(Boolean).map(String));
  const informed = bruto.informed.map((r) => readLegacyPayment(r, INFORMED_TABLE));
  const confirmed = bruto.confirmed.map((r) => readLegacyPayment(r, CONFIRMED_TABLE));
  const recibos = reconcileReceipts({ informed, confirmed, notFound: [] })
    .filter((r) => !r.origins.some((o) => o.table === INFORMED_TABLE && espelhados.has(o.id)));
  return [...linhasPg.map((l) => pagamentoDoPostgres(l, refs, conversaDoEvento)), ...recibos.map(pagamentoDoLegado)];
}

module.exports = { montarPagamentos, statusDoPostgres, pagamentoDoLegado };
