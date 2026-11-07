'use strict';

/** Os históricos de consultas e de recebimentos da cliente (fatia de clientes.model.js). */

const { buildRealConsultationsCut } = require('./helpers/consultas');
const { originName, summarizeReceipts } = require('./helpers/recebimentos');
const { isRealDay, localOperationalDateKey, moneyToCents, paginate, resolveHistoryDateRange } = require('./helpers/valores');
const { searchAndSortClientHistory, visibleClientHistory } = require('./helpers/historico');
const { realClientHistoryPageSize } = require('../../_comum/dominio/cliente-historico-pagina');
const { WHOLE_HISTORY } = require('./clientes.model.comum');
const { clientConsultations, clientReceipts } = require('./clientes.model.ficha');

/** O alcance que visibleClientHistory dá ao perfil, dito em voz alta, para a tela nunca mostrar o limite como total da cliente. */
function realClientHistoryScope(role, expanded) {
  if (role === 'atendente') return { kind: 'recent', limit: 10 };
  if (role === 'supervisora' && !expanded) return { kind: 'recent', limit: 20 };
  return { kind: 'complete' };
}

/**
 * O recorte que o filtro pede, no relógio do servidor: Hoje, Ontem e 7 dias a partir de hoje operacional, Data a partir
 * de `start` e Período de `start` a `end`, em ordem. Nenhum perfil o estreita e não há limite de 366 dias: Tudo já abre o
 * alcance inteiro. Dia sem modo, ou modo sem dias, é `input`. Retorna { range } (range null = Tudo) ou { denied: 'input' }.
 */
function realClientHistoryDates({ mode = 'tudo', start, end } = {}, nowLocal) {
  const today = localOperationalDateKey(nowLocal);
  if (mode !== 'data' && mode !== 'periodo') {
    if (start !== undefined || end !== undefined) return { denied: 'input' };
    return { range: mode === 'tudo' ? null : resolveHistoryDateRange(mode, today, today, today, today) };
  }
  if (start === undefined || !isRealDay(start) || (end !== undefined && !isRealDay(end))) return { denied: 'input' };
  if (mode === 'data' ? end !== undefined && end !== start : end === undefined) return { denied: 'input' };
  return { range: resolveHistoryDateRange(mode, today, start, start, end ?? start) };
}

/** Consulta pelo dia operacional do início (D10), recebimento pela data paga; sem dia, só em Tudo (D9). */
const inHistoryRange = (day, range) => !range || (day !== null && range.start <= day && day <= range.end);

/** Recebimento sem data paga: fica depois de todo datado, como valor ausente fica por último na v608. */
const UNDATED = '0001-01-01T00:00:00Z';
const RECEIPT_LABELS = {
  confirmado: 'Confirmado', informado: 'Informado', 'nao-localizado': 'Não localizado', 'conferir-origem': 'Conferir a origem',
};

// Os campos que searchAndSortClientHistory lê: em consultas, leitora, canal, opção de pagamento, situação e ID; em
// recebimentos, opção de pagamento, banco, situação e as origens com seus IDs. Relógio de parede é lido como UTC.
function consultationEntry(item) {
  return {
    id: item.id, at: item.startedAtLocal === null ? UNDATED : `${item.startedAtLocal}Z`, title: item.tarotName ?? '',
    detail: [item.channel.label, item.paymentOption.label, item.id].filter(Boolean).join(' · '),
    status: item.situation === 'finalizada' ? 'Finalizada' : 'Em curso', actor: '',
    channel: item.channel.label ?? item.channel.code ?? undefined,
    durationMinutes: item.situation === 'finalizada' ? item.recordedMinutes ?? undefined : undefined,
    // Só para ordenar: os centavos de um valor registrado, nunca uma soma.
    amount: item.amountState === 'registrado' && item.recordedAmount !== null ? Number(moneyToCents(item.recordedAmount)) : undefined,
  };
}

function receiptEntry(item) {
  return {
    id: item.key, at: item.paidOn === null ? UNDATED : `${item.paidOn}T00:00:00Z`, title: item.method.label ?? item.method.code ?? '',
    detail: [item.bank.label ?? item.bank.code, ...item.origins.map(originName)].filter(Boolean).join(' · '),
    status: RECEIPT_LABELS[item.situation], actor: '',
    amount: item.amount === null ? undefined : Number(moneyToCents(item.amount)),
  };
}

/**
 * O alcance do perfil (visibleClientHistory) antes de tudo; depois `narrow` (o recorte de datas, uma leitora), a busca e a
 * ordem de searchAndSortClientHistory, e as páginas da v608. Cada operação conciliada ocupa uma posição.
 */
function scopedHistory(items, entryOf, role, expanded, query, narrow = () => true) {
  const itemOf = new Map();
  const entries = items.map((item) => { const entry = entryOf(item); itemOf.set(entry, item); return entry; });
  // A ordem "recente" da v608 primeiro, para o alcance e a tela desempatarem do mesmo jeito.
  entries.sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  const scopedEntries = visibleClientHistory(entries, role, expanded);
  const sort = query.sort ?? 'recent';
  const sorted = searchAndSortClientHistory(scopedEntries.filter((entry) => narrow(itemOf.get(entry))), query.q ?? '', sort, query.direction);
  // Data paga ausente vai por último nos dois sentidos, como valor ausente na v608.
  const ordered = sort === 'oldest' ? [...sorted.filter((entry) => entry.at !== UNDATED), ...sorted.filter((entry) => entry.at === UNDATED)] : sorted;
  const paged = paginate(ordered.map((entry) => itemOf.get(entry)), query.page, realClientHistoryPageSize(realClientHistoryScope(role, expanded)));
  return { scoped: scopedEntries.map((entry) => itemOf.get(entry)), items: paged.items, page: paged.page };
}

/**
 * Histórico de consultas da cliente. `input` = { role, expanded, nowLocal, clientId, rows, query: { page, q?, sort?, direction?, range?, tarotId? } }.
 */
function buildRealClientConsultationHistory(input) {
  const { own, items } = clientConsultations(input.clientId, input.rows, input.nowLocal);
  const result = scopedHistory(items, consultationEntry, input.role, input.expanded, input.query,
    (item) => (input.query.tarotId === undefined || item.tarotId === input.query.tarotId) && inHistoryRange(item.operationalDate, input.query.range));
  const scopedIds = new Set(result.scoped.map((item) => item.id));
  // Os totais do alcance, antes do recorte de datas e da busca, pelo mesmo corte de Consultas (D10).
  const { totals } = buildRealConsultationsCut({ rows: own.filter((row) => scopedIds.has(row.id)), range: WHOLE_HISTORY, nowLocal: input.nowLocal });
  return { historyScope: realClientHistoryScope(input.role, input.expanded), items: result.items, page: result.page, totals };
}

/** Histórico de recebimentos da cliente. `input` = { role, expanded, clientId, sources, query: { page, q?, sort?, direction?, range? } }. */
function buildRealClientReceiptHistory(input) {
  const result = scopedHistory(clientReceipts(input.clientId, input.sources), receiptEntry, input.role, input.expanded, input.query,
    (item) => inHistoryRange(item.paidOn, input.query.range));
  // O resumo do alcance, antes do recorte de datas e da busca. Recebimento sem data paga está no histórico e fora do resumo (D9).
  const summary = summarizeReceipts(result.scoped.filter((item) => item.paidOn !== null));
  return { historyScope: realClientHistoryScope(input.role, input.expanded), items: result.items, page: result.page, summary };
}

module.exports = {
  buildRealClientConsultationHistory,
  buildRealClientReceiptHistory,
  realClientHistoryDates,
  realClientHistoryScope,
};
