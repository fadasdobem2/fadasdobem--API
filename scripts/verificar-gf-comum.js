'use strict';

/**
 * Verificação OFFLINE de `src/gestao-fadas/_comum` (política de acesso, helpers compartilhados) e da feature
 * Tarólogos. Porta as asserções de `tests/real-operations-permissions.test.mjs`, a parte pura de
 * `tests/real-features.test.mjs` (permissões não mudam com o ambiente) e as regras de real-page/period/text/export
 * do suspiro (API B). Sem banco, sem rede.
 *
 *   node scripts/verificar-gf-comum.js
 */

const assert = require('assert');

const pol = require('../src/gestao-fadas/_comum/politica-acesso');
const pag = require('../src/gestao-fadas/_comum/paginacao');
const per = require('../src/gestao-fadas/_comum/periodo');
const txt = require('../src/gestao-fadas/_comum/texto');
const exp = require('../src/gestao-fadas/_comum/exportacao');
const dia = require('../src/gestao-fadas/_comum/dia-operacional');
const v = require('../src/gestao-fadas/_comum/validacao');
const serializar = require('../src/gestao-fadas/_comum/serializar');
const tarologos = require('../src/gestao-fadas/features/tarologos/tarologos.model');

let ok = 0;
const passou = (m) => {
  ok += 1;
  console.log(`  ok  ${m}`);
};

const roles = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];

/* --- tests/real-operations-permissions.test.mjs --- */
const tabela = {
  canReadRealOperations: [true, true, false, false, false],
  canManagePayoutAgreement: [true, false, false, false, false],
  canManagePayoutOpening: [true, false, false, false, false],
  canRequestCancellationReview: [true, true, false, false, false],
};
for (const [flag, esperado] of Object.entries(tabela)) {
  roles.forEach((role, i) => assert.strictEqual(pol.permissoesDoPerfil(role)[flag], esperado[i], `${flag} ${role}`));
}
passou('novos sinalizadores da 004 por função');

const antigos = {
  administradora: { canViewConsultations: true, canViewAllPayments: true, canViewPaymentTotals: true, canViewDailyMinutes: true, canExportConsultations: true, canManagePayouts: true, canManageFinancialValues: true, canViewPriceReference: true, canViewOwnAgenda: false, canEditSchedule: true, canDecideCancellationPayout: true },
  assistente: { canViewConsultations: true, canViewAllPayments: true, canViewPaymentTotals: true, canViewDailyMinutes: true, canExportConsultations: true, canManagePayouts: true, canManageFinancialValues: true, canViewPriceReference: true, canViewOwnAgenda: false, canEditSchedule: true, canDecideCancellationPayout: false },
  supervisora: { canViewConsultations: true, canViewAllPayments: false, canViewPaymentTotals: false, canViewDailyMinutes: true, canExportConsultations: false, canManagePayouts: false, canManageFinancialValues: false, canViewPriceReference: true, canViewOwnAgenda: false, canEditSchedule: true, canDecideCancellationPayout: false },
  atendente: { canViewConsultations: true, canViewAllPayments: false, canViewPaymentTotals: false, canViewDailyMinutes: false, canExportConsultations: false, canManagePayouts: false, canManageFinancialValues: false, canViewPriceReference: true, canViewOwnAgenda: false, canEditSchedule: true, canDecideCancellationPayout: false },
  tarologa: { canViewConsultations: false, canViewAllPayments: false, canViewPaymentTotals: false, canViewDailyMinutes: false, canExportConsultations: false, canManagePayouts: false, canManageFinancialValues: false, canViewPriceReference: true, canViewOwnAgenda: true, canEditSchedule: true, canDecideCancellationPayout: false },
};
for (const [role, flags] of Object.entries(antigos)) {
  for (const [flag, valor] of Object.entries(flags)) assert.strictEqual(pol.permissoesDoPerfil(role)[flag], valor, `${flag} ${role}`);
}
passou('sinalizadores antigos mantêm os valores');

/* Capacidades que a B usa nas leituras reais (Clientes) e o conjunto completo de chaves. */
roles.forEach((role, i) => {
  assert.strictEqual(pol.permissoesDoPerfil(role).canReadRealClients, i < 4, `canReadRealClients ${role}`);
  assert.strictEqual(pol.permissoesDoPerfil(role).canExpandRealClientHistory, role === 'supervisora', `canExpandRealClientHistory ${role}`);
  assert.strictEqual(pol.permissoesDoPerfil(role).canViewTarologists, i < 4, `canViewTarologists ${role}`);
});
assert.strictEqual(pol.CAPACIDADES.length, 32);
assert.deepStrictEqual(Object.keys(pol.permissoesDoPerfil('administradora')), [...pol.CAPACIDADES]);
for (const desconhecido of [null, undefined, '', 'gestora', 'ADMINISTRADORA']) {
  assert.ok(Object.values(pol.permissoesDoPerfil(desconhecido)).every((x) => x === false), `perfil ${desconhecido} sem capacidades`);
}
passou('capacidades de clientes/tarólogos, 32 chaves na ordem da B, perfil desconhecido não tem nada');

/* --- tests/real-features.test.mjs (parte pura): permissões não mudam com o ambiente --- */
const emDois = (env) => {
  const antes = process.env.GESTAO_FADAS_ENABLED;
  process.env.GESTAO_FADAS_ENABLED = env;
  try {
    return roles.map((r) => pol.permissoesDoPerfil(r));
  } finally {
    if (antes === undefined) delete process.env.GESTAO_FADAS_ENABLED;
    else process.env.GESTAO_FADAS_ENABLED = antes;
  }
};
assert.deepStrictEqual(emDois('true'), emDois('false'));
const [admin, assistente] = emDois('true');
assert.ok(admin.canManagePayouts && admin.canManagePayoutAgreement && admin.canManagePayoutOpening);
assert.ok(assistente.canManagePayouts);
passou('as permissões não dependem do ambiente (a administradora segue com os sinalizadores do repasse)');

/* --- mapeamento API A -> perfil --- */
const req = (role, roleIds) => ({ user: { id: 'u1', role }, accessContext: roleIds ? { roleIds } : undefined });
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['atendente'])), 'atendente');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['supervisora'])), 'supervisora');
assert.strictEqual(pol.resolverPerfil(req('GESTORA', ['admin'])), 'administradora');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['atendente', 'supervisora'])), 'supervisora'); // maior alcance
assert.strictEqual(pol.resolverPerfil(req('TAROLOGA')), 'tarologa');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE')), 'atendente'); // sem papel RBAC: papel de produto
// Decisão de 29/10/2026 (delegada pelo Patrick): gestora = administradora; "Financeiro é a Assistente" (docs/banco/20, seção 6)
assert.strictEqual(pol.resolverPerfil(req('GESTORA', ['gestora'])), 'administradora');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['assistente'])), 'assistente'); // papel RBAC novo
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['financeiro'])), 'assistente');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['financeiro_senior'])), 'assistente');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['atendente', 'financeiro'])), 'assistente'); // maior alcance
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['supervisora', 'assistente'])), 'assistente');
assert.strictEqual(pol.resolverPerfil(req('ATENDENTE', ['admin', 'assistente'])), 'administradora');
assert.strictEqual(pol.resolverPerfil(req('GESTORA')), 'administradora'); // sem papel RBAC: papel de produto GESTORA (a dona)
assert.strictEqual(pol.resolverPerfil(req('CLIENTE', ['marketing'])), null); // marketing e social: sem relação com a operação
assert.strictEqual(pol.resolverPerfil(req('CLIENTE', ['social'])), null);
assert.strictEqual(pol.resolverPerfil(req('CLIENTE')), null);
assert.strictEqual(pol.resolverPerfil({}), null);
// query, headers e body nunca escolhem perfil
assert.strictEqual(pol.resolverPerfil({ ...req('CLIENTE'), query: { role: 'administradora' }, headers: { 'x-role': 'administradora' }, body: { role: 'administradora' } }), null);
// Quem lê Consultas, Recebimentos, Tarólogos e Repasse na B (canReadRealOperations): só administradora e assistente
for (const [papel, pode] of [['admin', true], ['gestora', true], ['assistente', true], ['financeiro', true], ['supervisora', false], ['atendente', false], ['marketing', false]]) {
  const perfil = pol.resolverPerfil(req('CLIENTE', [papel]));
  assert.strictEqual(Boolean(perfil && pol.permissoesDoPerfil(perfil).canReadRealOperations), pode, `${papel} -> canReadRealOperations`);
}
passou('mapeamento A -> B decidido (admin/gestora = administradora; assistente/financeiro = assistente; marketing/social = sem perfil); query/headers/body não escolhem perfil');

/* --- guarda: sessão -> permissão, 403 com auditoria 'role', escopo --- */
const rodar = (mw, r) => new Promise((resolve) => mw(r, {}, (err) => resolve(err || null)));
(async () => {
  const eventos = [];
  pol.definirRegistroNegacao(async (e) => eventos.push(e));
  const guarda = pol.exigirCapacidade('canReadRealOperations');
  assert.strictEqual((await rodar(guarda, {})).statusCode, 401);
  assert.strictEqual(await rodar(guarda, req('GESTORA', ['admin'])), null);
  assert.strictEqual(eventos.length, 0);
  const negado = await rodar(guarda, { ...req('ATENDENTE', ['atendente']), sessionId: 's1' });
  assert.strictEqual(negado.statusCode, 403);
  assert.strictEqual(negado.message, 'Esta informação não está disponível para a sua função.');
  assert.strictEqual(negado.dados.codigo, 'ACCESS_DENIED');
  assert.deepStrictEqual(eventos[0], {
    acao: 'auth.access.denied', resultado: 'denied', usuarioId: 'u1', perfil: 'atendente', permissao: 'canReadRealOperations',
    motivo: 'role', sessaoId: 's1', chave: 'auth.access.denied:role:canReadRealOperations:s1',
  });
  const semPerfil = await rodar(guarda, req('CLIENTE', ['marketing']));
  assert.strictEqual(semPerfil.statusCode, 403);
  assert.strictEqual(eventos[1].perfil, null);
  const escrita = await rodar(pol.exigirCapacidade('canManagePayouts', { escrita: true }), req('ATENDENTE', ['atendente']));
  assert.strictEqual(escrita.message, 'Esta ação não está disponível para a sua função.');
  await assert.rejects(() => pol.negarEscopo({ ...req('ATENDENTE', ['atendente']), sessionId: 's2' }, 'canReadRealClients'), (e) => e.statusCode === 403);
  assert.strictEqual(eventos[eventos.length - 1].motivo, 'scope');
  // registro que falha: nunca passa como autorizado, vira 503
  pol.definirRegistroNegacao(async () => { throw new Error('falha'); });
  assert.strictEqual((await rodar(guarda, req('ATENDENTE', ['atendente']))).statusCode, 503);
  pol.definirRegistroNegacao(null);
  assert.throws(() => pol.exigirCapacidade('canInventada'), /desconhecida/);
  assert.deepStrictEqual(pol.erroOperacao('INVALID_INPUT').message, 'Confira o período e a página e tente novamente.');
  assert.strictEqual(pol.erroOperacao('INVALID_INPUT', true).message, 'Confira os dados informados e tente novamente.');
  assert.strictEqual(pol.erroOperacao('CLIENT_NOT_FOUND').statusCode, 404);
  passou('guarda: 401 sem sessão, 403 ACCESS_DENIED com auth.access.denied (role/scope), falha ao registrar = 503, textos da B');

  /* --- paginação (real-page) --- */
  assert.deepStrictEqual(pag.pageSpan({ number: 1, size: 500, totalItems: 0 }, 0), { pages: 1, from: 1, to: 0 });
  assert.deepStrictEqual(pag.pageSpan({ number: 2, size: 500, totalItems: 501 }, 1), { pages: 2, from: 501, to: 501 });
  assert.deepStrictEqual(pag.pageInfo(1, 500, 0), { number: 1, size: 500, totalItems: 0 });
  for (const ruim of [[2, 500, 0], [0, 500, 10], [3, 500, 501], [1.5, 500, 10], [-1, 500, 10]]) assert.throws(() => pag.pageInfo(...ruim), pag.PageOutOfRange);
  try { pag.pageInfo(3, 500, 501); } catch (e) { assert.strictEqual(e.message, 'Página 3 fora do intervalo; há 2 página(s).'); assert.strictEqual(e.statusCode, 400); }
  const itens = Array.from({ length: 1201 }, (_, i) => i);
  const p3 = pag.paginate(itens, 3);
  assert.strictEqual(p3.items.length, 201);
  assert.strictEqual(p3.items[0], 1000);
  assert.deepStrictEqual(p3.page, { number: 3, size: 500, totalItems: 1201 });
  assert.strictEqual(pag.paginate(itens, 1, 20).items.length, 20);
  assert.throws(() => pag.paginate(itens, 4), pag.PageOutOfRange);
  assert.strictEqual(pag.REAL_PAGE_SIZE, 500);
  assert.strictEqual(pag.parsePage(undefined), 1);
  assert.strictEqual(pag.parsePage('7'), 7);
  for (const ruim of ['0', '01', '-1', '1.5', 'abc', '', '99999999999999999999']) assert.strictEqual(pag.parsePage(ruim), null, ruim);
  // o helper do módulo (validacao.paginacao/serializar.pagina) segue como estava
  assert.deepStrictEqual(serializar.pagina({ total: 0, pagina: 1, limite: 20, itens: [] }).paginas, 1);
  passou('paginação: pageSpan/pageInfo/paginate/parsePage; página fora do intervalo = 400');

  /* --- período (real-period) e equivalência com validacao.js --- */
  assert.strictEqual(per.MAX_PERIOD_DAYS, 366);
  assert.ok(per.isRealDay('2026-02-28') && per.isRealDay('2028-02-29'));
  for (const ruim of ['2026-02-30', '2026-13-01', '2026-2-3', '29/10/2026', '', '2026-04-31']) assert.ok(!per.isRealDay(ruim), ruim);
  assert.ok(per.withinRealPeriod({ start: '2026-01-01', end: '2026-01-01' }));
  assert.ok(per.withinRealPeriod({ start: '2026-01-01', end: '2027-01-01' })); // 366 dias contando as pontas
  assert.ok(!per.withinRealPeriod({ start: '2026-01-01', end: '2027-01-02' }));
  assert.ok(!per.withinRealPeriod({ start: '2026-10-02', end: '2026-10-01' }));
  for (const [inicio, fim] of [['2026-01-01', '2027-01-01'], ['2026-01-01', '2027-01-02'], ['2026-10-02', '2026-10-01'], ['2028-02-29', '2028-02-29']]) {
    let lanca = false;
    try { v.periodo({ inicio, fim }); } catch (_e) { lanca = true; }
    assert.strictEqual(!lanca, per.withinRealPeriod({ start: inicio, end: fim }), `${inicio}..${fim}`);
  }
  for (const d of ['2026-02-30', '2026-02-28', 'x', '2026-13-01']) {
    let valido = true;
    try { v.dataCivil(d, 'd'); } catch (_e) { valido = false; }
    assert.strictEqual(valido, per.isRealDay(d), d);
  }
  assert.strictEqual(per.shiftDateKey('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(per.shiftDateKey('2026-03-01', -1), '2026-02-28');
  passou('período: isRealDay/withinRealPeriod (366 dias) e equivalência com validacao.dataCivil/periodo');

  /* --- dia operacional: equivalência com formatters.ts da B --- */
  assert.strictEqual(dia.diaOperacionalDe('2026-10-29T05:59:59'), '2026-10-28');
  assert.strictEqual(dia.diaOperacionalDe('2026-10-29T06:00:00'), '2026-10-29');
  assert.strictEqual(dia.diaOperacionalDe('2026-01-01T00:00:00'), '2025-12-31');
  assert.strictEqual(dia.diaOperacionalDe('2026-10-29T01:00:00', 0), '2026-10-29');
  assert.throws(() => dia.diaOperacionalDe('2026-10-29T01:00:00', 24), RangeError);
  assert.strictEqual(dia.timestampSaoPaulo(new Date('2026-10-21T15:30:05.000Z')), '2026-10-21T12:30:05');
  assert.strictEqual(dia.diaOperacionalDe(dia.timestampSaoPaulo(new Date('2026-10-29T08:59:00Z'))), dia.hojeOperacional(new Date('2026-10-29T08:59:00Z')));
  assert.strictEqual(dia.diaOperacionalDe(dia.timestampSaoPaulo(new Date('2026-10-29T09:00:00Z'))), dia.hojeOperacional(new Date('2026-10-29T09:00:00Z')));
  assert.strictEqual(dia.HORA_INICIO, 6);
  assert.strictEqual(dia.rotuloData('2026-10-21'), '21/10/2026');
  passou('dia operacional: igual ao localOperationalDateKey/saoPauloTimestamp da B (6h, SP)');

  /* --- texto (real-text) --- */
  assert.strictEqual(txt.NOT_INFORMED, 'não informado');
  assert.strictEqual(txt.countText(1234), '1.234');
  assert.strictEqual(txt.plural(1, 'consulta', 'consultas'), '1 consulta');
  assert.strictEqual(txt.plural(0, 'consulta', 'consultas'), '0 consultas');
  assert.strictEqual(txt.plural(1500, 'consulta', 'consultas'), '1.500 consultas');
  assert.strictEqual(txt.dayMonth('2026-10-21'), '21/10');
  assert.strictEqual(txt.hourMinute('2026-10-21T12:30:05'), '12:30');
  assert.strictEqual(txt.catalogText({ code: '3', label: 'Cartão' }), 'Cartão');
  assert.strictEqual(txt.catalogText({ code: '3', label: null }), 'código 3');
  assert.strictEqual(txt.catalogText({ code: null, label: null }), null);
  passou('texto: não informado, plural, dia/mês, hora:minuto, catálogo');

  /* --- exportação (sem XLSX) --- */
  assert.strictEqual(exp.moneyCell(null), 'não informado');
  assert.strictEqual(exp.moneyCell('59.20'), 59.2);
  assert.strictEqual(exp.clientCell({ clientId: null, clientLabel: null, clientLabelMissing: false }), 'não informado');
  assert.strictEqual(exp.clientCell({ clientId: '9', clientLabel: 'Cliente 9', clientLabelMissing: true }), 'Cliente 9 · sem nome registrado');
  assert.strictEqual(exp.clientCell({ clientId: null, clientLabel: 'Ana', clientLabelMissing: true }), 'Ana');
  assert.strictEqual(exp.periodLabel({ start: '2026-10-21', end: '2026-10-21' }), '21/10/2026');
  assert.strictEqual(exp.periodLabel({ start: '2026-10-21', end: '2026-10-23' }), '21/10/2026 a 23/10/2026');
  assert.strictEqual(exp.readAtLabel('2026-10-21T15:30:05.000Z'), 'lido em 21/10/2026 12:30:05');
  assert.strictEqual(exp.realExportName(['consultas'], { start: '2026-10-21', end: '2026-10-21' }), 'consultas_2026-10-21.xlsx');
  assert.strictEqual(exp.realExportName(['consultas', 'x'], { start: '2026-10-21', end: '2026-10-23' }), 'consultas_x_2026-10-21_a_2026-10-23.xlsx');
  assert.strictEqual(exp.TOTALS_CAPTION, 'Totais do período');
  assert.strictEqual(exp.limparXml('a\u0000b\u0008c\td\ne\rf\u0085g￾h'), 'abc\td\ne\rf\u0085gh');
  assert.strictEqual(exp.xmlCell(5), 5);
  passou('exportação (sem XLSX): células, rótulos de período/leitura, nome do arquivo e limpeza de XML');

  /* --- Tarólogos: DTO da B --- */
  assert.deepStrictEqual(tarologos.paraDto({ idTarologo: 7, nmuTarologo: 'Ana', ativo: 1 }), { id: '7', name: 'Ana', active: true });
  assert.deepStrictEqual(tarologos.paraDto({ idTarologo: '8', nmuTarologo: 'Bia', ativo: '0' }), { id: '8', name: 'Bia', active: false });
  assert.deepStrictEqual(tarologos.paraDto({ idTarologo: '9', nmuTarologo: '   ', ativo: null }), { id: '9', name: null, active: null });
  assert.deepStrictEqual(tarologos.paraDto({ idTarologo: '10', nmuTarologo: null, ativo: 2 }), { id: '10', name: null, active: null });
  assert.deepStrictEqual(Object.keys(tarologos.paraDto({ idTarologo: 1, nmuTarologo: 'x', ativo: 1 })), ['id', 'name', 'active']);
  assert.strictEqual(tarologos.paraDto({ idTarologo: 1, nmuTarologo: ' Ana ', ativo: 1 }).name, ' Ana '); // texto como está (legacyText)
  for (const ruim of [0, '0', -1, 'abc', null, undefined, '2147483648', 1.5]) assert.throws(() => tarologos.paraDto({ idTarologo: ruim, nmuTarologo: 'x', ativo: 1 }), (e) => e.statusCode === 503, String(ruim));
  assert.strictEqual(tarologos.paraExtensao(null), null);
  assert.deepStrictEqual(tarologos.paraExtensao({ foto_atual_ref: 'f' }), { fotoAtualRef: 'f', primeiroNomeCivil: null, whatsappPessoal: null, whatsappAvatar: null, situacaoTurno: null, retornoPrevistoEm: null });
  assert.deepStrictEqual(tarologos.COLUNAS, ['idTarologo', 'nmuTarologo', 'ativo']);
  passou('tarólogos: DTO { id, name, active }, ativo só 1/0, id inválido falha, extensão separada');

  console.log(`\nVERIFICAÇÃO OK (${ok} grupos de checagem). Nenhuma conexão foi aberta.`);
  process.exit(0);
})().catch((e) => {
  console.error('\nFALHOU:', e.stack || e.message);
  process.exit(1);
});
