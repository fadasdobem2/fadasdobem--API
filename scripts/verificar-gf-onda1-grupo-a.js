'use strict';

/**
 * Verificação OFFLINE da onda 1, grupo A (API: dados do legado e privacidade). Sem banco, sem rede, sem MySQL (leitores trocados por fixtures).
 *   A1 notas do legado na ficha (somente leitura, origem, ordem, paginação, dedupe, autor)
 *   A2 identidade civil por perfil, no servidor (lista e ficha), com a mesma regra que a tela mostra
 *   A3 "primeira consulta" com o histórico do legado (paridade com o domínio do front e casos agregados)
 *   A4 dados ruins do legado (consultas 1899-12-30, pagamentos absurdos, linhas vazias do ASP)
 *   A5 perfil de sistema (347 AFila) fora do catálogo de tarólogos
 *   node scripts/verificar-gf-onda1-grupo-a.js     (código 0 quando passa)
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..');
const gf = path.join(raiz, 'src', 'gestao-fadas');
const r = (p) => require(path.join(gf, p));
let ok = 0;
const falhas = [];
const fila = [];
const test = (nome, fn) => fila.push([nome, fn]);

// --- A1 ---------------------------------------------------------------------------------------------------
const notasLegado = r('features/ficha/notas.legado');
const linhaObs = (id, over = {}) => ({ id, desc: `nota ${id}`, id_atendente: 7, dt_hr: `2026-10-${String(10 + (id % 10)).padStart(2, '0')}T12:00:00.000Z`, ...over });
const leitor = (todas, extra = {}) => async (cliente, { tam, before }) => ({
  linhas: todas.filter((l) => !before || l.id < Number(before)).sort((a, b) => b.id - a.id).slice(0, tam),
  autores: new Map([['7', { id: 7, nome_id: 'Atend Um', nivel: 2 }], ['8', { id: 8, nome_id: 'Cliente Qualquer', nivel: 0 }]]),
  cadastro: null, ...extra,
});

test('A1: nota do legado vem somente leitura, com origem, autor da equipe e por data; autor que não é equipe vira "Sistema antigo"', async () => {
  const todas = [linhaObs(1, { dt_hr: '2026-01-05T10:00:00.000Z' }), linhaObs(2, { dt_hr: '2025-01-05T10:00:00.000Z', id_atendente: 8 }), linhaObs(3, { dt_hr: new Date('2026-03-01T10:00:00Z') })];
  const x = await notasLegado.doLegado('3293', { limit: 50 }, leitor(todas));
  assert.deepEqual(x.items.map((n) => n.id), ['legado:obs:2', 'legado:obs:1', 'legado:obs:3'], 'por data, a mais antiga primeiro');
  for (const n of x.items) { assert.equal(n.origin, 'legado'); assert.equal(n.readOnly, true); assert.equal(n.clientId, '3293'); assert.ok(Number.isFinite(Date.parse(n.createdAt))); assert.ok(/^[A-Za-z0-9._:-]{1,64}$/.test(n.id)); assert.equal(typeof n.author, 'string'); }
  assert.equal(x.items[0].author, 'Sistema antigo'); assert.equal(x.items[1].author, 'Atend Um');
  assert.deepEqual([x.hasMore, x.nextBefore], [false, null]);
});
test('A1: data nula do ASP (5.635 notas) não inventa data: dateUnknown e época zero; nota vazia sai; <br> vira quebra de linha', async () => {
  const x = await notasLegado.doLegado('5', {}, leitor([linhaObs(1, { dt_hr: null, desc: 'a<br>b' }), linhaObs(2, { desc: '   ' }), linhaObs(3, { dt_hr: '0000-00-00 00:00:00' })]));
  assert.equal(x.items.length, 2);
  assert.ok(x.items.every((n) => n.dateUnknown === true && n.createdAt === '1970-01-01T00:00:00.000Z'));
  assert.equal(x.items.find((n) => n.id === 'legado:obs:1').text, 'a\nb');
});
test('A1: paginação por id (nextBefore) cobre tudo sem repetir, e o texto do cadastro (usuarios.obs_liberacao) só vem na primeira página', async () => {
  const todas = Array.from({ length: 7 }, (_, i) => linhaObs(i + 1));
  const ler = leitor(todas, { cadastro: { texto: 'texto do cadastro' } });
  const vistos = [];
  let before = null; let paginas = 0;
  do {
    const p = await notasLegado.doLegado('9', { limit: 3, before }, ler);
    vistos.push(...p.items.map((n) => n.id)); before = p.nextBefore; paginas += 1;
    if (paginas === 1) assert.ok(p.items.some((n) => n.id === 'legado:cadastro:9' && n.author === 'Cadastro (sistema antigo)' && n.readOnly));
    else assert.ok(!p.items.some((n) => n.id.startsWith('legado:cadastro')));
  } while (before);
  assert.equal(paginas, 3);
  assert.equal(new Set(vistos).size, vistos.length); assert.equal(vistos.filter((v) => v.startsWith('legado:obs:')).length, 7);
});
test('A1: nota nova espelhada no legado (legado_id) não aparece duas vezes', async () => {
  const x = await notasLegado.doLegado('9', { limit: 10, espelhadas: new Set(['2']) }, leitor([linhaObs(1), linhaObs(2), linhaObs(3)]));
  assert.deepEqual(x.items.map((n) => n.id).sort(), ['legado:obs:1', 'legado:obs:3']);
});
test('A1: limite pedido é respeitado (200 no máximo) e o SQL só faz SELECT por id_usuario', () => {
  const fonte = fs.readFileSync(path.join(gf, 'features/ficha/notas.legado.js'), 'utf8');
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/.test(fonte.replace(/\/\*[\s\S]*?\*\//g, '')), 'só leitura');
  assert.ok(/id_usuario: clienteId/.test(fonte)); assert.equal(notasLegado.LIMITE_MAXIMO, 200);
  const serv = fs.readFileSync(path.join(gf, 'features/ficha/notas.service.js'), 'utf8');
  assert.ok(/legado\.ehLegada\(b\.record\.id\)/.test(serv), 'PUT recusa id legado:*');
});
test('A1: o texto da nota do legado nunca vai para o log (só o código do erro)', () => {
  const serv = fs.readFileSync(path.join(gf, 'features/ficha/notas.service.js'), 'utf8');
  assert.ok(/console\.warn\('\[gf\] observações do sistema antigo indisponíveis:', \(e && \(\(e\.dados && e\.dados\.codigo\) \|\| e\.name\)\) \|\| 'erro'\)/.test(serv));
});

// --- A2 ---------------------------------------------------------------------------------------------------
const base = 'features/clientes';
const model = r(`${base}/clientes.model`);
const perfis = r(`${base}/helpers/perfis`);
const { readLegacyConsultation } = r(`${base}/helpers/consultas`);
const { readLegacyPayment } = r(`${base}/helpers/recebimentos`);
const NOW = '2026-10-26T12:00:00';
const CAT = { cpf_status: { 1: 'Regular' }, paises: { 1: 'Brasil' } };
const user = (id, over = {}) => ({ id, nivel: 0, nome_id: `Ident ${id}`, nome2: 'Lu', nome: 'Luiza Prado Souza', ddd: '11', telresidencial: '3333-4444', telcomercial: '', cel: '98888-7777', whats: '21977771111', email: 'lu@ex.com', email2: 'lu2@ex.com',
  cpf: '01234567890', status_cpf_id: 1, buscaNaReceita: 'x', datanascimento: '1985-07-04 00:00:00', horanascimento: '1900-01-01 14:35:00', cidadeNascimento: 'Niteroi', ufNascimento: 'RJ', IDpaisNascimento: 1,
  endereco: 'Rua A', numero: '1', complemento: '', bairro: 'B', cep: '1', cidade: 'C', estado: 'RJ', idPais: 1, data_cadastro: '2026-01-10 15:00:00', saldo: '0.00', valorAPagar: '0.00', id_cliente_valido: 0, ...over });
const SRC = { informed: [], confirmed: [], notFound: [] };
const ficha = (role) => model.buildRealClientProfile({ role, nowLocal: NOW, row: user(101), consultations: [], receipts: SRC, catalogos: CAT });

test('A2: ficha - os 4 perfis de equipe veem nome completo, CPF e nascimento (o que a tela mostra hoje); a taróloga não lê a ficha', () => {
  for (const role of ['administradora', 'assistente', 'supervisora', 'atendente']) {
    const c = ficha(role).client;
    assert.deepEqual([c.fullName, c.cpf, c.birthDate], ['Luiza Prado Souza', '01234567890', '1985-07-04'], role);
  }
  assert.equal(ficha('tarologa'), null);
  assert.equal(ficha('inexistente'), null);
});
test('A2: ficha - o resto do cadastro (2º e-mail, celular, endereço) segue só para administradora e assistente', () => {
  for (const role of ['supervisora', 'atendente']) { const c = ficha(role).client; assert.ok(!('email2' in c) && !('address' in c) && !('birthCity' in c), role); assert.deepEqual(Object.keys(c.phones), ['home'], role); }
  for (const role of ['administradora', 'assistente']) { const c = ficha(role).client; assert.ok('email2' in c && 'address' in c); assert.ok('mobile' in c.phones); }
});
test('A2: a tabela por perfil é a autoridade: quem não pode (taróloga, perfil desconhecido) recebe null, nunca o dado - ficha e lista', () => {
  assert.deepEqual(perfis.IDENTIDADE_CIVIL_POR_PERFIL, { administradora: true, assistente: true, supervisora: true, atendente: true, tarologa: false });
  assert.equal(perfis.canViewCivilIdentity('tarologa'), false); assert.equal(perfis.canViewCivilIdentity(undefined), false); assert.equal(perfis.canViewCivilIdentity('x'), false);
  const registro = model.readRealClientRow(user(101), CAT);
  for (const role of ['tarologa', 'inexistente', undefined]) { const c = model.projectProfile(registro, role); assert.deepEqual([c.fullName, c.cpf, c.birthDate], [null, null, null], String(role)); }
  const ok4 = model.projectProfile(registro, 'atendente'); assert.deepEqual([ok4.fullName, ok4.cpf, ok4.birthDate], ['Luiza Prado Souza', '01234567890', '1985-07-04']);
  assert.ok(Object.isFrozen(perfis.IDENTIDADE_CIVIL_POR_PERFIL), 'tabela congelada');
  const fonte = fs.readFileSync(path.join(gf, base, 'clientes.model.js'), 'utf8');
  assert.ok(/fullName: civil \? record\.fullName : null/.test(fonte) && /cpf: civil \? record\.cpf : null, birthDate: civil \? record\.birthDate : null/.test(fonte), 'ficha filtra no servidor');
  assert.ok(/fullName: canViewCivilIdentity\(plan\.role\) \? record\.fullName : null/.test(fonte), 'lista filtra no servidor');
});
test('A2: lista - nome completo para os 4 perfis de equipe; a taróloga é recusada no plano da lista (403)', () => {
  for (const role of ['administradora', 'assistente', 'supervisora', 'atendente']) {
    const plano = model.planRealClientList(role, {}, NOW).plan;
    const lista = model.buildRealClientList({ plan: plano, clients: [{ record: { id: '101', name: 'Ident 101', treatAs: null, fullName: 'Luiza Prado Souza', oldBalance: { balance: '0.00' }, linkedValidId: null }, latestActivityLocal: null, inConsultationNow: false }], page: { number: 1, size: 50, totalItems: 1 } }, { consultations: [], receipts: SRC });
    assert.equal(lista.clients[0].fullName, 'Luiza Prado Souza', role);
  }
  assert.ok(model.planRealClientList('tarologa', {}, NOW).denied, 'taróloga negada');
});

// --- A3 ---------------------------------------------------------------------------------------------------
const hist = r('_comum/dominio/historico-legado');
const base_ = r('_comum/dominio/financeiro-base');
const preco = r('_comum/dominio/pagamentos-preco');
const AGORA = '2026-11-02T22:00:00';
const EM = '2026-11-02T22:00:00-03:00';

test('A3: sem linha no legado = nova; consulta ou pagamento (com valor) antigo = não é primeira; instante só com data válida', () => {
  assert.deepEqual(hist.perfilDoHistorico({ consultas: { n: 0 }, pagamentos: { n: 0 } }, AGORA), { hasPriorConsultations: false });
  assert.deepEqual(hist.perfilDoHistorico({ consultas: { n: 14, primeira: '2026-08-05 10:00:00' }, pagamentos: { n: 14, primeira: '2026-08-05 00:00:00' } }, AGORA), { hasPriorConsultations: true, firstConsultationAt: '2026-08-05T10:00:00-03:00' });
  assert.deepEqual(hist.perfilDoHistorico({ consultas: { n: 0 }, pagamentos: { n: 1, primeira: '2026-08-05 00:00:00' } }, AGORA), { hasPriorConsultations: true, firstConsultationAt: '2026-08-05T23:59:59-03:00' });
  // só linhas de data inválida: prova que é antiga, sem instante
  assert.deepEqual(hist.perfilDoHistorico({ consultas: { n: 2, primeira: null }, pagamentos: { n: 0 } }, AGORA), { hasPriorConsultations: true });
  assert.deepEqual(hist.perfilDoHistorico({ consultas: { n: 1, primeira: '1899-12-30 00:00:00' }, pagamentos: { n: 1, primeira: '2042-01-01 00:00:00' } }, AGORA), { hasPriorConsultations: true });
});
const perfilBase = { clientId: '1', name: '', paymentProfile: 'Pré-pago', birthDate: '', whatsapp: '', credit: 0, creditUpdatedAt: '', movements: [], neverTarotIds: [], minuteBenefits: [] };
const contexto = (extra) => ({ history: [], consultations: [], profiles: { 1: { ...perfilBase, ...extra } } });
test('A3: cliente com 14 consultas antigas cota R$ 2,96/min (tabela regular); cliente realmente nova mantém a tabela de primeira compra', () => {
  const antiga = hist.perfilDoHistorico({ consultas: { n: 14, primeira: '2026-08-05 10:00:00' }, pagamentos: { n: 14, primeira: '2026-08-05 00:00:00' } }, AGORA);
  const nova = hist.perfilDoHistorico({}, AGORA);
  const a = preco.referenciaDePreco(90, '1', EM, base_.PRECOS_PADRAO, contexto(antiga), undefined, 'PIX');
  const n = preco.referenciaDePreco(90, '1', EM, base_.PRECOS_PADRAO, contexto(nova), undefined, 'PIX');
  assert.ok(Math.abs(a.unitValue - 2.96) < 1e-9, `antiga ${a.unitValue}`);
  assert.ok(Math.abs(n.unitValue - 35 / 15) < 1e-9, `nova ${n.unitValue}`);
  assert.equal(Math.round(90 / a.unitValue), 30, '30 min a R$ 2,96');
  assert.equal(Math.floor(90 / n.unitValue), 38, 'a nova cotava 38 min a 2,33');
});
test('A3: a antiga NÃO recebe mais R$ 35 como primeira compra; a nova recebe', () => {
  const antiga = hist.perfilDoHistorico({ consultas: { n: 3, primeira: '2026-01-05 10:00:00' }, pagamentos: { n: 0 } }, AGORA);
  const a = preco.referenciaDePreco(35, '1', EM, base_.PRECOS_PADRAO, contexto(antiga), undefined, 'PIX');
  const n = preco.referenciaDePreco(35, '1', EM, base_.PRECOS_PADRAO, contexto({}), undefined, 'PIX');
  assert.equal(a.purchase, undefined, 'R$ 35 não é opção da tabela regular');
  assert.deepEqual([n.purchase.table, n.purchase.minutes], ['first', 15]);
});
test('A3: janela de 24 h preservada - nova que pagou/consultou há poucas horas segue como primeira; passou de 24 h vira regular', () => {
  const pagouHoje = hist.perfilDoHistorico({ consultas: { n: 0 }, pagamentos: { n: 1, primeira: '2026-11-02 00:00:00' } }, AGORA);
  assert.equal(base_.elegibilidadePrimeira('1', EM, [], { ...perfilBase, ...pagouHoje }, 24).first, true);
  const consultouOntem = hist.perfilDoHistorico({ consultas: { n: 1, primeira: '2026-11-01 08:00:00' }, pagamentos: { n: 0 } }, AGORA);
  assert.equal(base_.elegibilidadePrimeira('1', EM, [], { ...perfilBase, ...consultouOntem }, 24).first, false);
  const soInvalida = hist.perfilDoHistorico({ consultas: { n: 1, primeira: null }, pagamentos: { n: 0 } }, AGORA);
  const e = base_.elegibilidadePrimeira('1', EM, [], { ...perfilBase, ...soInvalida }, 24);
  assert.deepEqual([e.first, e.knownOld], [false, true]);
  assert.equal(base_.elegibilidadePrimeira('1', EM, [], { ...perfilBase, paymentProfile: 'Pós-pago', ...pagouHoje }, 24).first, false, 'pós-pago nunca é primeira');
});
test('A3: o contexto financeiro (carregar) traz o histórico do legado no perfil; sem legado configurado é "sem histórico"; legado fora do ar propaga', async () => {
  const ctx = r('features/financeiro-cliente/fin.contexto');
  const fonte = { pagamentos: async () => [], consultas: async () => [], beneficios: async () => [], partida: async () => null, migracao: async () => null, perfilEm: async () => null };
  ctx.definirLeitorDeHistorico(async (ids) => new Map(ids.map((id) => [id, { hasPriorConsultations: true, firstConsultationAt: '2026-08-05T10:00:00-03:00' }])));
  let c = await ctx.carregar(fonte, '77');
  assert.deepEqual([c.profile.hasPriorConsultations, c.profile.firstConsultationAt], [true, '2026-08-05T10:00:00-03:00']);
  ctx.definirLeitorDeHistorico(async (ids) => new Map(ids.map((id) => [id, { hasPriorConsultations: false }])));
  c = await ctx.carregar(fonte, '77'); assert.ok(!('hasPriorConsultations' in c.profile));
  const AppError = require(path.join(raiz, 'src/utils/AppError'));
  ctx.definirLeitorDeHistorico(async () => { throw new AppError('x', 503, { codigo: 'LEGADO_NAO_CONFIGURADO' }); });
  c = await ctx.carregar(fonte, '77'); assert.ok(!('hasPriorConsultations' in c.profile));
  ctx.definirLeitorDeHistorico(async () => { throw new AppError('x', 503, { codigo: 'LEGADO_INDISPONIVEL' }); });
  await assert.rejects(() => ctx.carregar(fonte, '77'), (e) => e.statusCode === 503);
  ctx.definirLeitorDeHistorico(null);
});
test('A3: o SQL do histórico é só SELECT agregado por idUsuario, sem coluna pessoal', () => {
  const { SQL, agrupar } = r('features/financeiro-cliente/fin.historico-legado');
  assert.ok(/^\s*SELECT/.test(SQL) && !/\b(INSERT|UPDATE|DELETE)\b/.test(SQL)); assert.equal((SQL.match(/idUsuario IN \(:ids\)/g) || []).length, 3);
  assert.ok(!/nome|email|cpf|tel|cel|pass|senha/i.test(SQL.replace(/nome_id/g, '')));
  const m = agrupar([{ tipo: 'C', cliente: 5, n: 14, primeira: '2026-08-05 10:00:00' }, { tipo: 'P', cliente: 5, n: 2, primeira: '2026-08-05 00:00:00' }, { tipo: 'P', cliente: 5, n: 1, primeira: '2026-07-01 00:00:00' }]);
  assert.deepEqual(m.get('5'), { consultas: { n: 14, primeira: '2026-08-05 10:00:00' }, pagamentos: { n: 3, primeira: '2026-07-01 00:00:00' } });
});

// --- A4 ---------------------------------------------------------------------------------------------------
const dts = r('../gestao-fadas/_comum/legado-datas');
const { buildRealConsultationsCut } = r(`${base}/helpers/consultas`);
const recClientes = r(`${base}/helpers/recebimentos`);
const pagModel = r('features/pagamentos/pagamentos.model');
const consRow = (over = {}) => ({ idConsulta: 5001, idUsuario: 3293, idTarologo: 27, nome_id: null, nmuTarologo: 'Osiris', iniConsulta: '1899-12-30 21:03:00', fimConsulta: '1899-12-30 21:33:00', tmpConsulta: 30, valor_consulta: '47.28', ...over });

test('A4a: consulta com início 1899-12-30 vira "sem data": sem startedAtLocal, com a pendência, e CONTINUA na lista, nos minutos e no valor', () => {
  const c = readLegacyConsultation(consRow());
  assert.equal(c.startedAtLocal, null); assert.equal(c.undatedStart, true); assert.ok(c.issues.includes('Data de início não informada (placeholder do sistema antigo)'));
  assert.ok(!c.issues.some((i) => /Encerramento/.test(i)));
  const normal = readLegacyConsultation(consRow({ idConsulta: 5002, iniConsulta: '2026-10-01 10:00:00', fimConsulta: '2026-10-01 10:30:00', valor_consulta: '59.10' }));
  const cut = buildRealConsultationsCut({ rows: [c, normal], range: { start: '0001-01-01', end: '9999-12-31' }, nowLocal: NOW });
  assert.equal(cut.totals.finished, 2); assert.equal(cut.totals.recordedAmount, '106.38'); assert.equal(cut.totals.recordedMinutes, 60);
  const sem = cut.finished.find((i) => i.id === '5001'); assert.equal(sem.startedAtLocal, null); assert.equal(sem.operationalDate, null); assert.equal(sem.situation, 'finalizada');
  assert.equal(cut.finished[cut.finished.length - 1].id, '5001', 'sem data por último na ordem');
  const dia = buildRealConsultationsCut({ rows: [c, normal], range: { start: '2026-10-01', end: '2026-10-01' }, nowLocal: NOW });
  assert.equal(dia.totals.finished, 1, 'num recorte por dia ela não tem dia');
});
test('A4a: a ficha não perde a leitora das consultas sem data e a ordenação do histórico não quebra', () => {
  const rows = [readLegacyConsultation(consRow()), readLegacyConsultation(consRow({ idConsulta: 5003, idTarologo: 28, nmuTarologo: 'Iris' }))];
  const p = model.buildRealClientProfile({ role: 'administradora', nowLocal: NOW, row: user(3293), consultations: rows, receipts: SRC, catalogos: CAT });
  assert.equal(p.tarologists.length, 2); assert.ok(p.tarologists.every((t) => t.lastStartedAtLocal === '' && t.consultations === 1));
  assert.equal(p.counts.consultations, 2);
  const h = model.buildRealClientConsultationHistory({ role: 'administradora', expanded: false, nowLocal: NOW, clientId: '3293', rows, query: { page: 1 } });
  assert.equal(h.items.length, 2); assert.equal(h.totals.recordedAmount, '94.56');
});
test('A4a: início 0000-00-00 também é sem data; início nulo continua "não informado"', () => {
  assert.equal(readLegacyConsultation(consRow({ iniConsulta: '0000-00-00 00:00:00' })).undatedStart, true);
  const n = readLegacyConsultation(consRow({ iniConsulta: null }));
  assert.ok(!n.undatedStart && n.issues.includes('Início não informado ou inválido'));
});
const pagRow = (id, over = {}) => ({ idPagtoInformado: id, idUsuario: 38566, nome_id: null, vlPagtoInformado: '45.00', dtPagtoInformado: '2026-10-20 00:00:00', dt_criado: '2026-10-20 15:00:00', idBanco: 5, idFormaPagto: 1, status: 'Informado', id_status_pagto: 1, ...over });

test('A4b: pagamento com data absurda (2027, 2042, 6026, 1991) vira "Sem data" (paidOn nulo), mantém o valor e nunca é o "último pagamento"', () => {
  for (const dt of ['2042-08-01 00:00:00', '6026-01-01 00:00:00', '1991-05-05 00:00:00', '1202-01-01 00:00:00', '2999-12-31 00:00:00']) {
    const p = recClientes.readLegacyPayment(pagRow(1, { dtPagtoInformado: dt }), 'tbl_pagtoinformado', {});
    assert.equal(p.paidAtLocal, null, dt); assert.equal(p.recordedAmount, '45.00');
    const q = pagModel.readLegacyPayment(pagRow(1, { dtPagtoInformado: dt }), 'tbl_pagtoinformado', {});
    assert.equal(q.paidAtLocal, null, `pagamentos ${dt}`);
  }
  const hoje = dts.agoraSaoPaulo().slice(0, 10);
  assert.notEqual(recClientes.readLegacyPayment(pagRow(2, { dtPagtoInformado: `${hoje} 00:00:00` }), 'tbl_pagtoinformado', {}).paidAtLocal, null, 'hoje vale');
  const certo = recClientes.readLegacyPayment(pagRow(3), 'tbl_pagtoinformado', {});
  const futuro = recClientes.readLegacyPayment(pagRow(4, { dtPagtoInformado: '2027-08-01 00:00:00', vlPagtoInformado: '99.00' }), 'tbl_pagtoinformado', {});
  const cut = recClientes.buildRealReceiptsCut({ informed: [certo, futuro], confirmed: [], notFound: [], range: { start: '0001-01-01', end: '9999-12-31' }, by: 'paid' });
  assert.deepEqual(cut.receipts.map((x) => x.key), ['tbl_pagtoinformado:3'], 'o futuro fica fora do período e do último pagamento');
  const lista = model.buildRealClientList({ plan: model.planRealClientList('administradora', {}, NOW).plan, clients: [{ record: { id: '38566', name: 'x', treatAs: null, fullName: null, oldBalance: { balance: '0.00' }, linkedValidId: null }, latestActivityLocal: null, inConsultationNow: false }], page: { number: 1, size: 50, totalItems: 1 } }, { consultations: [], receipts: { informed: [certo, futuro], confirmed: [], notFound: [] } });
  assert.equal(lista.clients[0].lastReceipt.key, 'tbl_pagtoinformado:3', 'último pagamento é o de data válida');
  const sem = pagModel.reconcileReceipts({ informed: [pagModel.readLegacyPayment(pagRow(4, { dtPagtoInformado: '2027-08-01 00:00:00' }), 'tbl_pagtoinformado', {})], confirmed: [], notFound: [] });
  assert.equal(sem[0].paidOn, null, 'entra na lista Sem data');
});
test('A4b: o SQL de "sem data" usa a mesma regra (nulo, zero-date, ano < 2000, depois de amanhã)', () => {
  const sql = dts.sqlDataInvalida('dtPagtoInformado');
  for (const parte of ['IS NULL', 'YEAR(dtPagtoInformado) < 2000', 'MONTH(dtPagtoInformado) = 0', 'DAYOFMONTH(dtPagtoInformado) = 0', 'INTERVAL 2 DAY']) assert.ok(sql.includes(parte), parte);
  assert.ok(fs.readFileSync(path.join(gf, 'features/pagamentos/pagamentos.service.js'), 'utf8').includes('const semData = sqlDataInvalida;'));
});
test('A4c: linha vazia do ASP (idUsuario 0, valor 0, 2000-01-01) fica fora de listas e contagens; pagamento com valor ou com cliente NUNCA sai; a soma em reais não muda', () => {
  const vazia = (id) => pagRow(id, { idUsuario: 0, vlPagtoInformado: '0.00', dtPagtoInformado: '2000-01-01 00:00:00' });
  const reais = [pagRow(10), pagRow(11, { vlPagtoInformado: '12.50' })];
  const comValorSemCliente = pagRow(12, { idUsuario: 0, vlPagtoInformado: '30.00', dtPagtoInformado: '2000-01-01 00:00:00' });
  const comClienteSemValor = pagRow(13, { vlPagtoInformado: '0.00', dtPagtoInformado: '2000-01-01 00:00:00' });
  for (const [nome, leitorPag, reconc, corte] of [['clientes', recClientes.readLegacyPayment, recClientes.reconcileReceipts, recClientes.buildRealReceiptsCut], ['pagamentos', pagModel.readLegacyPayment, pagModel.reconcileReceipts, pagModel.buildRealReceiptsCut]]) {
    const lido = (rows) => rows.map((x) => leitorPag(x, 'tbl_pagtoinformado', {}));
    const todas = lido([...reais, vazia(20), vazia(21), vazia(22), comValorSemCliente, comClienteSemValor]);
    const ops = reconc({ informed: todas, confirmed: [], notFound: [] });
    assert.deepEqual(ops.map((x) => x.key).sort(), ['tbl_pagtoinformado:10', 'tbl_pagtoinformado:11', 'tbl_pagtoinformado:12', 'tbl_pagtoinformado:13'].sort(), `${nome}: só as 3 vazias saem`);
    const lancadas = { informed: todas.map((x) => ({ ...x })), confirmed: [], notFound: [], range: { start: '2026-10-20', end: '2026-10-20' }, by: 'launched' };
    const c = corte(lancadas); assert.equal(c.summary.counts.informado, 4, `${nome}: 4 operações com valor ou cliente`);
    assert.equal(c.receipts.filter((x) => x.clientId === null && x.amount === '0.00').length, 0, `${nome}: nenhuma linha vazia na lista`);
    const somaSem = corte({ ...lancadas, informed: lido(reais) }).summary.informedTotal;
    assert.equal(corte({ ...lancadas, informed: lido([...reais, vazia(30), vazia(31)]) }).summary.informedTotal, somaSem, `${nome}: soma igual`);
  }
  assert.equal(dts.linhaVazia({ idUsuario: 0, valor: '0.00', data: '2000-01-01 00:00:00' }), true);
  assert.equal(dts.linhaVazia({ idUsuario: 0, valor: '0.01', data: '2000-01-01 00:00:00' }), false);
  assert.equal(dts.linhaVazia({ idUsuario: 5, valor: '0.00', data: '2000-01-01 00:00:00' }), false);
  assert.equal(dts.linhaVazia({ idUsuario: 0, valor: '0.00', data: '2026-10-20 00:00:00' }), false, 'com data de verdade não é a linha vazia do ASP');
});

// --- A5 ---------------------------------------------------------------------------------------------------
test('A5: 347 "AFila" é perfil de sistema (id E nome); outros ativos com exibir=0 e outro id/nome com "AFila" continuam profissionais', () => {
  const cat = r('_comum/dominio/catalogo-tarologos');
  assert.equal(cat.ehPerfilDeSistema({ idTarologo: 347, nmuTarologo: 'AFila' }), true);
  assert.equal(cat.ehPerfilDeSistema({ idTarologo: '347', nmuTarologo: ' afila ' }), true);
  assert.equal(cat.ehPerfilDeSistema({ idTarologo: 347, nmuTarologo: 'Outra Pessoa' }), false);
  assert.equal(cat.ehPerfilDeSistema({ idTarologo: 348, nmuTarologo: 'AFila' }), false);
  assert.equal(cat.ehPerfilDeSistema({ idTarologo: 197, nmuTarologo: 'Osiris', exibir: 0 }), false, 'exibir=0 NÃO é critério (51 reais têm exibir=0)');
  assert.equal(cat.ehPerfilDeSistema(null), false);
  assert.deepEqual(cat.PERFIS_DE_SISTEMA.map((p) => p.id), ['347']);
  assert.ok(fs.readFileSync(path.join(gf, 'features/cadastros/tarologos.service.js'), 'utf8').includes('legado.filter((l) => !ehPerfilDeSistema(l))'));
});

(async () => {
  for (const [nome, fn] of fila) {
    try { await fn(); aprovados(); console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}\n        ${String(e.message).split('\n').slice(0, 6).join('\n        ')}`); }
  }
  console.log(`\n${ok} verificação(ões) passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
function aprovados() { ok += 1; }
