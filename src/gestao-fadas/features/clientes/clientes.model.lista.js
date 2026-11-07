'use strict';

/** A lista: filtro, ordenação, seleção da página e montagem do resultado (fatia de clientes.model.js). */

const { buildRealConsultationsCut } = require('./helpers/consultas');
const { buildRealReceiptsCut } = require('./helpers/recebimentos');
const { localOperationalDateKey, pageInfo, paginate, shiftDateKey } = require('./helpers/valores');
const { clientListDisplayName } = require('./helpers/busca');
const { canViewCivilIdentity, clientRolePolicy } = require('./helpers/perfis');
const { ZERO, WHOLE_HISTORY, cmp, allReceiptRows, newestFirst, firstOfEach } = require('./clientes.model.comum');
const { readRealClientRow } = require('./clientes.model.cadastro');
const { matchesSearch } = require('./clientes.model.busca');

/** Clientes com consulta em andamento agora: aberta (R4) e iniciada no dia operacional de hoje. */
function consultingNow(rows, nowLocal) {
  const today = localOperationalDateKey(nowLocal);
  const { inProgress } = buildRealConsultationsCut({ rows, range: { start: today, end: today }, nowLocal });
  return new Set(inProgress.flatMap((item) => (item.clientId === null ? [] : [item.clientId])));
}

function balanceMatches(cents, filter) {
  if (filter === 'todos') return true;
  // Saldo não informado não está em nenhum dos três (R19).
  if (cents === null) return false;
  return filter === 'credito' ? cents > ZERO : filter === 'debito' ? cents < ZERO : cents === ZERO;
}

function recordsOf(rows, catalogos) {
  const records = new Map();
  for (const row of rows) {
    const record = readRealClientRow(row, catalogos);
    if (record) records.set(record.id, record);
  }
  return records;
}

/**
 * Última movimentação de cada cliente: consulta pelo dia operacional, recebimento pela data paga civil, nas três
 * origens. Um ID sem cadastro de cliente não é cliente na lista; continua nas outras telas (R19).
 * Retorna latest(clientId, range?, kind?) -> instante local ou null.
 */
function movementsOf(records, history) {
  const movements = new Map();
  const move = (clientId, movement) => {
    if (clientId === null || !records.has(clientId)) return;
    const own = movements.get(clientId);
    if (own) own.push(movement);
    else movements.set(clientId, [movement]);
  };
  for (const row of history.consultations) {
    if (row.startedAtLocal) move(row.clientId, { day: localOperationalDateKey(row.startedAtLocal), at: row.startedAtLocal, kind: 'consultation' });
  }
  for (const row of allReceiptRows(history.receipts)) if (row.paidAtLocal) move(row.clientId, { day: row.paidAtLocal.slice(0, 10), at: row.paidAtLocal, kind: 'receipt' });
  return (id, range, kind) => (movements.get(id) ?? [])
    .filter((item) => (!range || (item.day >= range.start && item.day <= range.end)) && (!kind || item.kind === kind))
    .reduce((max, item) => (max === null || item.at > max ? item.at : max), null);
}

function listOrder(plan, latest) {
  const name = ({ record }) => clientListDisplayName({ name: record.name ?? '', displayName: record.name ?? `Cliente ${record.id}` }, { fullName: record.fullName ?? undefined }, plan.role);
  // O instante das ordenações por data: a última movimentação da linha, o início da última consulta ou o dia do último
  // pagamento, como as colunas da lista os mostram, da história inteira (T096). Nenhum é o mais antigo, como na v608.
  const moment = ({ record, latestActivityLocal }) => (plan.sort === 'lastConsultation' ? latest(record.id, undefined, 'consultation')
    : plan.sort === 'lastPayment' ? latest(record.id, undefined, 'receipt')?.slice(0, 10) ?? null : latestActivityLocal);
  return (a, b) => {
    let compared = 0;
    if (plan.sort === 'balance') {
      const x = a.record.balanceCents;
      const y = b.record.balanceCents;
      // Saldo não informado não é zero: vai por último nos dois sentidos.
      if ((x === null) !== (y === null)) return x === null ? 1 : -1;
      compared = x === null || y === null ? 0 : cmp(x, y);
    } else if (plan.sort === 'name') compared = name(a).localeCompare(name(b), 'pt-BR', { sensitivity: 'base' });
    else if (plan.sort === 'id') compared = Number(a.record.id) - Number(b.record.id);
    else compared = cmp(moment(a) ?? '', moment(b) ?? '');
    // Desempate da v608, o maior ID primeiro, qualquer que seja o sentido.
    return (plan.direction === 'asc' ? compared : -compared) || b.record.id.localeCompare(a.record.id, undefined, { numeric: true });
  };
}

/**
 * Filtra e ordena os cadastros do plano (sem paginar). Usado pela referência em memória (selectRealClientList) e pelo
 * serviço, que traz `latest`, `now` e `consulted` por agregações em vez das histórias inteiras.
 *  - records: Map id -> RealClientRecord (só candidatos);
 *  - latest: (id, range?, kind?) -> instante local | null;
 *  - now: Set de IDs com consulta em andamento agora; consulted: Set de IDs com alguma consulta no legado.
 */
function filterAndSortClients(plan, records, latest, now, consulted) {
  const listed = [];
  for (const record of records.values()) {
    // A busca ignora o recorte e lê a última movimentação da história inteira; "Em consulta agora" só estreita o
    // recorte, como na v608.
    const latestActivityLocal = plan.searching ? latest(record.id) : latest(record.id, plan.range);
    if (plan.searching ? !matchesSearch(record, plan.search, plan.role) : latestActivityLocal === null || (plan.scope === 'live' && !now.has(record.id))) continue;
    const inConsultationNow = now.has(record.id);
    if ((plan.situation === 'consulta' && !inConsultationNow) || (plan.situation === 'nunca' && consulted.has(record.id))) continue;
    if (!balanceMatches(record.balanceCents, plan.balance)) continue;
    listed.push({ record, latestActivityLocal, inConsultationNow });
  }
  listed.sort(listOrder(plan, latest));
  return listed;
}

/**
 * A regra da lista em memória, sobre cadastros e histórias inteiras: a referência contra a qual o leitor foi testado (T096).
 * `sources` = { clients, consultations, receipts, consultedClientIds, catalogos? }.
 */
function selectRealClientList(plan, sources) {
  const records = recordsOf(sources.clients, sources.catalogos);
  const latest = movementsOf(records, sources);
  const now = consultingNow(sources.consultations, plan.nowLocal);
  const consulted = new Set(sources.consultedClientIds);
  const listed = filterAndSortClients(plan, records, latest, now, consulted);
  const paged = paginate(listed, plan.page, plan.pageSize);

  // As contagens dos controles de data são a movimentação simples de cada recorte, sem os filtros, como a v608 as conta.
  const counted = (start, end) => [...records.keys()].filter((id) => latest(id, { start, end }) !== null).length;
  const { today } = plan;
  const dateCounts = clientRolePolicy(plan.role).canSeeDateCounts && !plan.searching
    ? { hoje: counted(today, today), ontem: counted(shiftDateKey(today, -1), shiftDateKey(today, -1)), '7dias': counted(shiftDateKey(today, -6), today) } : undefined;
  return { plan, clients: paged.items, page: paged.page, ...(dateCounts ? { dateCounts } : {}), pageClientIds: paged.items.map((item) => item.record.id) };
}

/** Os números da página, ou PageOutOfRange (400) para página além da última; o leitor pergunta antes de ler qualquer história. */
const realClientListPageInfo = (plan, totalItems) => pageInfo(plan.page, plan.pageSize, totalItems);

/**
 * A seleção da página que o leitor escolheu, com a última movimentação e "em consulta agora" das histórias dos seus clientes.
 * `page` = { clientIds, totalItems, dateCounts? }; `sources` = { clients, consultations, receipts, catalogos? }.
 */
function realClientListSelection(plan, page, sources) {
  const info = realClientListPageInfo(plan, page.totalItems);
  const records = recordsOf(sources.clients, sources.catalogos);
  const latest = movementsOf(records, sources);
  const now = consultingNow(sources.consultations, plan.nowLocal);
  // Um cadastro que sumiu entre as consultas deixa a linha de fora; o total continua o contado.
  const clients = page.clientIds.flatMap((id) => {
    const record = records.get(id);
    return record ? [{ record, latestActivityLocal: plan.searching ? latest(id) : latest(id, plan.range), inConsultationNow: now.has(id) }] : [];
  });
  return { plan, clients, page: info, ...(page.dateCounts ? { dateCounts: page.dateCounts } : {}), pageClientIds: clients.map((item) => item.record.id) };
}

/** A lista final (RealClientListResult). `history` = { consultations, receipts } das histórias da página. */
function buildRealClientList(selection, history) {
  const { plan } = selection;
  const cut = buildRealConsultationsCut({ rows: history.consultations, range: WHOLE_HISTORY, nowLocal: plan.nowLocal });
  const lastConsultation = firstOfEach([...cut.inProgress, ...cut.finished].sort(newestFirst), (item) => item.clientId);
  // A lista por período já concilia e ordena os recebimentos datados do mais recente (R5): o primeiro de cada cliente é o último.
  const lastReceipt = firstOfEach(buildRealReceiptsCut({ ...history.receipts, range: WHOLE_HISTORY, by: 'paid' }).receipts, (item) => item.clientId);
  const seeBalance = clientRolePolicy(plan.role).canSeeBalance;
  const clients = selection.clients.map(({ record, latestActivityLocal, inConsultationNow }) => {
    const consultation = lastConsultation.get(record.id);
    const receipt = lastReceipt.get(record.id);
    return {
      id: record.id, name: record.name, nameMissing: record.name === null, treatAs: record.treatAs, fullName: canViewCivilIdentity(plan.role) ? record.fullName : null, modality: null,
      ...(seeBalance ? { oldBalance: record.oldBalance.balance } : {}),
      inConsultationNow, latestActivityLocal,
      lastConsultation: consultation ? { id: consultation.id, startedAtLocal: consultation.startedAtLocal, tarotName: consultation.tarotName, situation: consultation.situation } : null,
      lastReceipt: receipt ? { key: receipt.key, paidOn: receipt.paidOn, amount: receipt.amount, situation: receipt.situation } : null,
      linkedValidId: record.linkedValidId,
    };
  });
  return {
    today: plan.today, range: plan.range, searching: plan.searching, clients, page: selection.page,
    ...(selection.dateCounts ? { dateCounts: selection.dateCounts } : {}),
    // Os filtros, ordenações e escopos da tela aprovada sem fonte no legado (FR-050).
    notIntegrated: { filters: ['regime', 'aguarda'], sorts: ['credit'], scopes: ['paid', 'new', 'first', 'general', 'scheduled'] },
  };
}

module.exports = {
  consultingNow,
  filterAndSortClients,
  movementsOf,
  realClientListPageInfo,
  realClientListSelection,
  recordsOf,
  selectRealClientList,
  buildRealClientList,
};
