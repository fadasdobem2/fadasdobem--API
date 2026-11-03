'use strict';

/**
 * Regra pura de CLIENTES (sem banco, sem Express). Porta fiel de features/clientes/real-clients-model.ts do suspiro
 * (spec 004, história 10; research R18 a R20), mais as regras de perfil de real-clients-http.server.ts.
 *
 * As regras de cada perfil (administradora, assistente, supervisora, atendente) são as da v608, aplicadas no servidor
 * antes de qualquer coisa sair. O recorte por perfil vem do `role` recebido (perfil da B); a conversão do papel RBAC da
 * A para esse perfil está em helpers/perfis.js (objeto CONFIGURACAO_PERFIS).
 *
 * Nomes do DTO, chaves e textos em português seguem a B (RealClientListItem, RealClientProfile, current, tarologists,
 * counts, dateCounts, notIntegrated, issues...). Nenhuma credencial (senha, login) entra aqui: as linhas de `usuarios`
 * já chegam pela lista branca de colunas (R18) e o model Sequelize da A nem tem essas colunas.
 */

const { buildRealConsultationsCut } = require('./helpers/consultas');
const {
  buildRealReceiptsCut, originName, reconcileReceipts, summarizeReceipts,
} = require('./helpers/recebimentos');
const {
  centsToMoney, isRealDay, legacyId, legacyLocalDateTime, legacyMoney, legacyNoteText, legacyText, localOperationalDateKey, moneyToCents,
  pageInfo, paginate, resolveHistoryDateRange, shiftDateKey, utcLocalToSaoPauloLocal, withinRealPeriod,
} = require('./helpers/valores');
const { searchAndSortClientHistory, validateHistoryAccessReason, visibleClientHistory } = require('./helpers/historico');
const {
  clientListDisplayName, clientMatchesSearch, emptyClientSearch, hasClientSearch,
} = require('./helpers/busca');
const { canViewCivilIdentity, canViewFullRegistration, clientRolePolicy, permissionsFor } = require('./helpers/perfis');

const ZERO = BigInt(0);
/** Intervalo que cabe qualquer história: o corte I14 mantém toda consulta com início e nenhuma como "aberta-antes". */
const WHOLE_HISTORY = { start: '0001-01-01', end: '9999-12-31' };
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** Catálogos de referência sem linhas: o código fica sem rótulo (R21). Formato: { cpf_status: {'1':'Regular'}, paises: {...} }. */
const CATALOGOS_VAZIOS = Object.freeze({});

// --- o cadastro ------------------------------------------------------------------------------------------

/** Por que um campo aparece como não informado (R18): o dicionário não deixa um zero ser lido como meia-noite. */
const CLIENT_ISSUES = Object.freeze({
  birthDateZero: 'Data de nascimento não informada: data zerada no sistema antigo',
  birthDateInvalid: 'Data de nascimento inválida no sistema antigo',
  birthTimeMissing: 'Hora de nascimento não informada: vazia, zerada ou 00:00 no sistema antigo',
  createdAtMissing: 'Data do cadastro não informada ou inválida no sistema antigo',
});

const phoneOf = (ddd, number) => {
  const text = legacyText(number);
  return text === null ? null : { ddd: legacyText(ddd), number: text };
};

function catalogOf(catalogos, table, value) {
  if (value === '') return null;
  const code = value === null || value === undefined ? null : String(value);
  if (code === null) return null;
  const labels = (catalogos && catalogos[table]) || {};
  return { code, label: Object.prototype.hasOwnProperty.call(labels, code) ? labels[code] ?? null : null };
}

const ZERO_DATE = /^0000-00-00/;
// Só hora e minuto de horanascimento contam; a parte da data não diz nada.
const TIME_OF_DAY = /^(?:\d{4}-\d{2}-\d{2}[ T])?(\d{2}):(\d{2})(?::\d{2}(?:\.\d{1,6})?)?$/;

function birthTimeOf(value) {
  const match = value ? value.match(TIME_OF_DAY) : null;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[1] === '00' && match[2] === '00')) return null;
  return `${match[1]}:${match[2]}`;
}

/** Uma linha de `usuarios` como o Clientes a mostra, ou null quando não é cliente: só `nivel = 0` é (R18). */
function readRealClientRow(row, catalogos = CATALOGOS_VAZIOS) {
  const id = legacyId(row.id);
  if (id === null || row.nivel === null || row.nivel === undefined || String(row.nivel) !== '0') return null;
  const issues = [];
  const birthDate = legacyLocalDateTime(row.datanascimento)?.slice(0, 10) ?? null;
  if (birthDate === null) {
    const zero = !row.datanascimento || ZERO_DATE.test(row.datanascimento);
    issues.push({ field: 'birthDate', message: zero ? CLIENT_ISSUES.birthDateZero : CLIENT_ISSUES.birthDateInvalid });
  }
  const birthTime = birthTimeOf(row.horanascimento);
  if (birthTime === null) issues.push({ field: 'birthTime', message: CLIENT_ISSUES.birthTimeMissing });
  const createdUtc = legacyLocalDateTime(row.data_cadastro);
  if (createdUtc === null) issues.push({ field: 'createdAtLocal', message: CLIENT_ISSUES.createdAtMissing });
  const credit = legacyMoney(row.saldo);
  const toPay = legacyMoney(row.valorAPagar);
  // saldo - valorAPagar em centavos, como o cadastro antigo mostra; coluna nula não é zero (R20).
  const balanceCents = credit === null || toPay === null ? null : moneyToCents(credit) - moneyToCents(toPay);
  return {
    // Nome de identificação vazio é pendência; nenhum outro nome toma o lugar dele (R18).
    id, name: legacyText(row.nome_id)?.trim() || null, treatAs: legacyText(row.nome2), fullName: legacyText(row.nome),
    phones: { home: phoneOf(row.ddd, row.telresidencial), work: phoneOf(row.ddd, row.telcomercial), mobile: phoneOf(row.ddd, row.cel) },
    whatsapp: legacyText(row.whats), email: legacyText(row.email), email2: legacyText(row.email2),
    cpf: legacyText(row.cpf), cpfStatus: catalogOf(catalogos, 'cpf_status', row.status_cpf_id),
    // Texto puro: <br /> vira quebra de linha e qualquer outra marcação fica como escrita, nunca interpretada.
    cpfResult: legacyText(row.buscaNaReceita) === null ? null : legacyNoteText(row.buscaNaReceita),
    birthDate, birthTime,
    birthCity: legacyText(row.cidadeNascimento), birthState: legacyText(row.ufNascimento), birthCountry: catalogOf(catalogos, 'paises', row.IDpaisNascimento),
    address: {
      street: legacyText(row.endereco), number: legacyText(row.numero), complement: legacyText(row.complemento), district: legacyText(row.bairro),
      zip: legacyText(row.cep), city: legacyText(row.cidade), state: legacyText(row.estado), country: catalogOf(catalogos, 'paises', row.idPais),
    },
    createdAtLocal: createdUtc === null ? null : utcLocalToSaoPauloLocal(createdUtc),
    oldBalance: { credit, toPay, balance: balanceCents === null ? null : centsToMoney(balanceCents) }, balanceCents,
    // 0 não é vínculo; o vínculo abre o outro cadastro e as histórias nunca são juntadas (R20).
    linkedValidId: legacyId(row.id_cliente_valido),
    issues,
  };
}

// --- a busca ---------------------------------------------------------------------------------------------

/** clientMatchesSearch da v608 lê estes campos de uma linha demo e do cadastro; o cadastro real os preenche. */
function searchable(record, [whatsapp, phone, workPhone]) {
  const client = { id: record.id, name: record.name ?? '', treatAs: record.treatAs ?? undefined, whatsapp, birthDate: record.birthDate ?? '' };
  const registration = { fullName: record.fullName ?? undefined, email: record.email ?? undefined, email2: record.email2 ?? undefined, phone, workPhone };
  return { client, registration };
}
const dialed = (phone) => (phone ? `${phone.ddd ?? ''}${phone.number}` : undefined);

function matchesSearch(record, search, role) {
  // A v608 compara três telefones e o cadastro real tem quatro (R19). Cada critério roda nos dois conjuntos de telefones
  // e vale se um deles o cumpre; os critérios continuam combinados, como na v608.
  const sets = [
    searchable(record, [record.whatsapp ?? undefined, dialed(record.phones.home), dialed(record.phones.work)]),
    searchable(record, [dialed(record.phones.mobile)]),
  ];
  const fields = Object.keys(search).filter((key) => search[key].trim());
  return fields.every((key) => sets.some(({ client, registration }) => clientMatchesSearch(client, registration, { ...emptyClientSearch(), [key]: search[key] }, role)));
}

/** Se a busca da v608 acha uma linha de cadastro; o leitor decide ID, telefone e nascimento com ela (R19, T096). */
function realClientMatches(row, search, role) {
  const record = readRealClientRow(row);
  return record !== null && matchesSearch(record, search, role);
}

// --- a lista ---------------------------------------------------------------------------------------------

const PAGE_SIZES = [20, 30, 50];
const DETAILED_SEARCH = ['q', 'name', 'phone', 'email', 'birthDate'];

/** Recorte de datas da lista por perfil (clientListRange da v608). */
function clientListRange(role, mode, today, start, end) {
  if (role === 'assistente') return { start: shiftDateKey(today, -2), end: today };
  if (role === 'atendente' || !clientRolePolicy(role).dates.includes(mode)) return { start: today, end: today };
  if (mode === 'ontem') return { start: shiftDateKey(today, -1), end: shiftDateKey(today, -1) };
  if (mode === '7dias') return { start: shiftDateKey(today, -6), end: today };
  if (mode === 'data') return { start, end: start };
  if (mode === 'periodo') return start > end ? { start: end, end: start } : { start, end };
  return { start: today, end: today };
}

/**
 * A lista que um perfil pode pedir, ou por que não. Um campo em branco não é busca (hasClientSearch).
 * Retorna { plan } ou { denied: 'role' | 'scope' | 'input' }: role e scope viram 403 ACCESS_DENIED, input vira 400.
 * `query` = { mode, start, end, scope, situation, balance, q, id, name, phone, email, birthDate, sort, direction, page, pageSize }.
 */
function planRealClientList(role, query, nowLocal) {
  if (!permissionsFor(role).canReadRealClients) return { denied: 'role' };
  const policy = clientRolePolicy(role);
  const given = (value) => value !== undefined && value.trim() !== '';
  const { mode, start, end } = query;
  // O que a v608 não dá ao perfil é recusado, nunca estreitado em silêncio: a v608 só o estreita na tela (R19).
  if (role === 'assistente' && (mode !== undefined || start !== undefined || end !== undefined || DETAILED_SEARCH.some((key) => given(query[key])))) return { denied: 'scope' };
  if (mode !== undefined && !policy.dates.includes(mode)) return { denied: 'scope' };
  if (!policy.canSeeBalance && (query.balance !== undefined || query.sort === 'balance')) return { denied: 'scope' };
  const chosen = role === 'assistente' ? '3dias' : mode ?? 'hoje';
  if (chosen !== 'data' && chosen !== 'periodo') {
    // Uma data só vale com Data ou Período; para um perfil sem eles, é recorte fora da política.
    if (start !== undefined || end !== undefined) return { denied: policy.dates.includes('data') ? 'input' : 'scope' };
  } else {
    const last = chosen === 'data' ? end ?? start : end;
    if (start === undefined || last === undefined || !isRealDay(start) || !isRealDay(last) || (chosen === 'data' && last !== start)
      || !withinRealPeriod({ start, end: last })) return { denied: 'input' };
  }
  const pageSize = query.pageSize ?? policy.pageSize;
  const page = query.page ?? 1;
  if (!PAGE_SIZES.includes(pageSize) || !Number.isSafeInteger(page) || page < 1) return { denied: 'input' };
  const today = localOperationalDateKey(nowLocal);
  const range = clientListRange(role, chosen, today, start ?? today, end ?? start ?? today);
  // A assistente busca só pelo ID exato, que a v608 lê do campo único de busca.
  const search = role === 'assistente' ? { ...emptyClientSearch(), query: query.id ?? '' }
    : { query: query.q ?? '', id: query.id ?? '', name: query.name ?? '', phone: query.phone ?? '', email: query.email ?? '', birthDate: query.birthDate ?? '' };
  return {
    plan: {
      role, nowLocal, today, range: { mode: chosen, ...range },
      scope: query.scope ?? 'daily', situation: query.situation ?? 'todos', balance: query.balance ?? 'todos',
      search, searching: hasClientSearch(search), sort: query.sort ?? 'date', direction: query.direction ?? 'desc', page, pageSize,
    },
  };
}

const allReceiptRows = (sources) => [...sources.informed, ...sources.confirmed, ...sources.notFound];

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

/** Ordem "recente" da v608: o início mais novo primeiro, desempate por ID. */
const newestFirst = (a, b) => cmp(b.startedAtLocal ?? '', a.startedAtLocal ?? '') || a.id.localeCompare(b.id);

function firstOfEach(items, key) {
  const first = new Map();
  for (const item of items) {
    const value = key(item);
    if (value !== null && !first.has(value)) first.set(value, item);
  }
  return first;
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

// --- a ficha ---------------------------------------------------------------------------------------------

/** Partes da ficha aprovada sem fonte (FR-050). Login e senha pertencem aos dados adicionais. */
const PROFILE_NOT_INTEGRATED = ['login', 'password', 'modality', 'consultationSettings', 'registrationSource', 'contactHistory',
  'notes', 'restrictions', 'bonuses', 'cancellations', 'account', 'occurrences'];
const ADDITIONAL_NOT_INTEGRATED = new Set(['login', 'password']);
const ADDITIONAL_ISSUES = new Set(['birthTime']);

/** Consultas de uma cliente como a tela Consultas as lê (R4, D10), a mais nova primeiro. Linha de outra cliente fica fora. */
function clientConsultations(clientId, rows, nowLocal) {
  const own = rows.filter((row) => row.clientId === clientId);
  const cut = buildRealConsultationsCut({ rows: own, range: WHOLE_HISTORY, nowLocal });
  return { own, items: [...cut.inProgress, ...cut.finished].sort(newestFirst) };
}

const clientReceipts = (clientId, sources) => reconcileReceipts(sources).filter((item) => item.clientId === clientId);

/** Cada leitora do par, da história inteira qualquer que seja o alcance do perfil (v398), a relação mais recente primeiro. */
function tarologistsOf(newestFirstItems) {
  const byTarot = new Map();
  for (const item of newestFirstItems) {
    // Consulta sem data (A4a) conta para a leitora; sem data, a última relação fica '' (a tela só ordena por ela).
    if (item.tarotId === null || (item.startedAtLocal === null && !item.undatedStart)) continue;
    // Só os minutos de consulta finalizada são somados, como nos totais de Consultas (D10).
    const minutes = item.situation === 'finalizada' ? item.recordedMinutes ?? 0 : 0;
    const seen = byTarot.get(item.tarotId);
    if (seen) { seen.consultations += 1; seen.recordedMinutes += minutes; }
    else byTarot.set(item.tarotId, { tarotId: item.tarotId, tarotName: item.tarotName, consultations: 1, recordedMinutes: minutes, lastStartedAtLocal: item.startedAtLocal ?? '' });
  }
  return [...byTarot.values()];
}

function projectProfile(record, role) {
  const full = canViewFullRegistration(role);
  const civil = canViewCivilIdentity(role); // A2: nome completo, CPF e nascimento só de quem a regra do perfil libera
  return {
    id: record.id, name: record.name, nameMissing: record.name === null, treatAs: record.treatAs, fullName: civil ? record.fullName : null,
    phones: full ? record.phones : { home: record.phones.home },
    whatsapp: record.whatsapp, email: record.email, cpf: civil ? record.cpf : null, birthDate: civil ? record.birthDate : null,
    createdAtLocal: record.createdAtLocal, linkedValidId: record.linkedValidId,
    ...(full ? {
      email2: record.email2, cpfStatus: record.cpfStatus, cpfResult: record.cpfResult, birthTime: record.birthTime,
      birthCity: record.birthCity, birthState: record.birthState, birthCountry: record.birthCountry, address: record.address,
    } : {}),
    ...(clientRolePolicy(role).canSeeBalance ? { oldBalance: record.oldBalance } : {}),
    notIntegrated: PROFILE_NOT_INTEGRATED.filter((part) => full || !ADDITIONAL_NOT_INTEGRATED.has(part)),
    // A pendência de um campo que não vem também não vem.
    issues: record.issues.filter((issue) => full || !ADDITIONAL_ISSUES.has(issue.field)).map((issue) => issue.message),
  };
}

/**
 * A ficha, ou null quando a linha não é cliente (404 CLIENT_NOT_FOUND, igual a um ID desconhecido) ou o perfil não lê.
 * `input` = { role, nowLocal, row, consultations, receipts, catalogos? }.
 */
function buildRealClientProfile(input) {
  if (!permissionsFor(input.role).canReadRealClients) return null;
  const record = readRealClientRow(input.row, input.catalogos);
  if (!record) return null;
  const today = localOperationalDateKey(input.nowLocal);
  const { items } = clientConsultations(record.id, input.consultations, input.nowLocal);
  return {
    today, client: projectProfile(record, input.role),
    current: items.find((item) => item.situation === 'em-curso' && item.operationalDate === today) ?? null,
    tarologists: tarologistsOf(items),
    // A v608 mostra os contadores das abas só à administradora; o servidor não os manda a mais ninguém.
    ...(input.role === 'administradora' ? { counts: { consultations: items.length, receipts: clientReceipts(record.id, input.receipts).length } } : {}),
  };
}

// --- as histórias ----------------------------------------------------------------------------------------

const CLIENT_HISTORY_PAGE_SIZE = 15;

/** O alcance que visibleClientHistory dá ao perfil, dito em voz alta, para a tela nunca mostrar o limite como total da cliente. */
function realClientHistoryScope(role, expanded) {
  if (role === 'atendente') return { kind: 'recent', limit: 10 };
  if (role === 'supervisora' && !expanded) return { kind: 'recent', limit: 20 };
  return { kind: 'complete' };
}

/** A página de um histórico como client-profile-history.tsx da v608: alcance limitado cabe numa página (10 ou 20); o completo tem páginas de 15. */
function realClientHistoryPageSize(scope) {
  return scope.kind === 'recent' ? scope.limit : CLIENT_HISTORY_PAGE_SIZE;
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

// --- a ampliação do histórico (R25) ----------------------------------------------------------------------

/** A ação da linha de gf_auditoria que é a liberação da supervisora ao histórico completo de uma cliente. */
const CLIENT_HISTORY_GRANT_ACTION = 'clients.history.expand';
const CLIENT_HISTORY_GRANT_ENTITY = 'cliente';

/**
 * O registro de uma ampliação, ou por que não há: só a supervisora amplia (canExpandRealClientHistory) e o motivo é
 * aparado de 1 a 500 caracteres por validateHistoryAccessReason da v608.
 * `context` = { clientId, actor: { accountId, role }, sessionId }.
 */
function planRealClientHistoryGrant(context, reason) {
  if (!permissionsFor(context.actor.role).canExpandRealClientHistory) return { denied: 'role' };
  let trimmed;
  try {
    trimmed = validateHistoryAccessReason(reason);
  } catch {
    return { denied: 'input' };
  }
  return {
    fact: {
      actorUserId: context.actor.accountId, actorRole: context.actor.role, action: CLIENT_HISTORY_GRANT_ACTION, entity: CLIENT_HISTORY_GRANT_ENTITY,
      entityId: context.clientId, after: { sessionId: context.sessionId }, reason: trimmed,
    },
  };
}

/**
 * Se uma linha guardada é liberação para esta leitura: ampliação da supervisora para a mesma cliente, pela mesma conta,
 * função e sessão. Não tem prazo próprio; o fim da sessão a encerra (R25). `entry` = { action, entity, entityId,
 * actorUserId, actorRole, after, reason }.
 */
function isRealClientHistoryGrantFor(entry, context) {
  const after = entry.after;
  return permissionsFor(context.actor.role).canExpandRealClientHistory
    && entry.action === CLIENT_HISTORY_GRANT_ACTION && entry.entity === CLIENT_HISTORY_GRANT_ENTITY && entry.entityId === context.clientId
    && entry.actorUserId === context.actor.accountId && entry.actorRole === context.actor.role
    && typeof after === 'object' && after !== null && after.sessionId === context.sessionId;
}

/** Se a linha guardada sob uma chave de operação é esta mesma ampliação repetida (mesma liberação) ou outra (409). */
function sameRealClientHistoryGrant(entry, fact) {
  const context = { clientId: fact.entityId, actor: { accountId: fact.actorUserId, role: fact.actorRole }, sessionId: fact.after.sessionId };
  return isRealClientHistoryGrantFor(entry, context) && entry.reason === fact.reason;
}

module.exports = {
  CATALOGOS_VAZIOS,
  CLIENT_HISTORY_GRANT_ACTION,
  CLIENT_HISTORY_PAGE_SIZE,
  CLIENT_ISSUES,
  buildRealClientConsultationHistory,
  buildRealClientList,
  buildRealClientProfile,
  buildRealClientReceiptHistory,
  clientListRange,
  consultingNow,
  filterAndSortClients,
  isRealClientHistoryGrantFor,
  projectProfile,
  movementsOf,
  planRealClientHistoryGrant,
  planRealClientList,
  readRealClientRow,
  realClientHistoryDates,
  realClientHistoryPageSize,
  realClientHistoryScope,
  realClientListPageInfo,
  realClientListSelection,
  realClientMatches,
  recordsOf,
  sameRealClientHistoryGrant,
  selectRealClientList,
};
