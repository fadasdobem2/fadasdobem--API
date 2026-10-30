'use strict';

/**
 * Pendências, DERIVAÇÃO no servidor (Maturacao/35). Porte do CÓDIGO do front que decide quais pendências existem:
 *   - `painel/panel-model.ts` (`panelData`, com o papel da administradora: vê tudo), só o que alimenta pendências: cancelamentos, encerramentos,
 *     divergências abertas, consultas localizadas na agenda, consulta sem pagamento vinculado e pagamento pendente na agenda;
 *   - `painel/panel-pending-items.tsx` (`panelPendingItems`: id, ocorrência, tom, título, quem e detalhe, sem ícone nem ação);
 *   - `agenda/agenda-model.ts` (`agendaPaymentState`: tom e rótulo), `domain/consultation-migration-state.ts`, `domain/divergence-state.ts`;
 *   - `painel/pending-workflow-model.ts` (`retainRoutedMatches`) e as origens de `staff-operations-context.tsx` (`originIds`).
 * Já portados antes e reaproveitados: `ativoNoDia`, `consultasQueCasam`, `correspondenciaMantida`, `contaDaCliente`, `aguardaConferencia`.
 * `guidance:` (orientação financeira) vem de `pendencias-orientacao.js` (Maturacao/41), com a fonte `gf_clientes_orientacoes`. Fora (sem fonte no
 * servidor): nada. `addition:` (Adicionais) vem de `pendencias-adicional.js` (Maturacao/43), com a fonte `gf_adicionais_itens`. O ouro
 * (`scripts/gerar-ouro-gf-pendencias-origem.js`) roda as funções reais do front sobre os mesmos cenários.
 */

const { ativoNoDia } = require('./agenda-contato');
const { consultasQueCasam, correspondenciaMantida, diaOperacional } = require('./fila-geral-base');
const { consomeCobertura } = require('./financeiro-base');
const { aguardaConferencia } = require('./consulta-comum');
const { contaDaCliente, recebimentoConfirmado, efeitoDaTransferencia } = require('./financeiro-saldo');
const { chaveDe, igual, PendenciaInvalidaError, PendenciaMudouError } = require('./pendencias');
const { itensDeOrientacao, origensDeOrientacao } = require('./pendencias-orientacao');
const { itensDeAdicional, origensDeAdicional } = require('./pendencias-adicional');

const DINHEIRO = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const MOMENTO = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const arred = (v) => Math.round(v * 100) / 100;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const ehData = (v) => typeof v === 'string' && DATA.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;

/** `formatMoment` (consultation-operations.ts:320), sem o calendário de demonstração. */
const momento = (v) => (!v || !Number.isFinite(Date.parse(v)) ? 'Data não disponível' : MOMENTO.format(new Date(v)));
/** `paymentConsultationValue` (cash-ledger.ts:35). */
const valorDaConsulta = (p) => Math.max(0, arred(p.amount + (p.movements || []).reduce((s, m) => s + (m.kind === 'balance-transfer' ? efeitoDaTransferencia(m, p.clientId) : m.creditEffect), 0)));
/** `isOpenDivergence` (divergence-state.ts). */
const divergenciaAberta = (d) => !d.deletedAt && (d.status === 'Pendente' || d.status === 'Em conferência');

/** `consultationNeedsMigration` (consultation-migration-state.ts), sem calendário de demonstração. `hoje` = dia operacional. */
function precisaMigrar(c, hoje) {
  if (c.status !== 'Em curso' || c.endedAt || (c.tarologistFinishReport && c.tarologistFinishReport.endedAt) || c.migrationResolution) return false;
  if (c.migrationPending) return true;
  if (c.tarologistStartedAt) return false;
  return !Number.isFinite(Date.parse(c.startedAt)) || diaOperacional(c.startedAt) < hoje;
}

/** `agendaPaymentState` (agenda-model.ts:81) com pagamentos: só `tone` e `shortLabel`, que são o que a pendência usa. */
function pagamentoDaAgenda(item, pagamentos, consultas) {
  const proprias = consultas.filter((c) => c.clientId === item.clientId);
  const recibos = pagamentos.filter((p) => p.clientId === item.clientId && recebimentoConfirmado(p));
  const daqui = (id) => proprias.some((c) => c.id === id && (c.agendaItemId === item.id || c.id === item.resolvedByConsultationId));
  const centavos = (lista) => lista.reduce((s, p) => s + Math.round(valorDaConsulta(p) * 100), 0) / 100;
  const ligado = centavos(recibos.filter((p) => p.linkedConsultationId && daqui(p.linkedConsultationId)));
  const livre = centavos(recibos.filter((p) => !p.linkedConsultationId && !proprias.some((c) => consomeCobertura(c) && ((c.billing && c.billing.funding) || []).some((l) => l.paymentId === p.id))));
  const disponivel = Math.max(0, Math.min(livre, contaDaCliente(item.clientId, pagamentos, consultas).balance));
  const pago = arred(ligado + disponivel);
  const esperado = item.paymentExpectedAmount;
  const aberto = esperado !== undefined && esperado > 0 ? Math.max(0, arred(esperado - pago)) : undefined;
  const aguardando = pagamentos.some((p) => p.clientId === item.clientId && p.status !== 'Cancelado' && !recebimentoConfirmado(p) && (!p.linkedConsultationId || daqui(p.linkedConsultationId)));
  const tone = aberto !== undefined && aberto > 0 ? (pago > 0 ? 'partial' : 'pending') : pago > 0 ? 'paid' : aguardando || item.paymentPending ? 'pending' : 'unknown';
  const shortLabel = aberto !== undefined && aberto > 0 ? `Falta ${DINHEIRO.format(aberto)}` : pago > 0 ? `${ligado > 0 || aberto === 0 ? 'Pago' : 'Crédito'} ${DINHEIRO.format(pago)}` : aguardando ? 'Pagamento a confirmar' : item.paymentPending ? 'Falta pagar' : 'Sem pagamento';
  return { tone, shortLabel };
}

/** `panelData` (panel-model.ts:50) com o papel da administradora, só o que gera pendência. */
function painel({ consultas, pagamentos, divergencias, agenda }, data, hoje) {
  const espera = agenda.filter((i) => ativoNoDia(i, data, hoje) && i.workflowStatus !== 'Em consulta');
  const pagamentosDaAgenda = Object.fromEntries(espera.map((i) => [i.id, pagamentoDaAgenda(i, pagamentos, consultas)]));
  return {
    waiting: espera, agendaPayments: pagamentosDaAgenda,
    cancellations: consultas.filter((c) => c.cancellationReview && c.cancellationReview.status === 'pending').sort((a, b) => Date.parse(a.cancellationReview.requestedAt) - Date.parse(b.cancellationReview.requestedAt)),
    finishes: consultas.filter(aguardaConferencia),
    divergences: divergencias.filter(divergenciaAberta).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    unpaid: espera.filter((i) => ['partial', 'pending'].includes(pagamentosDaAgenda[i.id].tone)),
    uncovered: consultas.filter((c) => !precisaMigrar(c, hoje) && c.status === 'Em curso' && !c.tarologistFinishReport)
      .filter((c) => c.paymentDisposition === 'Sem pagamento' && !c.coverage && !pagamentos.some((p) => p.linkedConsultationId === c.id && p.status !== 'Cancelado')),
    matches: espera.flatMap((i) => {
      const c = consultasQueCasam(i, consultas, data).find((x) => !correspondenciaMantida(i, x));
      return c ? [{ item: i, consultation: c }] : [];
    }),
  };
}

/** `retainRoutedMatches` (pending-workflow-model.ts): mantém a consulta já encaminhada mesmo que a correspondência tenha mudado. */
function manterEncaminhadas(dados, registros, consultas, data) {
  const matches = [...dados.matches];
  for (const r of registros) {
    if (!r.snapshot.id.startsWith('match:')) continue;
    const item = dados.waiting.find((i) => r.snapshot.id === `match:${i.id}`);
    if (!item || matches.some((m) => m.item.id === item.id && m.consultation.id === r.snapshot.occurrence)) continue;
    const c = consultasQueCasam(item, consultas, data).find((x) => x.id === r.snapshot.occurrence && !correspondenciaMantida(item, x));
    if (c) matches.push({ item, consultation: c });
  }
  return { ...dados, matches };
}

/** `panelPendingItems` (panel-pending-items.tsx:20) sem ícone nem ação, já como `pendingSnapshot`. */
function itens(d, referencia) {
  const lista = [
    ...d.cancellations.map((c) => ({ id: `cancellation:${c.id}`, occurrence: c.cancellationReview.requestedAt, financial: true, tone: 'cancellation', title: 'Cancelamento aguardando decisão', who: `${c.clientId} · ${c.client}`, detail: `${c.tarot} · ${c.cancellationReview.complaint}` })),
    ...d.finishes.map((c) => ({ id: `finish:${c.id}`, occurrence: (c.tarologistFinishReport && c.tarologistFinishReport.submittedAt) || c.id, financial: false, tone: 'finish', title: 'Tarólogo informou encerramento', who: `${c.clientId} · ${c.client}`, detail: `${c.tarot} · ${c.tarologistFinishReport && c.tarologistFinishReport.minutes} min informados` })),
    ...d.divergences.map((x) => ({ id: `divergence:${x.id}`, occurrence: x.createdAt || x.id, financial: x.kind === 'Financeira', tone: 'divergence', title: x.issueType || `${x.kind === 'Financeira' ? 'Divergência financeira' : 'Divergência na consulta'}`, who: `${x.clientId || 'Cliente a identificar'} · ${x.client}`,
      detail: x.reportedMinutes !== undefined ? `${x.tarot || x.reportedBy} · ${x.recordedMinutes ?? '—'} min registrados / ${x.reportedMinutes} informados` : x.reason })),
    ...d.matches.map(({ item, consultation: c }) => ({ id: `match:${item.id}`, occurrence: c.id, financial: false, tone: 'match', title: 'Consulta localizada para cliente na agenda', who: `${item.clientId} · ${item.client}`, detail: `${c.tarot} · ${momento(c.startedAt)} · ${c.status.toLocaleLowerCase('pt-BR')}` })),
    ...d.uncovered.map((c) => ({ id: `uncovered:${c.id}`, occurrence: c.id, financial: false, tone: 'payment', title: 'Consulta sem pagamento vinculado', who: `${c.clientId} · ${c.client}`, detail: `${c.tarot} · conferir a cobertura` })),
    ...d.unpaid.map((i) => ({ id: `unpaid:${i.id}`, occurrence: i.id, financial: false, tone: 'payment', title: 'Pagamento pendente na agenda', who: `${i.clientId} · ${i.client}`, detail: d.agendaPayments[i.id].shortLabel })),
  ];
  return lista.map((i) => ({ ...i, referenceDate: referencia }));
}

/** Datas em que o front procura fontes (`staff-operations-context.tsx`): a da tela, a de referência dos registros e a do agendamento citado. */
function datasDeBusca({ hoje, registros, agenda, extras = [] }) {
  const lista = [hoje, ...registros.flatMap((r) => (r.snapshot.referenceDate ? [r.snapshot.referenceDate] : [])), ...extras,
    ...registros.flatMap((r) => { const tipo = r.snapshot.id.split(':')[0]; if (tipo !== 'match' && tipo !== 'unpaid') return []; const e = agenda.find((i) => r.snapshot.id === `${tipo}:${i.id}`); return e && e.date ? [e.date] : []; })];
  return [...new Set(lista.filter(ehData))];
}

/**
 * Deriva as fontes: `fontes` (chave -> snapshots possíveis, um por data de referência) e `origens` (ids de origem carregados, o `originIds`).
 * `entrada`: `{ consultas, agenda, pagamentos, divergencias }` no formato do front; `registros`: encaminhamentos atuais (PendingRouting).
 */
function derivar(entrada, { hoje, registros = [], extras = [] }) {
  const fontes = new Map();
  for (const data of datasDeBusca({ hoje, registros, agenda: entrada.agenda, extras })) {
    const dados = manterEncaminhadas(painel(entrada, data, hoje), registros, entrada.consultas, data);
    // `addition:` (Maturacao/43): só com o armazém lido (`entrada.adicionais`); as de cada data entram como as demais (o front carimba a data da tela).
    const doAdicional = entrada.adicionais ? itensDeAdicional(entrada.adicionais.loja, entrada.adicionais.nomes, data) : [];
    for (const s of [...itens(dados, data), ...doAdicional]) { const k = chaveDe(s); fontes.set(k, [...(fontes.get(k) || []), s]); }
  }
  const origens = new Set([...entrada.consultas.flatMap((c) => [`finish:${c.id}`, `uncovered:${c.id}`, `cancellation:${c.id}`]), ...entrada.agenda.flatMap((i) => [`match:${i.id}`, `unpaid:${i.id}`]), ...entrada.divergencias.map((x) => `divergence:${x.id}`)]);
  // `guidance:` (Maturacao/41): só com a ficha real (`entrada.orientacoes` lido); uma fonte por cliente, sem data de referência.
  const guidance = Array.isArray(entrada.orientacoes);
  const orientacoes = guidance ? itensDeOrientacao(entrada.orientacoes) : [];
  for (const s of orientacoes) fontes.set(chaveDe(s), [s]);
  if (guidance) origensDeOrientacao(entrada.orientacoes).forEach((id) => origens.add(id));
  const adicionais = Boolean(entrada.adicionais);
  if (adicionais) origensDeAdicional(entrada.adicionais.loja).forEach((id) => origens.add(id));
  // `vivas`: o que a tela lista sem nenhum encaminhamento (`live` do front: só a data de hoje, sem `retainRoutedMatches`).
  const vivas = new Map(itens(painel(entrada, hoje, hoje), hoje).map((s) => [chaveDe(s), s]));
  for (const s of orientacoes) vivas.set(chaveDe(s), s);
  if (adicionais) for (const s of itensDeAdicional(entrada.adicionais.loja, entrada.adicionais.nomes, hoje)) vivas.set(chaveDe(s), s);
  return { fontes, origens, vivas, guidance, adicionais };
}

const DERIVAVEIS = new Set(['cancellation', 'finish', 'divergence', 'match', 'uncovered', 'unpaid', 'guidance', 'addition']);
const derivavel = (snapshot) => DERIVAVEIS.has(snapshot.id.split(':')[0]);

const MUDOU = 'A pendência mudou. Atualize a lista e tente novamente.';

/**
 * Confere a gravação contra a ORIGEM derivada no servidor (só ids derivados). `pedido` é o que o navegador montou; `saida` o registro carimbado.
 * O que o front faz e o servidor aceita: encaminhar/devolver uma pendência que existe na origem (snapshot igual ao derivado) ou que o registro
 * já guarda e cuja origem não foi carregada; resolver só quando a fonte SUMIU e a origem foi lida; reabrir só quando a fonte VOLTOU.
 * Divergência de origem é 409 (a lista do navegador está velha); regra do front quebrada é 422.
 */
function conferirOrigem(antes, pedido, saida, origem) {
  const snap = pedido.snapshot;
  if (!derivavel(snap)) return saida;
  if (snap.id.startsWith('guidance:') && !origem.guidance) return saida; // sem a ficha real lida, vale só a forma e as filas
  if (snap.id.startsWith('addition:') && !origem.adicionais) return saida; // sem o armazém de Adicionais lido, idem (Maturacao/43)
  const candidatos = origem.fontes.get(pedido.key) || [];
  const eventos = antes ? antes.events.length : 0;
  if (saida.events.length === eventos) {
    if (antes && igual(antes, pedido)) return saida;
    // A "semente" da orientação (`seedFinancialGuidanceRouting`): registro novo, sem evento, na Supervisão, com o snapshot que a ficha deriva.
    if (!antes && snap.tone === 'guidance' && saida.queue === 'supervisao' && candidatos.some((s) => igual(s, snap))) return saida;
    throw new PendenciaInvalidaError('Pendência: o registro de uma pendência derivada só muda com um evento.');
  }
  const acao = saida.events[saida.events.length - 1].action;
  const casa = candidatos.some((s) => igual(s, snap));
  if (acao === 'forward' || acao === 'return') {
    if (candidatos.length) { if (!casa) throw new PendenciaMudouError(MUDOU); return saida; }
    if (antes && !antes.resolvedAt && !origem.origens.has(snap.id) && igual(antes.snapshot, snap)) return saida;
    throw new PendenciaMudouError('Esta pendência não está mais disponível.');
  }
  if (acao === 'resolved') {
    if (candidatos.length || !origem.origens.has(snap.id)) throw new PendenciaMudouError(MUDOU);
    if (!antes || !igual(antes.snapshot, snap)) throw new PendenciaInvalidaError('Pendência: a resolução não muda o registro da pendência.');
    return saida;
  }
  if (!casa) throw new PendenciaMudouError(MUDOU);
  return saida;
}

module.exports = { conferirOrigem, MUDOU, derivar, painel, itens, datasDeBusca, pagamentoDaAgenda, precisaMigrar, divergenciaAberta, manterEncaminhadas, derivavel, momento, ehData };
