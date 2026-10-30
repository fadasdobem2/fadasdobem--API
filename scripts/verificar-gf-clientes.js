'use strict';

/**
 * Verificação OFFLINE de CLIENTES do módulo `src/gestao-fadas` (sem banco, sem rede, sem Express).
 *
 * Porta, para `node:assert`, as asserções de tests/real-clients-model.test.mjs do suspiro (B) contra
 * src/gestao-fadas/features/clientes/clientes.model.js, e o trecho de CLIENTES de tests/real-operations-permissions.test.mjs
 * (canReadRealClients / canExpandRealClientHistory; as demais flags desse arquivo são de Consultas/Pagamentos/Repasse e
 * não pertencem a esta feature). No fim, acrescenta verificações próprias da A: mapeamento papel -> perfil, lista branca de
 * colunas sem credencial e o TODO da gravação da ampliação.
 *
 *   node scripts/verificar-gf-clientes.js      (código 0 quando passa)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = path.join(__dirname, '..', 'src', 'gestao-fadas', 'features', 'clientes');
const model = require(path.join(base, 'clientes.model.js'));
const { readLegacyConsultation } = require(path.join(base, 'helpers', 'consultas.js'));
const { readLegacyPayment, buildRealReceiptsCut } = require(path.join(base, 'helpers', 'recebimentos.js'));
const { permissionsFor, perfilDeClientes, CONFIGURACAO_PERFIS } = require(path.join(base, 'helpers', 'perfis.js'));
const { PageOutOfRange } = require(path.join(base, 'helpers', 'valores.js'));

const legacy = { readLegacyConsultation, readLegacyPayment };
const receiptsModel = { buildRealReceiptsCut };
const page = { PageOutOfRange };
// No suspiro estes rótulos vêm do snapshot reference-catalogs.json; na A vêm das tabelas cpf_status e paises (injetados).
const CATALOGOS = { cpf_status: { 1: 'Regular' }, paises: { 1: 'Brasil' } };

let aprovados = 0;
const falhas = [];
const fila = [];
// Os testes rodam em sequência depois que o arquivo inteiro foi lido (como o node:test da B), aceitando funções assíncronas.
function test(nome, fn) {
  fila.push([nome, fn]);
}

const NOW = "2026-10-26T12:00:00", TODAY = "2026-10-26";
const ROLES = ["administradora", "assistente", "supervisora", "atendente", "tarologa"];
const INF = "tbl_pagtoinformado", CONF = "tbl_pagtoconfirmado", NL = "tbl_pagtonaolocalizado";
const catalogs = { channels: { "7": "WhatsApp" }, paymentOptions: { "1": "Pix" }, banks: { "5": "Banco X" } };

// A usuarios row as read-clients.sql reads it: every column of the R18 whitelist, with the defaults of the old DDL.
const user = (id, over = {}) => ({ id, nivel: 0, nome_id: `Ident ${id}`, nome2: "", nome: "", ddd: "", telresidencial: "", telcomercial: "", cel: null, whats: null,
  email: "", email2: "", cpf: "", status_cpf_id: 0, buscaNaReceita: "", datanascimento: "0000-00-00 00:00:00", horanascimento: "0000-00-00 00:00:00",
  cidadeNascimento: "", ufNascimento: "", IDpaisNascimento: 0, endereco: "", numero: "", complemento: "", bairro: "", cep: "", cidade: "", estado: "", idPais: 0,
  data_cadastro: "2026-01-10 15:00:00", saldo: "0.00", valorAPagar: "0.00", id_cliente_valido: 0, ...over });
let n = 1000;
const cons = (client, ini, over = {}) => legacy.readLegacyConsultation({ idConsulta: ++n, idUsuario: client, idTarologo: 27, nome_id: null, nmuTarologo: "Osíris",
  iniConsulta: ini, fimConsulta: ini, tmpConsulta: 20, valor_consulta: "30.00", idFormaConsulta: 7, idFormaPagto: 1, ...over }, catalogs);
const pay = (table, id, client, paid, over = {}) => legacy.readLegacyPayment({ idPagtoInformado: id, idUsuario: client, nome_id: null, vlPagtoInformado: "50.00",
  dtPagtoInformado: paid, dt_criado: "2026-10-26 15:00:00", idBanco: 5, idFormaPagto: 1, status: null, id_status_pagto: 2, ...over }, table, catalogs);
const src = (over = {}) => ({ informed: [], confirmed: [], notFound: [], ...over });

const plan = (role, query = {}) => {
  const result = model.planRealClientList(role, query, NOW);
  assert.ok(result.plan, `${role} ${JSON.stringify(query)} ${JSON.stringify(result)}`);
  return result.plan;
};
const denied = (role, query) => model.planRealClientList(role, query, NOW).denied;
// The reader brings the cut (or the search's candidates) first, and then the histories of the page's clients only.
const list = (role, query, sources, history) => {
  const full = { clients: [], consultations: [], receipts: src(), consultedClientIds: [], ...sources };
  const selection = model.selectRealClientList(plan(role, query), full);
  return model.buildRealClientList(selection, history ?? { consultations: full.consultations, receipts: full.receipts });
};
const ids = result => result.clients.map(client => client.id);
const moved = (...clients) => ({ clients: clients.map(id => typeof id === "object" ? id : user(id)), consultations: clients.map(id => cons(typeof id === "object" ? id.id : id, "2026-10-26 08:00:00")) });

test("canReadRealClients só para administradora, assistente, supervisora e atendente, sem mudar Consultas e Pagamentos", () => {
  assert.deepEqual(ROLES.map(role => permissionsFor(role).canReadRealClients), [true, true, true, true, false]);
  assert.equal(denied("tarologa", {}), "role");
});

test("recorte da administradora: Hoje por padrão, Ontem, 7 dias, uma data e um período até 366 dias", () => {
  const p = plan("administradora");
  assert.deepEqual([p.range, p.pageSize, p.page, p.sort, p.direction, p.scope, p.searching, p.today], [{ mode: "hoje", start: TODAY, end: TODAY }, 50, 1, "date", "desc", "daily", false, TODAY]);
  assert.deepEqual(plan("administradora", { mode: "ontem" }).range, { mode: "ontem", start: "2026-10-25", end: "2026-10-25" });
  assert.deepEqual(plan("administradora", { mode: "7dias" }).range, { mode: "7dias", start: "2026-10-20", end: TODAY });
  assert.deepEqual(plan("administradora", { mode: "data", start: "2026-03-02" }).range, { mode: "data", start: "2026-03-02", end: "2026-03-02" });
  assert.deepEqual(plan("administradora", { mode: "periodo", start: "2025-10-26", end: TODAY }).range, { mode: "periodo", start: "2025-10-26", end: TODAY });
  for (const query of [{ mode: "periodo", start: "2025-10-25", end: TODAY }, { mode: "periodo", start: "2026-10-02" }, { mode: "periodo", start: TODAY, end: "2026-10-01" },
    { mode: "data" }, { mode: "data", start: "2026-02-30" }, { mode: "data", start: "2026-03-02", end: "2026-03-03" }, { start: "2026-10-01" }, { mode: "hoje", end: TODAY },
    { pageSize: 25 }, { page: 0 }]) assert.equal(denied("administradora", query), "input", JSON.stringify(query));
  for (const size of [20, 30, 50]) assert.equal(plan("administradora", { pageSize: size }).pageSize, size);
});

test("assistente só nos 3 últimos dias e pelo ID exato; outro recorte ou outra busca é recusado com o motivo scope", () => {
  const p = plan("assistente");
  assert.deepEqual([p.range, p.pageSize, p.searching], [{ mode: "3dias", start: "2026-10-24", end: TODAY }, 30, false]);
  for (const query of [{ mode: "hoje" }, { mode: "7dias" }, { start: "2026-10-01" }, { end: TODAY }, { q: "Marina" }, { name: "Marina" }, { phone: "33334444" },
    { email: "m@ex.com" }, { birthDate: "15/03" }]) assert.equal(denied("assistente", query), "scope", JSON.stringify(query));
  assert.equal(plan("assistente", { id: "21" }).searching, true);
  // A blank field is no search, as hasClientSearch reads it in the v608.
  assert.equal(plan("assistente", { q: "  " }).searching, false);
  assert.equal(plan("assistente", { balance: "credito", sort: "balance" }).balance, "credito");
});

test("supervisora em Hoje e Ontem, atendente só em Hoje, as duas com a busca da administradora e sem saldo", () => {
  const sup = plan("supervisora"), att = plan("atendente");
  assert.deepEqual([sup.range, sup.pageSize], [{ mode: "hoje", start: TODAY, end: TODAY }, 30]);
  assert.deepEqual([att.range, att.pageSize], [{ mode: "hoje", start: TODAY, end: TODAY }, 20]);
  assert.deepEqual(plan("supervisora", { mode: "ontem" }).range, { mode: "ontem", start: "2026-10-25", end: "2026-10-25" });
  assert.deepEqual(plan("atendente", { mode: "hoje" }).range.start, TODAY);
  for (const query of [{ mode: "7dias" }, { mode: "data", start: TODAY }, { mode: "periodo", start: "2026-10-20", end: TODAY }, { start: TODAY },
    { balance: "todos" }, { balance: "credito" }, { sort: "balance" }]) assert.equal(denied("supervisora", query), "scope", `sup ${JSON.stringify(query)}`);
  for (const query of [{ mode: "ontem" }, { mode: "7dias" }, { start: TODAY }, { balance: "debito" }, { sort: "balance", direction: "asc" }]) {
    assert.equal(denied("atendente", query), "scope", `att ${JSON.stringify(query)}`);
  }
  for (const role of ["supervisora", "atendente"]) {
    const p = plan(role, { q: "Marina", name: "Mari", phone: "3333", email: "m@", birthDate: "15/03", id: "21", pageSize: 50 });
    assert.deepEqual([p.searching, p.pageSize, p.search], [true, 50, { query: "Marina", id: "21", name: "Mari", phone: "3333", email: "m@", birthDate: "15/03" }]);
  }
});

test("lista: consulta iniciada no dia operacional ou recebimento pago nele, nas três origens; ID sem cadastro e conta da equipe ficam fora", () => {
  const sources = {
    clients: [user(1), user(2), user(3), user(4), user(5), user(6, { nivel: 1 }), user(7, { nivel: null }), user(8), user(9, { nivel: 99 })],
    consultations: [cons(1, "2026-10-26 07:00:00"), cons(2, "2026-10-26 05:30:00"), cons(6, "2026-10-26 08:00:00"), cons(7, "2026-10-26 08:00:00"), cons(99, "2026-10-26 09:00:00")],
    receipts: src({ informed: [pay(INF, 11, 3, "2026-10-26 00:00:00"), pay(INF, 15, 9, "2026-10-26 00:00:00")], confirmed: [pay(CONF, 12, 4, "2026-10-26 00:00:00")],
      notFound: [pay(NL, 13, 5, "2026-10-26 00:00:00"), pay(NL, 14, 8, "2026-10-25 00:00:00"), pay(NL, 16, 98, "2026-10-26 00:00:00")] }),
  };
  const today = list("administradora", {}, sources);
  assert.deepEqual(ids(today), ["1", "5", "4", "3"]);
  assert.deepEqual([today.searching, today.page, today.range], [false, { number: 1, size: 50, totalItems: 4 }, { mode: "hoje", start: TODAY, end: TODAY }]);
  assert.equal(today.clients[0].latestActivityLocal, "2026-10-26T07:00:00");
  assert.equal(today.clients[1].latestActivityLocal, "2026-10-26T00:00:00");
  // 05h30 belongs to the operational day before, a receipt to its civil paid day.
  assert.deepEqual(ids(list("administradora", { mode: "ontem" }, sources)), ["2", "8"]);
  assert.deepEqual(ids(list("administradora", { mode: "7dias" }, sources)), ["1", "2", "5", "4", "3", "8"]);
  assert.deepEqual(ids(list("assistente", {}, sources)), ["1", "2", "5", "4", "3", "8"]);
  assert.deepEqual(ids(list("supervisora", { mode: "ontem" }, sources)), ["2", "8"]);
});

test("busca combinada da v608, fora do recorte: nome, telefone pelos dígitos com e sem DDD, celular, WhatsApp, e-mail e nascimento", () => {
  const marina = user(21, { nome_id: "Marina", nome2: "Mari", nome: "Marina Souza Lima", ddd: "11", telresidencial: "3333-4444", telcomercial: "5555-6666",
    cel: "98888-7777", whats: "+55 (21) 97777-1111", email: "marina@ex.com", email2: "m2@ex.com", datanascimento: "1990-03-15 00:00:00" });
  const sources = { clients: [marina, user(22, { nome_id: "Joana", nome: "Joana Lima" })], consultations: [cons(21, "2025-05-01 10:00:00")] };
  const find = (query, role = "administradora") => ids(list(role, query, sources));
  for (const query of [{ q: "souza" }, { q: "MARÍNA" }, { q: "33334444" }, { q: "1133334444" }, { phone: "55556666" }, { phone: "98888-7777" }, { phone: "11988887777" },
    { q: "21977771111" }, { email: "M2@EX" }, { q: "marina@ex" }, { birthDate: "15/03" }, { q: "15/03/1990" }, { name: "lima", phone: "33334444" }, { id: "21" }]) {
    assert.deepEqual(find(query), ["21"], JSON.stringify(query));
  }
  for (const query of [{ birthDate: "15/03/1991" }, { name: "lima", phone: "99999999" }, { q: "2" }, { phone: "3333" }]) assert.deepEqual(find(query), [], JSON.stringify(query));
  assert.deepEqual(find({ name: "lima" }), ["21", "22"]);
  for (const role of ["supervisora", "atendente"]) assert.deepEqual(find({ q: "souza" }, role), ["21"], role);
  assert.deepEqual(find({ id: "21" }, "assistente"), ["21"]);
  assert.deepEqual(find({ id: "2" }, "assistente"), []);
  const found = list("administradora", { q: "souza" }, sources);
  // The search reads the last movement of the whole history, and sends no date counts.
  assert.deepEqual([found.searching, found.clients[0].latestActivityLocal, "dateCounts" in found], [true, "2025-05-01T10:00:00", false]);
});

test("situação em consulta (em curso hoje) e nunca consultou (nenhuma consulta no legado); Em consulta agora sobre o recorte", () => {
  const sources = {
    clients: [user(31), user(32), user(33), user(34)],
    consultations: [cons(31, "2026-10-26 10:00:00", { fimConsulta: null }), cons(34, "2026-10-25 10:00:00", { fimConsulta: null })],
    receipts: src({ informed: [pay(INF, 41, 32, "2026-10-26 00:00:00"), pay(INF, 42, 33, "2026-10-26 00:00:00")] }),
    consultedClientIds: ["31", "32", "34"],
  };
  const all = list("administradora", {}, sources);
  assert.deepEqual(all.clients.map(c => [c.id, c.inConsultationNow]), [["31", true], ["33", false], ["32", false]]);
  assert.deepEqual(ids(list("administradora", { situation: "consulta" }, sources)), ["31"]);
  assert.deepEqual(ids(list("administradora", { situation: "nunca" }, sources)), ["33"]);
  assert.deepEqual(ids(list("administradora", { scope: "live" }, sources)), ["31"]);
  // Open since yesterday is no consultation now.
  assert.deepEqual(list("administradora", { mode: "ontem" }, sources).clients.map(c => [c.id, c.inConsultationNow]), [["34", false]]);
  assert.deepEqual(ids(list("administradora", { mode: "ontem", scope: "live" }, sources)), []);
});

test("saldo do sistema antigo: saldo menos valorAPagar em centavos; com saldo, em débito e zerado, sem o não informado; só para administradora e assistente", () => {
  const sources = moved(user(41, { saldo: "50.00", valorAPagar: "20.10" }), user(42, { saldo: "10.00", valorAPagar: "10.00" }), user(43, { saldo: "0.00", valorAPagar: "15.50" }),
    user(44, { saldo: null }), user(45, { valorAPagar: null }), user(46, { saldo: "0.10", valorAPagar: "0.20" }));
  const all = list("administradora", { sort: "id", direction: "asc" }, sources);
  assert.deepEqual(all.clients.map(c => c.oldBalance), ["29.90", "0.00", "-15.50", null, null, "-0.10"]);
  assert.deepEqual(ids(list("administradora", { balance: "credito" }, sources)), ["41"]);
  assert.deepEqual(ids(list("administradora", { balance: "debito" }, sources)), ["46", "43"]);
  assert.deepEqual(ids(list("administradora", { balance: "zerado" }, sources)), ["42"]);
  assert.deepEqual(ids(list("assistente", { balance: "debito" }, sources)), ["46", "43"]);
  for (const role of ["supervisora", "atendente"]) {
    const limited = list(role, {}, sources);
    assert.equal(limited.page.totalItems, 6);
    assert.ok(limited.clients.every(c => !("oldBalance" in c)), role);
  }
});

test("ordenação por data, ID, nome e saldo nos dois sentidos, como a v608, com o saldo não informado no fim", () => {
  const sources = {
    clients: [user(51, { nome: "Zélia", saldo: "5.00" }), user(52, { nome: "ana", saldo: "0.00", valorAPagar: "3.00" }), user(53, { nome_id: "", saldo: null }), user(54, { nome: "Bruno" })],
    consultations: [cons(51, "2026-10-26 08:00:00"), cons(52, "2026-10-26 10:00:00"), cons(53, "2026-10-26 09:00:00"), cons(54, "2026-10-26 07:00:00")],
  };
  const order = query => ids(list("administradora", query, sources));
  assert.deepEqual(order({}), ["52", "53", "51", "54"]);
  assert.deepEqual(order({ direction: "asc" }), ["54", "51", "53", "52"]);
  assert.deepEqual(order({ sort: "id", direction: "asc" }), ["51", "52", "53", "54"]);
  assert.deepEqual(order({ sort: "id" }), ["54", "53", "52", "51"]);
  // The v608 sorts by the full name, else the identification name, else "Cliente {id}".
  assert.deepEqual(order({ sort: "name", direction: "asc" }), ["52", "54", "53", "51"]);
  assert.deepEqual(order({ sort: "name" }), ["51", "53", "54", "52"]);
  assert.deepEqual(order({ sort: "balance", direction: "asc" }), ["52", "54", "51", "53"]);
  assert.deepEqual(order({ sort: "balance" }), ["51", "54", "52", "53"]);
});

test("páginas de 20, 30 e 50 com o total do recorte inteiro; página além da última é recusada", () => {
  const sources = moved(...Array.from({ length: 65 }, (_, i) => 200 + i));
  const first = list("administradora", {}, sources), second = list("administradora", { page: 2 }, sources);
  assert.deepEqual([first.clients.length, first.page, second.clients.length, second.page.totalItems], [50, { number: 1, size: 50, totalItems: 65 }, 15, 65]);
  assert.equal(new Set([...ids(first), ...ids(second)]).size, 65);
  assert.throws(() => list("administradora", { page: 3 }, sources), page.PageOutOfRange);
  assert.equal(list("administradora", { pageSize: 20, page: 4 }, sources).clients.length, 5);
  assert.equal(list("administradora", { pageSize: 30, page: 3 }, sources).clients.length, 5);
  assert.deepEqual(list("atendente", {}, sources).page, { number: 1, size: 20, totalItems: 65 });
  assert.deepEqual(list("supervisora", {}, sources).page, { number: 1, size: 30, totalItems: 65 });
  // An empty list still has its first page.
  assert.deepEqual(list("administradora", {}, {}).page, { number: 1, size: 50, totalItems: 0 });
});

test("dateCounts só da administradora e fora da busca; notIntegrated com os filtros, escopos e ordenações sem fonte", () => {
  const sources = {
    clients: [user(61), user(62), user(63), user(64)],
    consultations: [cons(61, "2026-10-26 08:00:00"), cons(62, "2026-10-25 08:00:00"), cons(63, "2026-10-20 08:00:00"), cons(64, "2026-10-19 08:00:00"), cons(99, "2026-10-26 09:00:00")],
    receipts: src({ informed: [pay(INF, 71, 61, "2026-10-25 00:00:00")] }),
  };
  assert.deepEqual(list("administradora", {}, sources).dateCounts, { hoje: 1, ontem: 2, "7dias": 3 });
  assert.deepEqual(list("administradora", { mode: "data", start: "2026-03-02" }, sources).dateCounts, { hoje: 1, ontem: 2, "7dias": 3 });
  assert.equal("dateCounts" in list("administradora", { q: "Ident" }, sources), false);
  for (const role of ["assistente", "supervisora", "atendente"]) assert.equal("dateCounts" in list(role, {}, sources), false, role);
  assert.deepEqual(list("atendente", {}, sources).notIntegrated, { filters: ["regime", "aguarda"], sorts: ["credit"], scopes: ["paid", "new", "first", "general", "scheduled"] });
});

test("última consulta e último pagamento de toda a história, lidos para a página, com o par informado e confirmado uma vez só", () => {
  const current = cons(81, "2026-10-26 08:00:00");
  const history = {
    consultations: [current, cons(81, "2026-09-01 10:00:00"), cons(81, "2026-10-26 09:30:00", { fimConsulta: null, valor_consulta: "0.00" })],
    receipts: src({ informed: [pay(INF, 91, 81, "2026-10-20 00:00:00"), pay(INF, 92, 81, "0000-00-00 00:00:00")], confirmed: [pay(CONF, 91, 81, "2026-10-20 00:00:00"), pay(CONF, 93, 81, "2026-10-18 00:00:00")] }),
  };
  const result = list("administradora", {}, { clients: [user(81), user(82)], consultations: [current, cons(82, "2026-10-26 07:00:00")] }, history);
  const [a, b] = result.clients;
  assert.deepEqual(a.lastConsultation, { id: history.consultations[2].id, startedAtLocal: "2026-10-26T09:30:00", tarotName: "Osíris", situation: "em-curso" });
  assert.deepEqual(a.lastReceipt, { key: "tbl_pagtoinformado:91", paidOn: "2026-10-20", amount: "50.00", situation: "confirmado" });
  assert.deepEqual([b.id, b.lastConsultation, b.lastReceipt], ["82", null, null]);
  assert.deepEqual([a.modality, a.linkedValidId, a.name, a.nameMissing, a.treatAs, a.fullName], [null, null, "Ident 81", false, null, null]);
});

const profileOf = (role, row, consultations = [], receipts = src()) => model.buildRealClientProfile({ role, nowLocal: NOW, row, consultations, receipts, catalogos: CATALOGOS });
const FULL = user(101, { nome_id: "  ", nome2: "Lu", nome: "Luíza Prado", ddd: "11", telresidencial: "3333-4444", telcomercial: "", cel: "98888-7777", whats: "21977771111",
  email: "lu@ex.com", email2: "lu2@ex.com", cpf: "01234567890", status_cpf_id: 1, buscaNaReceita: "Regular<br />Nome: <b>LUIZA</b><BR>fim",
  datanascimento: "1985-07-04 00:00:00", horanascimento: "1900-01-01 14:35:00", cidadeNascimento: "Niterói", ufNascimento: "RJ", IDpaisNascimento: 1,
  endereco: "Rua A", numero: "10", complemento: "", bairro: "Centro", cep: "24000-000", cidade: "Niterói", estado: "RJ", idPais: 999,
  data_cadastro: "2026-01-10 02:30:00", saldo: "100.00", valorAPagar: "35.55", id_cliente_valido: 102, senha: "segredo-antigo", login: "luiza.login" });

test("ficha: nome vazio como pendência, telefones e CPF como texto, resultado do CPF sem marcação, catálogos, cadastro em São Paulo e saldo antigo", () => {
  const { client } = profileOf("administradora", FULL);
  assert.deepEqual([client.id, client.name, client.nameMissing, client.treatAs, client.fullName], ["101", null, true, "Lu", "Luíza Prado"]);
  assert.deepEqual(client.phones, { home: { ddd: "11", number: "3333-4444" }, work: null, mobile: { ddd: "11", number: "98888-7777" } });
  assert.deepEqual([client.whatsapp, client.email, client.email2, client.cpf], ["21977771111", "lu@ex.com", "lu2@ex.com", "01234567890"]);
  assert.equal(client.cpfResult, "Regular\nNome: <b>LUIZA</b>\nfim");
  assert.deepEqual(client.cpfStatus, { code: "1", label: "Regular" });
  assert.deepEqual(client.birthCountry, { code: "1", label: "Brasil" });
  assert.deepEqual(client.address, { street: "Rua A", number: "10", complement: null, district: "Centro", zip: "24000-000", city: "Niterói", state: "RJ", country: { code: "999", label: null } });
  assert.deepEqual([client.birthDate, client.birthTime, client.birthCity, client.birthState], ["1985-07-04", "14:35", "Niterói", "RJ"]);
  assert.equal(client.createdAtLocal, "2026-01-09T23:30:00");
  assert.deepEqual(client.oldBalance, { credit: "100.00", toPay: "35.55", balance: "64.45" });
  assert.equal(client.linkedValidId, "102");
  assert.deepEqual(client.issues, []);
  const text = JSON.stringify(profileOf("administradora", FULL));
  assert.ok(!text.includes("segredo-antigo") && !text.includes("luiza.login"), "senha e login nunca saem");
  assert.ok(client.notIntegrated.includes("login") && client.notIntegrated.includes("modality") && client.notIntegrated.includes("notes"));
});

test("ficha: nascimento zero-date, inválido ou 00:00 como não informado com o motivo; saldo não informado com uma coluna nula; conta da equipe não é cliente", () => {
  const zero = profileOf("administradora", user(103, { datanascimento: "0000-00-00 00:00:00", horanascimento: "1900-01-01 00:00:00", data_cadastro: "0000-00-00 00:00:00" })).client;
  assert.deepEqual([zero.birthDate, zero.birthTime, zero.createdAtLocal], [null, null, null]);
  assert.deepEqual(zero.issues, [model.CLIENT_ISSUES.birthDateZero, model.CLIENT_ISSUES.birthTimeMissing, model.CLIENT_ISSUES.createdAtMissing]);
  const invalid = profileOf("administradora", user(104, { datanascimento: "1985-02-30 00:00:00", horanascimento: "0000-00-00 00:00:00" })).client;
  assert.deepEqual([invalid.birthDate, invalid.birthTime, invalid.issues], [null, null, [model.CLIENT_ISSUES.birthDateInvalid, model.CLIENT_ISSUES.birthTimeMissing]]);
  assert.deepEqual(profileOf("administradora", user(105, { saldo: null, valorAPagar: "3.00" })).client.oldBalance, { credit: null, toPay: "3.00", balance: null });
  assert.deepEqual(profileOf("assistente", user(106, { valorAPagar: null })).client.oldBalance, { credit: "0.00", toPay: null, balance: null });
  for (const nivel of [1, 2, 99, null, "x"]) assert.equal(profileOf("administradora", user(107, { nivel })), null, String(nivel));
  assert.equal(profileOf("tarologa", user(108)), null);
});

test("ficha por perfil: supervisora e atendente sem saldo nem Dados adicionais, que não saem nem como null; contadores só da administradora", () => {
  const history = [cons(101, "2026-10-20 10:00:00"), cons(101, "2026-10-21 10:00:00"), cons(102, "2026-10-22 10:00:00")];
  const receipts = src({ informed: [pay(INF, 301, 101, "2026-10-20 00:00:00"), pay(INF, 302, 101, "0000-00-00 00:00:00"), pay(INF, 303, 102, "2026-10-20 00:00:00")] });
  const admin = profileOf("administradora", FULL, history, receipts);
  // The link opens the other cadastro; the two histories are never joined.
  assert.deepEqual(admin.counts, { consultations: 2, receipts: 2 });
  assert.equal(admin.today, TODAY);
  assert.equal("counts" in profileOf("assistente", FULL, history, receipts), false);
  assert.ok("oldBalance" in profileOf("assistente", FULL).client && "address" in profileOf("assistente", FULL).client);
  const hidden = ["oldBalance", "email2", "birthTime", "birthCity", "birthState", "birthCountry", "cpfStatus", "cpfResult", "address"];
  for (const role of ["supervisora", "atendente"]) {
    const result = profileOf(role, user(109, { horanascimento: "0000-00-00 00:00:00", datanascimento: "1985-07-04 00:00:00", ddd: "11", telresidencial: "3333-4444", telcomercial: "5555-6666", cel: "9" }), history, receipts);
    assert.equal("counts" in result, false, role);
    for (const key of hidden) assert.equal(key in result.client, false, `${role} ${key}`);
    assert.deepEqual(result.client.phones, { home: { ddd: "11", number: "3333-4444" } }, role);
    assert.deepEqual(result.client.issues, [], `${role}: the issue of a hidden field stays hidden`);
    assert.ok(!result.client.notIntegrated.includes("login") && !result.client.notIntegrated.includes("password"), role);
    assert.deepEqual([result.client.birthDate, result.client.cpf, result.client.email], ["1985-07-04", null, null]);
    assert.deepEqual(result.tarologists, profileOf("administradora", user(109), history, receipts).tarologists);
  }
});

test("ficha: consulta em curso de hoje e guia Tarólogos do histórico inteiro do par", () => {
  const rows = [cons(110, "2026-10-26 11:00:00", { fimConsulta: null, valor_consulta: "0.00" }), cons(110, "2026-10-01 10:00:00", { tmpConsulta: 30 }),
    cons(110, "2026-09-01 10:00:00", { idTarologo: 28, nmuTarologo: "Íris", tmpConsulta: 15 }), cons(110, "2026-10-25 23:00:00", { fimConsulta: null }), cons(110, "2026-10-02 10:00:00", { idTarologo: null })];
  const result = profileOf("atendente", user(110), rows);
  assert.deepEqual([result.current.id, result.current.situation, result.current.amountState, result.current.recordedAmount], [rows[0].id, "em-curso", "em-andamento", null]);
  assert.deepEqual(result.tarologists, [
    { tarotId: "27", tarotName: "Osíris", consultations: 3, recordedMinutes: 30, lastStartedAtLocal: "2026-10-26T11:00:00" },
    { tarotId: "28", tarotName: "Íris", consultations: 1, recordedMinutes: 15, lastStartedAtLocal: "2026-09-01T10:00:00" },
  ]);
  assert.equal(profileOf("administradora", user(111)).current, null);
});

// 25 consultations of client 120, one a day from 2026-09-01, alternating readers 27 and 28; the newest is open.
const longHistory = Array.from({ length: 25 }, (_, i) => cons(120, `2026-09-${String(i + 1).padStart(2, "0")} 10:00:00`, {
  idTarologo: i % 2 ? 28 : 27, nmuTarologo: i % 2 ? "Aurora" : "Osíris", tmpConsulta: 10 + i, valor_consulta: `${10 + i}.00`,
  ...(i === 24 ? { fimConsulta: null, valor_consulta: "0.00" } : {}) }));
const consultationsOf = (role, query = {}, expanded = false, rows = longHistory) =>
  model.buildRealClientConsultationHistory({ role, expanded, nowLocal: NOW, clientId: "120", rows, query: { page: 1, ...query } });
const newest = k => longHistory.slice(-k).reverse().map(c => c.id);

test("histórico de consultas: alcance da v608 por perfil antes da busca, da ordenação e das páginas de 15, com historyScope", () => {
  const admin = consultationsOf("administradora");
  assert.deepEqual([admin.historyScope, admin.page, admin.items.length], [{ kind: "complete" }, { number: 1, size: 15, totalItems: 25 }, 15]);
  assert.deepEqual(admin.items.map(c => c.id), newest(15));
  assert.equal(consultationsOf("administradora", { page: 2 }).items.length, 10);
  assert.throws(() => consultationsOf("administradora", { page: 3 }), page.PageOutOfRange);
  assert.deepEqual(consultationsOf("assistente").historyScope, { kind: "complete" });
  const att = consultationsOf("atendente"), sup = consultationsOf("supervisora");
  assert.deepEqual([att.historyScope, att.page.totalItems, att.items.map(c => c.id)], [{ kind: "recent", limit: 10 }, 10, newest(10)]);
  assert.deepEqual([sup.historyScope, sup.page.totalItems], [{ kind: "recent", limit: 20 }, 20]);
  assert.deepEqual([consultationsOf("supervisora", {}, true).historyScope, consultationsOf("supervisora", {}, true).page.totalItems], [{ kind: "complete" }, 25]);
  // The oldest consultation is out of the attendant's ten: the search does not reach it, and "oldest" starts at the tenth.
  assert.deepEqual(consultationsOf("administradora", { q: longHistory[0].id }).items.map(c => c.id), [longHistory[0].id]);
  assert.deepEqual(consultationsOf("atendente", { q: longHistory[0].id }).items, []);
  assert.equal(consultationsOf("atendente", { sort: "oldest" }).items[0].id, longHistory[15].id);
  assert.equal(consultationsOf("administradora", { sort: "oldest" }).items[0].id, longHistory[0].id);
  // totals cover only the scope, in the format of the Consultas list (D10: the open one is out of the sum).
  assert.deepEqual(att.totals, { inProgress: 1, openSinceEarlier: 0, finished: 9, recordedAmount: "261.00", recordedMinutes: 261, missingAmount: 0, missingMinutes: 0 });
  assert.equal(admin.totals.finished, 24);
  const open = att.items[0];
  assert.deepEqual([open.situation, open.amountState, open.recordedAmount], ["em-curso", "em-andamento", null]);
  // The expanded list of a reader comes from the scope only.
  assert.deepEqual(consultationsOf("atendente", { tarotId: "28" }).items.map(c => c.tarotId), ["28", "28", "28", "28", "28"]);
  assert.equal(consultationsOf("administradora", { tarotId: "28" }).page.totalItems, 12);
  assert.deepEqual(consultationsOf("tarologa").items, []);
});

test("histórico de consultas: busca e ordenação de searchAndSortClientHistory sobre os modelos reais", () => {
  assert.equal(consultationsOf("administradora", { q: "AURÓRA" }).page.totalItems, 12);
  assert.equal(consultationsOf("administradora", { q: "em consulta" }).page.totalItems, 1);
  assert.equal(consultationsOf("administradora", { q: "whatsapp" }).page.totalItems, 25);
  assert.equal(consultationsOf("administradora", { q: "pix" }).page.totalItems, 25);
  assert.deepEqual(consultationsOf("administradora", { sort: "amount", direction: "desc" }).items.slice(0, 2).map(c => c.recordedAmount), ["33.00", "32.00"]);
  assert.deepEqual(consultationsOf("administradora", { sort: "duration", direction: "asc" }).items[0].recordedMinutes, 10);
  assert.equal(consultationsOf("administradora", { sort: "name", direction: "asc" }).items[0].tarotName, "Aurora");
  // Another client's row, if one ever came along, is not this client's history.
  assert.equal(consultationsOf("administradora", {}, false, [...longHistory, cons(121, "2026-10-26 08:00:00")]).page.totalItems, 25);
});

const receiptsOf = (role, sources, query = {}, expanded = false) =>
  model.buildRealClientReceiptHistory({ role, expanded, clientId: "130", sources, query: { page: 1, ...query } });

test("histórico de pagamentos: R5 revista com os gêmeos pelo ID, operação informada e confirmada uma vez, sem data paga fora do summary", () => {
  const sources = src({
    informed: [pay(INF, 401, 130, "2026-10-20 00:00:00"), pay(INF, 402, 130, "2026-10-21 00:00:00", { id_status_pagto: 1 }), pay(INF, 403, 130, "0000-00-00 00:00:00"),
      pay(INF, 404, 130, "2026-10-22 00:00:00")],
    // 401 is the same operation; 404's twin belongs to another client, so both are conferir a origem and each stays with its client.
    confirmed: [pay(CONF, 401, 130, "2026-10-20 00:00:00"), pay(CONF, 404, 131, "2026-10-22 00:00:00"), pay(CONF, 405, 130, "2026-10-19 00:00:00", { vlPagtoInformado: "7.25" })],
    notFound: [pay(NL, 406, 130, "2026-10-18 00:00:00")],
  });
  const result = receiptsOf("administradora", sources);
  assert.deepEqual(result.historyScope, { kind: "complete" });
  assert.deepEqual(result.items.map(r => [r.key, r.situation, r.origins.length, r.paidOn]), [
    ["tbl_pagtoinformado:404", "conferir-origem", 1, "2026-10-22"], ["tbl_pagtoinformado:402", "informado", 1, "2026-10-21"],
    ["tbl_pagtoinformado:401", "confirmado", 2, "2026-10-20"], ["tbl_pagtoconfirmado:405", "confirmado", 1, "2026-10-19"],
    ["tbl_pagtonaolocalizado:406", "nao-localizado", 1, "2026-10-18"], ["tbl_pagtoinformado:403", "confirmado", 1, null],
  ]);
  assert.deepEqual(result.summary, { confirmedTotal: "57.25", informedTotal: "50.00", counts: { confirmado: 2, informado: 1, "nao-localizado": 1, "conferir-origem": 1 } });
  const cut = receiptsModel.buildRealReceiptsCut({ ...sources, range: { start: "2026-10-01", end: "2026-10-31" }, by: "paid" });
  assert.deepEqual(Object.keys(result.summary), Object.keys(cut.summary));
  assert.deepEqual(result.page, { number: 1, size: 15, totalItems: 6 });
  assert.deepEqual(receiptsOf("administradora", sources, { q: "Confirmado nº 401" }).items.map(r => r.key), ["tbl_pagtoinformado:401"]);
  assert.deepEqual(receiptsOf("administradora", sources, { q: "conferir" }).items.map(r => r.key), ["tbl_pagtoinformado:404"]);
  assert.equal(receiptsOf("administradora", sources, { q: "banco x" }).page.totalItems, 6);
  assert.deepEqual(receiptsOf("administradora", sources, { sort: "amount", direction: "asc" }).items[0].key, "tbl_pagtoconfirmado:405");
  // A missing paid date goes last in both directions, as a missing value in the v608.
  assert.equal(receiptsOf("administradora", sources, { sort: "oldest" }).items.at(-1).key, "tbl_pagtoinformado:403");
  assert.equal(receiptsOf("administradora", sources, { sort: "oldest" }).items[0].key, "tbl_pagtonaolocalizado:406");
});

test("histórico de pagamentos: as últimas 10 da atendente e 20 da supervisora, contando a operação conciliada uma vez, com o summary do alcance", () => {
  const informed = Array.from({ length: 22 }, (_, i) => pay(INF, 500 + i, 130, `2026-09-${String(i + 1).padStart(2, "0")} 00:00:00`, { vlPagtoInformado: "10.00" }));
  const sources = src({ informed: [...informed, pay(INF, 600, 130, "0000-00-00 00:00:00")], confirmed: informed.map(row => pay(CONF, Number(row.sourceId), 130, row.paidAtLocal.replace("T", " "), { vlPagtoInformado: "10.00" })) });
  const att = receiptsOf("atendente", sources), sup = receiptsOf("supervisora", sources), all = receiptsOf("supervisora", sources, {}, true);
  assert.deepEqual([att.historyScope, att.page.totalItems, att.items[0].paidOn, att.summary.confirmedTotal], [{ kind: "recent", limit: 10 }, 10, "2026-09-22", "100.00"]);
  assert.deepEqual([sup.historyScope, sup.page.totalItems, sup.summary.counts.confirmado], [{ kind: "recent", limit: 20 }, 20, 20]);
  assert.deepEqual([all.historyScope, all.page.totalItems, all.items.at(-1)?.paidOn], [{ kind: "complete" }, 23, "2026-09-08"]);
  assert.equal(receiptsOf("administradora", sources, { page: 2 }).items.at(-1).paidOn, null);
  assert.ok(att.items.every(r => r.origins.length === 2));
});

test("histórico: a página da v608 por perfil, as 10 da atendente e as 20 da supervisora numa página só, e 15 no histórico completo", () => {
  // client-profile-history.tsx: pageSize = limited ? (atendente ? 10 : 20) : 15, sobre o alcance de visibleClientHistory.
  const sup = consultationsOf("supervisora"), att = consultationsOf("atendente");
  assert.deepEqual([sup.page, sup.items.map(c => c.id)], [{ number: 1, size: 20, totalItems: 20 }, newest(20)]);
  assert.throws(() => consultationsOf("supervisora", { page: 2 }), page.PageOutOfRange);
  assert.deepEqual(att.page, { number: 1, size: 10, totalItems: 10 });
  assert.deepEqual(consultationsOf("supervisora", {}, true).page, { number: 1, size: 15, totalItems: 25 });
  const informed = Array.from({ length: 22 }, (_, i) => pay(INF, 700 + i, 130, `2026-09-${String(i + 1).padStart(2, "0")} 00:00:00`));
  const sources = src({ informed });
  assert.deepEqual([receiptsOf("supervisora", sources).page, receiptsOf("supervisora", sources).items.length], [{ number: 1, size: 20, totalItems: 20 }, 20]);
  assert.deepEqual(receiptsOf("atendente", sources).page, { number: 1, size: 10, totalItems: 10 });
  assert.deepEqual(receiptsOf("administradora", sources).page, { number: 1, size: 15, totalItems: 22 });
});

// The date filter of client-profile-history.tsx (v608): "Todas as datas" by default, Hoje, Ontem, 7 dias, Data and Período,
// resolved on the server's clock (T097).
const datesOf = query => model.realClientHistoryDates(query, NOW);
const rangeOf = query => {
  const result = datesOf(query);
  assert.ok("range" in result, `${JSON.stringify(query)} ${JSON.stringify(result)}`);
  return result.range;
};

test("recorte de datas do histórico: Tudo por padrão, Hoje, Ontem, 7 dias, Data e Período como a v608, com a combinação que a tela não monta recusada", () => {
  assert.deepEqual(datesOf({}), { range: null });
  assert.deepEqual(datesOf({ mode: "tudo" }), { range: null });
  assert.deepEqual(rangeOf({ mode: "hoje" }), { start: TODAY, end: TODAY });
  assert.deepEqual(rangeOf({ mode: "ontem" }), { start: "2026-10-25", end: "2026-10-25" });
  assert.deepEqual(rangeOf({ mode: "7dias" }), { start: "2026-10-20", end: TODAY });
  // Hoje is the operational day: at 03:00 it is still the day before.
  assert.deepEqual(model.realClientHistoryDates({ mode: "hoje" }, "2026-10-26T03:00:00"), { range: { start: "2026-10-25", end: "2026-10-25" } });
  assert.deepEqual(rangeOf({ mode: "data", start: "2026-09-03" }), { start: "2026-09-03", end: "2026-09-03" });
  assert.deepEqual(rangeOf({ mode: "data", start: "2026-09-03", end: "2026-09-03" }), { start: "2026-09-03", end: "2026-09-03" });
  // A period typed backwards is put in order, as resolveHistoryDateRange does; it has no 366-day limit, since Tudo is open.
  assert.deepEqual(rangeOf({ mode: "periodo", start: "2026-09-10", end: "2026-09-01" }), { start: "2026-09-01", end: "2026-09-10" });
  assert.deepEqual(rangeOf({ mode: "periodo", start: "2020-01-01", end: TODAY }), { start: "2020-01-01", end: TODAY });
  for (const query of [{ mode: "data" }, { mode: "data", start: "2026-09-03", end: "2026-09-04" }, { mode: "data", start: "2026-02-30" },
    { mode: "periodo", start: "2026-09-03" }, { mode: "periodo", end: "2026-09-03" }, { mode: "periodo", start: "2026-09-01", end: "2026-13-01" },
    { mode: "hoje", start: TODAY }, { mode: "7dias", end: TODAY }, { mode: "tudo", start: TODAY }, { start: TODAY }]) {
    assert.deepEqual(datesOf(query), { denied: "input" }, JSON.stringify(query));
  }
});

test("histórico de consultas: o recorte de datas pelo dia operacional do início, dentro do alcance do perfil e antes da busca e das páginas", () => {
  const admin = consultationsOf("administradora");
  assert.deepEqual(consultationsOf("administradora", { range: rangeOf({ mode: "data", start: "2026-09-03" }) }).items.map(c => c.id), [longHistory[2].id]);
  const period = consultationsOf("administradora", { range: rangeOf({ mode: "periodo", start: "2026-09-25", end: "2026-09-20" }) });
  assert.deepEqual([period.page, period.items[0].situation], [{ number: 1, size: 15, totalItems: 6 }, "em-curso"]);
  assert.deepEqual(consultationsOf("administradora", { range: rangeOf({ mode: "hoje" }) }).items, []);
  assert.equal(consultationsOf("administradora", { range: null }).page.totalItems, 25);
  // The attendant's ten are 09-16 to 09-25 and the supervisor's twenty 09-06 to 09-25: the cut never reaches past them.
  assert.equal(consultationsOf("atendente", { range: rangeOf({ mode: "data", start: "2026-09-10" }) }).page.totalItems, 0);
  assert.equal(consultationsOf("atendente", { range: rangeOf({ mode: "periodo", start: "2026-09-01", end: "2026-09-30" }) }).page.totalItems, 10);
  const sup = consultationsOf("supervisora", { range: rangeOf({ mode: "periodo", start: "2026-09-01", end: "2026-09-10" }) });
  assert.deepEqual([sup.page, sup.items.map(c => c.id)], [{ number: 1, size: 20, totalItems: 5 }, longHistory.slice(5, 10).reverse().map(c => c.id)]);
  assert.equal(consultationsOf("supervisora", { range: rangeOf({ mode: "periodo", start: "2026-09-01", end: "2026-09-10" }) }, true).page.totalItems, 10);
  // With the search, the reader of the Tarólogos tab and the order; the totals stay those of the scope, as with the search.
  const early = rangeOf({ mode: "periodo", start: "2026-09-01", end: "2026-09-10" });
  assert.deepEqual(consultationsOf("administradora", { range: early, tarotId: "28" }).items.map(c => c.startedAtLocal.slice(0, 10)),
    ["2026-09-10", "2026-09-08", "2026-09-06", "2026-09-04", "2026-09-02"]);
  assert.equal(consultationsOf("administradora", { range: rangeOf({ mode: "data", start: "2026-09-02" }), q: "aurora" }).page.totalItems, 1);
  assert.equal(consultationsOf("administradora", { range: rangeOf({ mode: "data", start: "2026-09-03" }), q: "aurora" }).page.totalItems, 0);
  assert.equal(consultationsOf("administradora", { range: early, sort: "oldest" }).items[0].id, longHistory[0].id);
  assert.deepEqual(consultationsOf("administradora", { range: early }).totals, admin.totals);
  assert.deepEqual(consultationsOf("atendente", { range: early }).totals, consultationsOf("atendente").totals);
  // A start before 6h belongs to the operational day before, as in Consultas (D10).
  const night = [cons(120, "2026-10-26 03:00:00"), cons(120, "2026-10-26 07:00:00")];
  assert.deepEqual(consultationsOf("administradora", { range: rangeOf({ mode: "ontem" }) }, false, night).items.map(c => c.id), [night[0].id]);
  assert.deepEqual(consultationsOf("administradora", { range: rangeOf({ mode: "hoje" }) }, false, night).items.map(c => c.id), [night[1].id]);
});

test("histórico de pagamentos: o recorte de datas pela data paga, sem data paga só em Tudo, dentro do alcance do perfil e com o summary do alcance", () => {
  const sources = src({ informed: [pay(INF, 801, 130, "2026-10-26 00:00:00"), pay(INF, 802, 130, "2026-10-25 00:00:00"),
    pay(INF, 803, 130, "2026-10-19 00:00:00"), pay(INF, 804, 130, "0000-00-00 00:00:00")] });
  const keys = query => receiptsOf("administradora", sources, query).items.map(r => r.key.split(":")[1]);
  assert.deepEqual(keys({}), ["801", "802", "803", "804"]);
  assert.deepEqual(keys({ range: rangeOf({ mode: "hoje" }) }), ["801"]);
  assert.deepEqual(keys({ range: rangeOf({ mode: "ontem" }) }), ["802"]);
  assert.deepEqual(keys({ range: rangeOf({ mode: "7dias" }) }), ["801", "802"]);
  assert.deepEqual(keys({ range: rangeOf({ mode: "data", start: "2026-10-19" }) }), ["803"]);
  assert.deepEqual(keys({ range: rangeOf({ mode: "periodo", start: "2000-01-01", end: "2030-12-31" }) }), ["801", "802", "803"]);
  assert.deepEqual(receiptsOf("administradora", sources, { range: rangeOf({ mode: "hoje" }) }).summary, receiptsOf("administradora", sources).summary);
  // The attendant's ten of twelve are 09-03 to 09-12.
  const twelve = src({ informed: Array.from({ length: 12 }, (_, i) => pay(INF, 900 + i, 130, `2026-09-${String(i + 1).padStart(2, "0")} 00:00:00`)) });
  const early = rangeOf({ mode: "periodo", start: "2026-09-01", end: "2026-09-05" });
  assert.deepEqual(receiptsOf("atendente", twelve, { range: early }).items.map(r => r.paidOn), ["2026-09-05", "2026-09-04", "2026-09-03"]);
  assert.equal(receiptsOf("administradora", twelve, { range: early }).page.totalItems, 5);
  assert.deepEqual(receiptsOf("atendente", twelve, { range: early }).summary, receiptsOf("atendente", twelve).summary);
});

// --- the expansion of the history (I19, T091; R25) -----------------------------------------------------------

const SUPERVISOR = {accountId: "acc-sup", role: "supervisora"};
const grantContext = (over = {}) => ({clientId: "321", actor: SUPERVISOR, sessionId: "sess-1", ...over});
// The line gf_auditoria keeps for a grant, as the AuditGateway reads it back.
const grantEntry = (fact, over = {}) => ({id: "grant-1", ...fact, createdAt: "2026-10-26T17:03:12.000Z", ...over});

test("canExpandRealClientHistory só para a supervisora", () => {
  assert.deepEqual(ROLES.map(role => permissionsFor(role).canExpandRealClientHistory), [false, false, true, false, false]);
});

test("ampliação: só a supervisora, com o motivo aparado de 1 a 500 caracteres pela validateHistoryAccessReason da v608", () => {
  const planned = model.planRealClientHistoryGrant(grantContext(), "  Cliente pediu conferência do histórico  ");
  assert.deepEqual(planned, {fact: {
    actorUserId: "acc-sup", actorRole: "supervisora", action: "clients.history.expand", entity: "cliente", entityId: "321",
    after: {sessionId: "sess-1"}, reason: "Cliente pediu conferência do histórico",
  }});
  assert.equal(model.CLIENT_HISTORY_GRANT_ACTION, "clients.history.expand");
  assert.equal(model.planRealClientHistoryGrant(grantContext(), "x".repeat(500)).fact.reason.length, 500);
  assert.equal(model.planRealClientHistoryGrant(grantContext(), ` ${"x".repeat(500)}\n`).fact.reason.length, 500, "the limit counts the trimmed text");
  for (const reason of ["", "   ", "\n\t", "x".repeat(501), null, undefined, 42]) {
    assert.deepEqual(model.planRealClientHistoryGrant(grantContext(), reason), {denied: "input"}, JSON.stringify(reason));
  }
  for (const role of ROLES.filter(role => role !== "supervisora")) {
    assert.deepEqual(model.planRealClientHistoryGrant(grantContext({actor: {accountId: "acc-sup", role}}), "Motivo"), {denied: "role"}, role);
  }
});

test("ampliação: a liberação vale só para a mesma cliente, conta, função e sessão, e a repetição só com o mesmo motivo", () => {
  const {fact} = model.planRealClientHistoryGrant(grantContext(), "Motivo da ampliação");
  const entry = grantEntry(fact);
  assert.equal(model.isRealClientHistoryGrantFor(entry, grantContext()), true);
  const others = {
    "outra cliente": grantContext({clientId: "322"}),
    "outra conta": grantContext({actor: {accountId: "acc-sup-2", role: "supervisora"}}),
    "outra sessão": grantContext({sessionId: "sess-2"}),
    "outra função": grantContext({actor: {accountId: "acc-sup", role: "atendente"}}),
    "mandada pela administradora": grantContext({actor: {accountId: "acc-sup", role: "administradora"}}),
  };
  for (const [label, context] of Object.entries(others)) assert.equal(model.isRealClientHistoryGrantFor(entry, context), false, label);
  const lines = {
    "outra ação": grantEntry(fact, {action: "operations.export.download"}),
    "outra entidade": grantEntry(fact, {entity: "consultas"}),
    "gravada por outra função": grantEntry(fact, {actorRole: "atendente"}),
    "sem a sessão": grantEntry(fact, {after: undefined}),
    "com a sessão em outro formato": grantEntry(fact, {after: {sessionId: 1}}),
  };
  for (const [label, line] of Object.entries(lines)) assert.equal(model.isRealClientHistoryGrantFor(line, grantContext()), false, label);

  assert.equal(model.sameRealClientHistoryGrant(entry, fact), true);
  assert.equal(model.sameRealClientHistoryGrant(entry, model.planRealClientHistoryGrant(grantContext(), "  Motivo da ampliação ").fact), true, "the same trimmed reason");
  assert.equal(model.sameRealClientHistoryGrant(entry, model.planRealClientHistoryGrant(grantContext(), "Outro motivo").fact), false);
  assert.equal(model.sameRealClientHistoryGrant(entry, model.planRealClientHistoryGrant(grantContext({clientId: "322"}), "Motivo da ampliação").fact), false);
  assert.equal(model.sameRealClientHistoryGrant(entry, model.planRealClientHistoryGrant(grantContext({sessionId: "sess-2"}), "Motivo da ampliação").fact), false);
});

test("ampliação: com a liberação válida o histórico é o completo, sem limite, e só o alcance muda", () => {
  assert.deepEqual(model.realClientHistoryScope("supervisora", true), {kind: "complete"});
  assert.deepEqual(model.realClientHistoryScope("supervisora", false), {kind: "recent", limit: 20});
  assert.deepEqual(model.realClientHistoryScope("atendente", true), {kind: "recent", limit: 10}, "the attendant never expands");
});

// --- verificações próprias da A -------------------------------------------------------------------------------------

test('A: mapeamento papel RBAC da A -> perfil da B (objeto único de configuração; sem perfil = sem acesso)', () => {
  assert.equal(perfilDeClientes(['supervisora']), 'supervisora');
  assert.equal(perfilDeClientes(['atendente']), 'atendente');
  assert.equal(perfilDeClientes(['admin']), 'administradora');
  assert.equal(perfilDeClientes(['gestora']), 'administradora');
  // Vários papéis: o perfil de maior alcance (precedência da configuração).
  assert.equal(perfilDeClientes(['atendente', 'supervisora']), 'supervisora');
  assert.equal(perfilDeClientes(['atendente', 'admin']), 'administradora');
  // Decisão de 29/10/2026: "Financeiro é a Assistente" (docs/banco/20, seção 6); papel RBAC novo `assistente`.
  assert.equal(perfilDeClientes(['assistente']), 'assistente');
  assert.equal(perfilDeClientes(['financeiro']), 'assistente');
  assert.equal(perfilDeClientes(['financeiro_senior']), 'assistente');
  assert.equal(perfilDeClientes(['supervisora', 'financeiro']), 'assistente'); // maior alcance
  assert.equal(perfilDeClientes(['admin', 'assistente']), 'administradora');
  // Sem papel mapeado (marketing, social, vazio): nega por padrão.
  for (const roles of [['marketing', 'social'], [], undefined, null]) assert.equal(perfilDeClientes(roles), null, JSON.stringify(roles));
  // 'assistente' da B não tem papel na A por padrão, mas é configurável sem mexer no código.
  assert.equal(perfilDeClientes(['caixa'], { papelParaPerfil: { caixa: 'assistente' }, precedencia: CONFIGURACAO_PERFIS.precedencia }), 'assistente');
  assert.ok(Object.isFrozen(CONFIGURACAO_PERFIS.papelParaPerfil));
});

test('A: ampliação do histórico valida a regra pura e, com a escrita desligada, recusa com 503 sem conectar (gravação: verificar-gf-history-access.js)', async () => {
  const service = require(path.join(base, 'clientes.service.js'));
  assert.equal(typeof service.ampliarHistorico, 'function');
  const contexto = { clientId: '321', actor: { accountId: 'acc-sup', role: 'supervisora' }, sessionId: 'sess-1' };
  // Recusas anteriores à gravação, na ordem da B: perfil (403), motivo (400), operationKey (400).
  await assert.rejects(service.ampliarHistorico({ ...contexto, actor: { accountId: 'a', role: 'atendente' } }, { reason: 'x', operationKey: 'k' }), (e) => e.statusCode === 403);
  await assert.rejects(service.ampliarHistorico(contexto, { reason: '  ', operationKey: 'k' }), (e) => e.statusCode === 400);
  await assert.rejects(service.ampliarHistorico(contexto, { reason: 'ok', operationKey: '' }), (e) => e.statusCode === 400);
  await assert.rejects(service.ampliarHistorico(contexto, { reason: 'ok', operationKey: 'k'.repeat(65) }), (e) => e.statusCode === 400);
  await assert.rejects(service.ampliarHistorico(contexto, { reason: 'ok', operationKey: ' k' }), (e) => e.statusCode === 400);
  await assert.rejects(service.ampliarHistorico(contexto, { reason: 'ok', operationKey: 'k', extra: 1 }), (e) => e.statusCode === 400);
  // Tudo válido: chega à gravação; com GESTAO_FADAS_ESCRITA_ENABLED desligada ela recusa antes de abrir conexão.
  // A existência da cliente é lida do banco; aqui entra uma dependência falsa (sem banco).
  await assert.rejects(service.ampliarHistorico(contexto, { reason: 'Motivo válido', operationKey: 'chave-1' }, { clienteExiste: async () => false }), (e) => e.statusCode === 404);
  const escritaAntes = process.env.GESTAO_FADAS_ESCRITA_ENABLED;
  delete process.env.GESTAO_FADAS_ESCRITA_ENABLED;
  try {
    await assert.rejects(service.ampliarHistorico(contexto, { reason: 'Motivo válido', operationKey: 'chave-1' }, { clienteExiste: async () => true }),
      (e) => e.statusCode === 503 && e.dados && e.dados.codigo === 'SERVICE_UNAVAILABLE');
  } finally {
    if (escritaAntes !== undefined) process.env.GESTAO_FADAS_ESCRITA_ENABLED = escritaAntes;
  }
});

test('A: lista branca de colunas de usuarios (R18) não tem credencial, CPF só no que a B expõe', () => {
  const { COLUNAS_CLIENTE } = require(path.join(base, 'clientes.service.js'));
  for (const proibida of ['senha', 'login', 'troca_senha', 'data_troca_senha']) assert.ok(!COLUNAS_CLIENTE.includes(proibida), proibida);
  const modelo = fs.readFileSync(path.join(__dirname, '..', 'src', 'models', 'legado', 'tabelas', 'usuarios.model.js'), 'utf8');
  for (const coluna of COLUNAS_CLIENTE) assert.ok(new RegExp(`^\\s*${coluna}:`, 'm').test(modelo), `coluna ${coluna} existe no model`);
  assert.equal(COLUNAS_CLIENTE.length, 32);
});

test('A: nenhuma chave de credencial sai em lista, ficha ou histórico', () => {
  const rowComCredencial = user(900, { senha: 'segredo-antigo', login: 'fulana.login' });
  const ficha = JSON.stringify(profileOf('administradora', rowComCredencial));
  const lista = JSON.stringify(list('administradora', {}, moved(rowComCredencial)));
  for (const texto of [ficha, lista]) assert.ok(!/segredo-antigo|fulana\.login|"senha"|"login":/.test(texto));
});

(async () => {
  for (const [nome, fn] of fila) {
    try {
      await fn();
      aprovados += 1;
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas.push(nome);
      console.log(`  FALHOU  ${nome}\n    ${(e && e.stack) || e}`);
    }
  }
  console.log(`\n${aprovados} verificação(ões) passaram, ${falhas.length} falharam.`);
  if (falhas.length) {
    console.error(`Falhou: ${falhas.join('; ')}`);
    process.exit(1);
  }
})();
