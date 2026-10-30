'use strict';

/**
 * Verificação OFFLINE das GRAVAÇÕES de repasse (sem banco, sem rede). Usa um executor falso em memória que simula as
 * tabelas gf_repasse_* e gf_auditoria o bastante para provar:
 *   - idempotência (mesma operationKey: mesmo resultado, uma só linha de auditoria);
 *   - conflito (mesma chave, corpo diferente) e transação revertida em erro (nada fica, nem a auditoria);
 *   - abertura rascunho -> confirmar -> corrigir, com as dívidas substituídas como na B;
 *   - que o allowlist de models/legado/escrita.js NUNCA é violado: cada SQL passa por `motivoDeRecusa`;
 *   - a flag R24, as rotas e a validação (dinheiro só em texto).
 *
 *   node scripts/verificar-gf-repasse-escrita.js
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const raiz = path.join(__dirname, '..', 'src', 'gestao-fadas', 'features', 'repasse');
const esc = path.join(raiz, 'escrita');
const { motivoDeRecusa } = require(path.join(__dirname, '..', 'src', 'models', 'legado', 'escrita'));
const { AUDIT_INSERT } = require(path.join(__dirname, '..', 'src', 'gestao-fadas', '_comum', 'auditoria'));
const sql = require(path.join(esc, 'sql'));
const { criarRepasseEscrita } = require(path.join(esc, 'fabrica'));
const { RepasseStoreError } = require(path.join(esc, 'erro'));
const { entradaDaAbertura } = require(path.join(esc, 'entrada'));
const { traduzirErroEscrita } = require(path.join(esc, 'erros'));
const { repasseEscritaLigada } = require(path.join(esc, 'escrita.flag'));
const { criarServicoEscrita } = require(path.join(esc, 'escrita.service'));
const { openingView } = require(path.join(raiz, 'repasse.dto'));
const validacao = require(path.join(raiz, 'repasse.validacao'));

let ok = 0;
const falhas = [];
const pendentes = [];
function teste(nome, fn) {
  pendentes.push(async () => {
    try {
      await fn();
      ok += 1;
      console.log(`  ok  ${nome}`);
    } catch (e) {
      falhas.push(nome);
      console.log(`  FALHOU  ${nome}\n        ${String(e && e.stack ? e.stack : e).split('\n').slice(0, 6).join('\n        ')}`);
    }
  });
}

// ---------------------------------------------------------------------------------------------------------
// Banco falso em memória
// ---------------------------------------------------------------------------------------------------------

const TABELAS = ['gf_repasse_percentuais', 'gf_repasse_calendarios', 'gf_repasse_aberturas', 'gf_repasse_abertura_pendencias', 'gf_repasse_dividas',
  'gf_repasse_divida_parcelas', 'gf_repasse_ajustes', 'gf_auditoria', 'gf_auth_accounts'];
const cents = (t) => BigInt(t.replace('.', ''));
const porTexto = (campo) => (a, b) => (a[campo] < b[campo] ? -1 : a[campo] > b[campo] ? 1 : 0);

function criarBanco({ tarologos = ['7'], contas = ['conta-1'] } = {}) {
  const banco = { t: {}, sqlVistos: new Set(), falharNaAuditoria: false, travas: [], tarologos: new Set(tarologos) };
  for (const n of TABELAS) banco.t[n] = [];
  for (const id of contas) banco.t.gf_auth_accounts.push({ id });
  const T = banco.t;

  function inserir(instrucao, p) {
    const m = /INSERT INTO (\w+) \(([^)]*)\)\s+VALUES \((.*)\)$/s.exec(instrucao);
    const colunas = m[2].split(',').map((c) => c.trim());
    const fichas = m[3].split(',').map((c) => c.trim());
    let i = 0;
    const linha = {};
    colunas.forEach((c, k) => {
      const f = fichas[k];
      linha[c] = f === '?' ? p[i++] : f === 'NULL' ? null : f.replace(/^'|'$/g, '');
    });
    assert.equal(i, p.length, `parâmetros a mais em ${m[1]}`);
    assert.ok(!p.includes(undefined), 'parâmetro undefined chegaria ao mysql2');
    if (m[1] === 'gf_auditoria' && banco.t.gf_auditoria.some((l) => l.operation_key === linha.operation_key)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
    T[m[1]].push(linha);
    return [{ affectedRows: 1 }];
  }

  function executar(instrucao, p = []) {
    banco.sqlVistos.add(instrucao);
    const recusa = motivoDeRecusa(instrucao);
    if (recusa) throw new Error(`allowlist violado: ${recusa}`);
    if (instrucao === AUDIT_INSERT && banco.falharNaAuditoria) throw Object.assign(new Error('falha'), { code: 'ER_FAKE' });
    if (/^INSERT/i.test(instrucao)) return inserir(instrucao, p);
    if (/FOR UPDATE/.test(instrucao)) banco.travas.push(instrucao);
    const [a] = p;
    switch (instrucao) {
      case sql.REPLAY: return [T.gf_auditoria.filter((l) => l.operation_key === a)];
      case sql.ACCOUNT_EXISTS: return [T.gf_auth_accounts.filter((l) => l.id === a)];
      case sql.COMMISSION_RATES: return [T.gf_repasse_percentuais.filter((l) => l.tarot_id === a).sort((x, y) => porTexto('vigente_desde')(x, y) || porTexto('id')(x, y))];
      case sql.PAYMENT_SCHEDULES: return [T.gf_repasse_calendarios.filter((l) => l.tarot_id === a).sort((x, y) => porTexto('vigente_desde')(x, y) || porTexto('id')(x, y))];
      case sql.DEBTS: return [T.gf_repasse_dividas.filter((l) => l.tarot_id === a).sort((x, y) => x.registrado_em - y.registrado_em || porTexto('id')(x, y))];
      case sql.INSTALLMENTS: {
        const ids = new Set(T.gf_repasse_dividas.filter((l) => l.tarot_id === a).map((l) => l.id));
        return [T.gf_repasse_divida_parcelas.filter((l) => ids.has(l.divida_id)).sort((x, y) => porTexto('divida_id')(x, y) || x.sequencia - y.sequencia)];
      }
      case sql.ADJUSTMENTS: return [T.gf_repasse_ajustes.filter((l) => l.tarot_id === a).sort((x, y) => x.registrado_em - y.registrado_em || porTexto('id')(x, y))];
      case sql.OPENINGS: return [T.gf_repasse_aberturas.filter((l) => l.tarot_id === a).sort((x, y) => x.revisao - y.revisao).map((l) => ({
        ...l, corrige_id: (T.gf_repasse_aberturas.find((n) => n.tarot_id === l.tarot_id && n.revisao === l.corrige_revisao) || {}).id ?? null }))];
      case sql.DIFFERENCES: {
        const ids = new Set(T.gf_repasse_aberturas.filter((l) => l.tarot_id === a).map((l) => l.id));
        return [T.gf_repasse_abertura_pendencias.filter((l) => ids.has(l.abertura_id)).sort(porTexto('id'))];
      }
      case sql.TAROT_OPENINGS: return [T.gf_repasse_aberturas.filter((l) => l.tarot_id === a).map(({ revisao, situacao }) => ({ revisao, situacao }))];
      case sql.OPENING_STATE: return [T.gf_repasse_aberturas.filter((l) => l.id === a)];
      case sql.DEBT_STATE: return [T.gf_repasse_dividas.filter((l) => l.id === a).map(({ tarot_id, situacao }) => ({ tarot_id, situacao }))];
      case sql.INSTALLMENT_TOTAL: {
        const d = T.gf_repasse_dividas.find((l) => l.id === a);
        const soma = T.gf_repasse_divida_parcelas.filter((l) => l.divida_id === a).reduce((s, l) => s + cents(l.valor), 0n);
        const txt = `${soma / 100n}.${String(soma % 100n).padStart(2, '0')}`;
        return [[{ valor: d.valor, soma: txt }]];
      }
      case sql.CONFIRM_OPENING: Object.assign(T.gf_repasse_aberturas.find((l) => l.id === p[2]), { situacao: 'confirmada', confirmado_por: p[0], confirmado_em: p[1] }); return [{}];
      case sql.DISCARD_OPENING: T.gf_repasse_aberturas.find((l) => l.id === a).situacao = 'descartada'; return [{}];
      case sql.REPLACE_DEBT: T.gf_repasse_dividas.find((l) => l.id === a).situacao = 'substituido'; return [{}];
      case sql.REPLACE_OLDER_MIGRATED_DEBTS:
        for (const l of T.gf_repasse_dividas) if (l.tarot_id === a && l.origem === 'migracao' && l.situacao === 'valido' && l.abertura_id !== p[1]) l.situacao = 'substituido';
        return [{}];
      default: throw new Error(`SQL não simulado: ${instrucao.slice(0, 60)}`);
    }
  }

  banco.avulso = async (i, p) => executar(i, p);
  banco.emTransacao = async (trabalho) => {
    const foto = JSON.stringify(banco.t);
    try {
      return await trabalho({ execute: async (i, p) => executar(i, p) });
    } catch (e) {
      banco.t = JSON.parse(foto);
      for (const n of TABELAS) T[n] = banco.t[n];
      Object.keys(T).forEach((k) => { if (T[k] !== banco.t[k]) delete T[k]; });
      throw e;
    }
  };
  return banco;
}

function criarLoja(opcoes) {
  const banco = criarBanco(opcoes);
  let relogio = 1_700_000_000_000;
  let seq = 0;
  // o rollback troca banco.t: o executor lê sempre `banco.t`
  const loja = criarRepasseEscrita({
    avulso: banco.avulso, emTransacao: banco.emTransacao, agora: () => (relogio += 1000), novoId: () => `id-${++seq}`,
    legado: { tarologoExiste: async (id) => banco.tarologos.has(id) },
  });
  return { banco, loja };
}

const ator = { accountId: 'conta-1', role: 'administradora' };
const corpoAbertura = (extra = {}) => ({
  tarotId: '7', lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00',
  remainingBalance: '50.00', migrationCut: '2026-10-05T06:00:00', rate: '30',
  openAdjustments: [{ kind: 'bonus', amount: '10.00', description: 'bônus', date: '2026-10-03' }],
  debts: [{ kind: 'loan', remaining: '100.00', sheetRef: 'E5', installments: [{ date: '2026-10-10', amount: '60.00' }, { date: '2026-11-10', amount: '40.00' }] }],
  differences: [{ description: 'diferença' }], operationKey: 'abre-1', ...extra,
});
const entrada = (corpo) => entradaDaAbertura(corpo, ator);
const rascunho = (loja, extra) => loja.draftOpening(entrada(validacao.corpoAbertura(corpoAbertura(extra))));
const recusa = async (promessa, codigo) => assert.rejects(promessa, (e) => e instanceof RepasseStoreError && e.codigo === codigo, codigo);
const comissao = (extra = {}) => ({ operationKey: 'com-1', actor: ator, tarotId: '7', rate: '35.00', reason: 'ajuste', effectiveFrom: '2026-10-29 10:00:00', ...extra });

// ---------------------------------------------------------------------------------------------------------
// Idempotência, conflito e reversão
// ---------------------------------------------------------------------------------------------------------

teste('percentual: mesma operationKey devolve o mesmo registro e grava UMA linha de auditoria', async () => {
  const { banco, loja } = criarLoja();
  const a = await loja.setCommissionRate(comissao());
  const b = await loja.setCommissionRate(comissao());
  assert.deepEqual(a, b);
  assert.equal(banco.t.gf_repasse_percentuais.length, 1);
  assert.equal(banco.t.gf_auditoria.length, 1);
  const aud = banco.t.gf_auditoria[0];
  assert.equal(aud.acao, 'payout.agreement.set');
  assert.equal(aud.entidade, 'payout.commission');
  assert.equal(aud.operation_key, 'com-1');
  assert.equal(aud.antes, null, 'sem percentual anterior, o antes é NULL e não o texto "null"');
  assert.deepEqual(JSON.parse(aud.depois), a);
  assert.equal(a.rate, '35.00');
});

teste('percentual: o antes da auditoria é o último vigente; calendário idem', async () => {
  const { banco, loja } = criarLoja();
  const p1 = await loja.setCommissionRate(comissao());
  await loja.setCommissionRate(comissao({ operationKey: 'com-2', rate: '40.00', effectiveFrom: '2026-10-30 10:00:00' }));
  assert.equal(JSON.parse(banco.t.gf_auditoria[1].antes).id, p1.id);
  const c1 = await loja.setPaymentSchedule({ operationKey: 'cal-1', actor: ator, tarotId: '7', schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' }, reason: null, effectiveFrom: '2026-10-29 10:00:00' });
  assert.deepEqual(c1.schedule, { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' });
  const w = await loja.setPaymentSchedule({ operationKey: 'cal-2', actor: ator, tarotId: '7', schedule: { kind: 'weekday', weekday: 'sexta' }, reason: 'x', effectiveFrom: '2026-10-30 10:00:00' });
  assert.deepEqual(w.schedule, { kind: 'weekday', weekday: 'sexta' });
  assert.equal(JSON.parse(banco.t.gf_auditoria[3].antes).id, c1.id);
  const n = await loja.setPaymentSchedule({ operationKey: 'cal-3', actor: ator, tarotId: '7', schedule: { kind: 'none' }, reason: null, effectiveFrom: '2026-10-31 10:00:00' });
  assert.deepEqual(n.schedule, { kind: 'none' });
  assert.equal(banco.t.gf_repasse_calendarios[2].dias_mes, null);
});

teste('conflito: a mesma chave com outro corpo, outra conta ou outra ação é recusada e nada é gravado', async () => {
  const { banco, loja } = criarLoja({ contas: ['conta-1', 'conta-2'] });
  await loja.setCommissionRate(comissao());
  await recusa(loja.setCommissionRate(comissao({ rate: '36.00' })), 'operation-key-conflict');
  await recusa(loja.setCommissionRate(comissao({ reason: 'outro' })), 'operation-key-conflict');
  await recusa(loja.setCommissionRate(comissao({ actor: { accountId: 'conta-2', role: 'administradora' } })), 'operation-key-conflict');
  await recusa(loja.setPaymentSchedule({ operationKey: 'com-1', actor: ator, tarotId: '7', schedule: { kind: 'none' }, reason: null, effectiveFrom: '2026-10-29 10:00:00' }), 'operation-key-conflict');
  assert.equal(banco.t.gf_repasse_percentuais.length, 1);
  assert.equal(banco.t.gf_auditoria.length, 1);
});

teste('reversão: falha ao gravar a auditoria desfaz a gravação (percentual e abertura)', async () => {
  const { banco, loja } = criarLoja();
  banco.falharNaAuditoria = true;
  await assert.rejects(loja.setCommissionRate(comissao()), /falha/);
  await assert.rejects(rascunho(loja), /falha/);
  for (const n of TABELAS.filter((x) => x !== 'gf_auth_accounts')) assert.equal(banco.t[n].length, 0, n);
  banco.falharNaAuditoria = false;
  await loja.setCommissionRate(comissao());
  assert.equal(banco.t.gf_repasse_percentuais.length, 1, 'a mesma chave grava depois que a falha passa');
});

teste('reversão: parcelas que não somam a dívida desfazem a abertura inteira (installments-mismatch)', async () => {
  const { banco, loja } = criarLoja();
  const corpo = corpoAbertura();
  corpo.debts[0].installments[1].amount = '30.00';
  // fora do validador de propósito: o store confere de novo, no banco
  await recusa(loja.draftOpening(entrada(corpo)), 'installments-mismatch');
  for (const n of ['gf_repasse_aberturas', 'gf_repasse_dividas', 'gf_repasse_divida_parcelas', 'gf_repasse_ajustes', 'gf_repasse_abertura_pendencias', 'gf_auditoria']) assert.equal(banco.t[n].length, 0, n);
});

teste('recusas antes de gravar: tarólogo ausente do legado, conta sem gf_auth_accounts, quitado depois do corte', async () => {
  const { banco, loja } = criarLoja({ tarologos: [] });
  await recusa(loja.setCommissionRate(comissao()), 'legacy-id-missing');
  const sem = criarLoja({ contas: [] });
  await recusa(sem.loja.setCommissionRate(comissao()), 'actor-account-missing');
  const corpo = corpoAbertura({ settledThrough: '2026-10-06T06:00:00' });
  assert.throws(() => loja.draftOpening(entrada(corpo)), (e) => e.codigo === 'settled-after-cut');
  assert.equal(banco.t.gf_auditoria.length, 0);
});

// ---------------------------------------------------------------------------------------------------------
// Abertura: criar, confirmar, corrigir
// ---------------------------------------------------------------------------------------------------------

teste('abertura: rascunho da revisão 1 com dívidas, parcelas, ajuste e pendência; repetir não duplica nada', async () => {
  const { banco, loja } = criarLoja();
  const a = await rascunho(loja);
  assert.equal(a.revision, 1);
  assert.equal(a.status, 'rascunho');
  assert.equal(a.corrects, null);
  assert.equal(a.rate, '30.00');
  assert.equal(a.debts.length, 1);
  assert.deepEqual(a.debts[0].installments.map((p) => [p.sequence, p.date, p.amount]), [[1, '2026-10-10', '60.00'], [2, '2026-11-10', '40.00']]);
  assert.equal(a.debts[0].referenceDate, '2026-10-01');
  assert.equal(a.debts[0].origin, 'migracao');
  assert.equal(a.adjustments[0].periodStart, '2026-10-03');
  assert.equal(a.differences.length, 1);
  const repetida = await rascunho(loja);
  assert.deepEqual(repetida, a);
  assert.equal(banco.t.gf_repasse_aberturas.length, 1);
  assert.equal(banco.t.gf_repasse_dividas.length, 1);
  assert.equal(banco.t.gf_repasse_divida_parcelas.length, 2);
  assert.equal(banco.t.gf_auditoria.length, 1);
  await recusa(rascunho(loja, { remainingBalance: '51.00' }), 'operation-key-conflict');
  await recusa(rascunho(loja, { operationKey: 'abre-2' }), 'draft-exists');
  const view = openingView(a);
  assert.equal(view.settledThrough, '2026-10-02T06:00:00');
  assert.equal(view.remainingBalanceNote, null);
});

teste('abertura: confirmar vira a vigente, só uma vez, e a repetição devolve o registro guardado', async () => {
  const { banco, loja } = criarLoja();
  const a = await rascunho(loja);
  const c = await loja.confirmOpening({ operationKey: 'conf-1', actor: ator, openingId: a.id });
  assert.equal(c.status, 'confirmada');
  assert.equal(c.confirmedBy, 'conta-1');
  assert.ok(c.confirmedAt > 0);
  assert.equal(JSON.parse(banco.t.gf_auditoria[1].antes).status, 'rascunho');
  assert.deepEqual(await loja.confirmOpening({ operationKey: 'conf-1', actor: ator, openingId: a.id }), c);
  assert.equal(banco.t.gf_auditoria.length, 2);
  await recusa(loja.confirmOpening({ operationKey: 'conf-2', actor: ator, openingId: a.id }), 'not-a-draft');
  await recusa(loja.confirmOpening({ operationKey: 'conf-3', actor: ator, openingId: 'nao-existe' }), 'not-found');
  await recusa(rascunho(loja, { operationKey: 'abre-9' }), 'opening-exists');
  await recusa(loja.confirmOpening({ operationKey: 'conf-1', actor: ator, openingId: 'outra' }), 'operation-key-conflict');
});

teste('abertura: corrigir a confirmada cria a N+1 em rascunho; a N e as dívidas dela seguem valendo até confirmar a N+1', async () => {
  const { banco, loja } = criarLoja();
  const r1 = await rascunho(loja);
  await loja.confirmOpening({ operationKey: 'conf-1', actor: ator, openingId: r1.id });
  const corr = validacao.corpoCorrecao({ ...corpoAbertura({ operationKey: 'corr-1', remainingBalance: '70.00' }), reason: 'valor errado' });
  const r2 = await loja.correctOpening({ ...entrada(corr), openingId: r1.id, reason: corr.reason });
  assert.equal(r2.revision, 2);
  assert.equal(r2.status, 'rascunho');
  assert.equal(r2.corrects, 1);
  assert.equal(r2.correctsId, r1.id);
  assert.equal(r2.correctionReason, 'valor errado');
  assert.equal(r2.debts[0].corrects, r1.debts[0].id, 'a dívida de cada posição aponta para a da mesma posição na N');
  assert.equal(r2.debts[0].correctionReason, 'valor errado');
  const estado = () => Object.fromEntries(banco.t.gf_repasse_aberturas.map((l) => [l.revisao, l.situacao]));
  assert.deepEqual(estado(), { 1: 'confirmada', 2: 'rascunho' });
  assert.equal(banco.t.gf_repasse_dividas.find((d) => d.id === r1.debts[0].id).situacao, 'valido');
  const aud = banco.t.gf_auditoria.at(-1);
  assert.equal(aud.acao, 'payout.opening.correct');
  assert.equal(aud.motivo, 'valor errado');
  assert.equal(JSON.parse(aud.antes).id, r1.id);
  assert.deepEqual(await loja.correctOpening({ ...entrada(corr), openingId: r1.id, reason: corr.reason }), r2);
  assert.equal(banco.t.gf_auditoria.length, 3);

  await loja.confirmOpening({ operationKey: 'conf-2', actor: ator, openingId: r2.id });
  assert.equal(banco.t.gf_repasse_dividas.find((d) => d.id === r1.debts[0].id).situacao, 'substituido', 'confirmar a N+1 tira as dívidas da N');
  assert.equal(banco.t.gf_repasse_dividas.find((d) => d.id === r2.debts[0].id).situacao, 'valido');
});

teste('abertura: corrigir um rascunho o descarta; só a última revisão se corrige; tarólogo trocado é recusado', async () => {
  const { banco, loja } = criarLoja({ tarologos: ['7', '8'] });
  const r1 = await rascunho(loja);
  const corrige = (id, chave, extra = {}) => {
    const c = validacao.corpoCorrecao({ ...corpoAbertura({ operationKey: chave, ...extra }), reason: 'motivo' });
    return loja.correctOpening({ ...entrada(c), openingId: id, reason: c.reason });
  };
  const r2 = await corrige(r1.id, 'c1');
  assert.deepEqual(Object.fromEntries(banco.t.gf_repasse_aberturas.map((l) => [l.revisao, l.situacao])), { 1: 'descartada', 2: 'rascunho' });
  assert.equal(banco.t.gf_repasse_dividas.find((d) => d.id === r1.debts[0].id).situacao, 'substituido', 'as dívidas do rascunho descartado saem já');
  await recusa(loja.confirmOpening({ operationKey: 'conf', actor: ator, openingId: r1.id }), 'not-a-draft');
  await recusa(corrige(r1.id, 'c2'), 'draft-exists');
  await loja.confirmOpening({ operationKey: 'conf-2', actor: ator, openingId: r2.id });
  await recusa(corrige(r1.id, 'c2'), 'not-latest');
  await recusa(corrige(r2.id, 'c3', { tarotId: '8' }), 'invalid-input');
  assert.equal(banco.t.gf_repasse_aberturas.length, 2);
});

teste('abertura: FOR UPDATE nas mesmas ordens da B (estado da abertura, dívidas, revisões do tarólogo)', async () => {
  const { banco, loja } = criarLoja();
  const r1 = await rascunho(loja);
  await loja.confirmOpening({ operationKey: 'conf-1', actor: ator, openingId: r1.id });
  banco.travas.length = 0;
  const c = validacao.corpoCorrecao({ ...corpoAbertura({ operationKey: 'corr-1' }), reason: 'r' });
  await loja.correctOpening({ ...entrada(c), openingId: r1.id, reason: c.reason });
  assert.deepEqual(banco.travas, [sql.OPENING_STATE, sql.DEBT_STATE, sql.TAROT_OPENINGS]);
});

// ---------------------------------------------------------------------------------------------------------
// Allowlist, flag, rotas, validação, serviço
// ---------------------------------------------------------------------------------------------------------

teste('allowlist: todo SQL que o fluxo completo emitiu passa por motivoDeRecusa; só INSERT/UPDATE em gf_*, sem DELETE', async () => {
  const { banco, loja } = criarLoja();
  await loja.setCommissionRate(comissao());
  await loja.setPaymentSchedule({ operationKey: 'cal-1', actor: ator, tarotId: '7', schedule: { kind: 'none' }, reason: null, effectiveFrom: '2026-10-29 10:00:00' });
  const r1 = await rascunho(loja);
  await loja.confirmOpening({ operationKey: 'conf-1', actor: ator, openingId: r1.id });
  const c = validacao.corpoCorrecao({ ...corpoAbertura({ operationKey: 'corr-1' }), reason: 'r' });
  await loja.correctOpening({ ...entrada(c), openingId: r1.id, reason: c.reason });
  assert.ok(banco.sqlVistos.size >= 20, `poucos SQL exercitados (${banco.sqlVistos.size})`);
  for (const s of banco.sqlVistos) {
    assert.equal(motivoDeRecusa(s), null, s.slice(0, 80));
    assert.doesNotMatch(s, /\bDELETE\b|\bDROP\b|\bALTER\b|\bTRUNCATE\b/i);
    for (const t of [...s.matchAll(/\b(?:into|update|from|join)\s+`?([a-z0-9_]+)`?/gi)].map((m) => m[1])) assert.match(t, /^gf_/, `${t} em ${s.slice(0, 60)}`);
  }
  for (const s of Object.values(sql)) assert.equal(motivoDeRecusa(s), null, s.slice(0, 60));
  for (const ruim of ['DELETE FROM gf_repasse_dividas WHERE id = 1', 'UPDATE tbl_consultas SET valor = 1', 'INSERT INTO usuarios (id) VALUES (1)', 'SELECT * FROM tbl_tarologos FOR UPDATE']) {
    assert.notEqual(motivoDeRecusa(ruim), null, ruim);
  }
});

teste('flag R24: só liga com GESTAO_FADAS_ESCRITA_ENABLED=true E FADAS_ENVIRONMENT=test', () => {
  assert.equal(repasseEscritaLigada({ GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test' }), true);
  assert.equal(repasseEscritaLigada({ GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'production' }), false);
  assert.equal(repasseEscritaLigada({ GESTAO_FADAS_ESCRITA_ENABLED: 'true' }), false);
  assert.equal(repasseEscritaLigada({ FADAS_ENVIRONMENT: 'test' }), false);
  assert.equal(repasseEscritaLigada({ GESTAO_FADAS_ESCRITA_ENABLED: 'false', FADAS_ENVIRONMENT: 'test' }), false);
});

teste('rotas: 5 POST sob /payouts, flag primeiro e só a administradora (capacidade de gravação da B)', () => {
  const router = require(path.join(raiz, 'repasse.routes'));
  const posts = router.stack.filter((l) => l.route && l.route.methods.post);
  assert.deepEqual(posts.map((l) => l.route.path), [
    '/payouts/agreements/:tarotId/commission', '/payouts/agreements/:tarotId/schedule', '/payouts/openings',
    '/payouts/openings/:ref/confirm', '/payouts/openings/:ref/correct',
  ]);
  for (const l of posts) assert.equal(l.route.stack[0].handle.name, 'exigirEscritaLigada', l.route.path);
  const src = fs.readFileSync(path.join(raiz, 'repasse.routes.js'), 'utf8');
  assert.equal((src.match(/escrever\('canManagePayoutAgreement'\)/g) || []).length, 2);
  assert.equal((src.match(/escrever\('canManagePayoutOpening'\)/g) || []).length, 3);
  const { permissoesDoPerfil } = require('../src/gestao-fadas/_comum/politica-acesso');
  assert.equal(permissoesDoPerfil('assistente').canManagePayoutAgreement, false);
  assert.equal(permissoesDoPerfil('administradora').canManagePayoutOpening, true);
});

teste('rota desligada responde 404 sem tocar em nada; ligada passa', async () => {
  const { exigirEscritaLigada } = require(path.join(esc, 'escrita.flag'));
  const antes = { ...process.env };
  try {
    delete process.env.GESTAO_FADAS_ESCRITA_ENABLED;
    const desligada = await new Promise((r) => exigirEscritaLigada({}, {}, r));
    assert.equal(desligada.statusCode, 404);
    assert.equal(desligada.dados.codigo, 'NOT_FOUND');
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true';
    process.env.FADAS_ENVIRONMENT = 'test';
    assert.equal(await new Promise((r) => exigirEscritaLigada({}, {}, r)), undefined);
    process.env.FADAS_ENVIRONMENT = 'production';
    assert.equal((await new Promise((r) => exigirEscritaLigada({}, {}, r))).statusCode, 404);
  } finally {
    for (const k of ['GESTAO_FADAS_ESCRITA_ENABLED', 'FADAS_ENVIRONMENT']) { if (antes[k] === undefined) delete process.env[k]; else process.env[k] = antes[k]; }
  }
});

teste('validação: dinheiro só em texto com 2 casas, campo desconhecido, chave, percentual e soma das parcelas', () => {
  const bad = (fn) => assert.throws(fn, (e) => e.statusCode === 400 && e.dados.codigo === 'INVALID_INPUT');
  assert.equal(validacao.corpoPercentual({ rate: '35', operationKey: 'k' }).rate, '35.00');
  bad(() => validacao.corpoPercentual({ rate: 35, operationKey: 'k' }));
  bad(() => validacao.corpoPercentual({ rate: '100.01', operationKey: 'k' }));
  bad(() => validacao.corpoPercentual({ rate: '35', operationKey: 'k', extra: 1 }));
  bad(() => validacao.corpoPercentual({ rate: '35', operationKey: ' k' }));
  bad(() => validacao.corpoCalendario({ schedule: { kind: 'monthdays', days: [5, 5], weekendPolicy: 'keep' }, operationKey: 'k' }));
  bad(() => validacao.corpoAbertura(corpoAbertura({ remainingBalance: 50 })));
  bad(() => validacao.corpoAbertura(corpoAbertura({ remainingBalance: '50.5' })));
  bad(() => validacao.corpoAbertura(corpoAbertura({ remainingBalance: '-0.00' })));
  bad(() => validacao.corpoAbertura(corpoAbertura({ settledThrough: '2026-10-02T07:00:00' })));
  const soma = corpoAbertura();
  soma.debts[0].installments[0].amount = '61.00';
  bad(() => validacao.corpoAbertura(soma));
  const antes = corpoAbertura();
  antes.debts[0].installments[0].date = '2026-10-04';
  bad(() => validacao.corpoAbertura(antes));
  bad(() => validacao.corpoConfirmar({ operationKey: 'k', x: 1 }));
  bad(() => validacao.corpoCorrecao(corpoAbertura()));
});

teste('serviço: 201/200 com os DTOs, validação 400 na mensagem de gravação, 409, 404 e 503 sem vazar SQL', async () => {
  const { banco, loja } = criarLoja();
  const lidos = [];
  const servico = criarServicoEscrita({
    store: loja, ator: () => ator, acordoLido: async (id) => { lidos.push(id); return { commission: { current: '35.00' } }; }, comNomes: async (r) => openingView(r),
    agora: () => new Date('2026-10-29T15:00:00Z'),
  });
  const req = (params, body) => ({ params, body });
  const acordo = await servico.percentual(req({ tarotId: '7' }, { rate: '35', reason: 'x', operationKey: 'p1' }));
  assert.equal(acordo.commission.current, '35.00');
  assert.deepEqual(lidos, ['7']);
  assert.equal(banco.t.gf_repasse_percentuais[0].vigente_desde, '2026-10-29 12:00:00', 'vigência é o agora de São Paulo, com espaço');
  const dto = await servico.rascunho(req({}, corpoAbertura()));
  assert.equal(dto.status, 'rascunho');
  assert.equal(dto.enteredBy.accountId, 'conta-1');
  assert.deepEqual(dto.debts[0].installments, [{ date: '2026-10-10', amount: '60.00' }, { date: '2026-11-10', amount: '40.00' }]);
  const conf = await servico.confirmar(req({ ref: dto.id }, { operationKey: 'c1' }));
  assert.equal(conf.status, 'confirmada');
  const corr = await servico.corrigir(req({ ref: dto.id }, { ...corpoAbertura({ operationKey: 'k2' }), reason: 'motivo' }));
  assert.equal(corr.revision, 2);
  assert.equal(corr.corrects, 1);

  const erro = async (p) => p.then(() => assert.fail('deveria recusar'), (e) => e);
  const e400 = await erro(servico.percentual(req({ tarotId: '007' }, { rate: '35', operationKey: 'k' })));
  assert.equal(e400.statusCode, 400);
  assert.equal(e400.message, 'Confira os dados informados e tente novamente.');
  assert.equal((await erro(servico.percentual(req({ tarotId: '7' }, { rate: '36', reason: 'x', operationKey: 'p1' })))).statusCode, 409);
  assert.equal((await erro(servico.confirmar(req({ ref: 'inexistente' }, { operationKey: 'c9' })))).statusCode, 404);
  assert.equal((await erro(servico.confirmar(req({ ref: dto.id }, { operationKey: 'c10' })))).statusCode, 400);
  const log = console.error;
  console.error = () => {};
  const quebra = traduzirErroEscrita(Object.assign(new Error("INSERT INTO gf_x VALUES ('segredo')"), { code: 'ER_X' }));
  console.error = log;
  assert.equal(quebra.statusCode, 503);
  assert.doesNotMatch(JSON.stringify([quebra.message, quebra.dados]), /INSERT|segredo/);
});

teste('tamanho: nenhum arquivo de escrita passa de 400 linhas (sem god files) e nenhum usa travessão', () => {
  for (const dir of [esc, raiz]) {
    for (const nome of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, nome), 'utf8');
      if (dir === esc) assert.ok(src.split('\n').length <= 400, nome);
      if (dir === esc) assert.ok(!src.includes(String.fromCharCode(8212)), `travessão em ${nome}`);
    }
  }
  assert.ok(!fs.readFileSync(__filename, 'utf8').includes(String.fromCharCode(8212)));
});

(async () => {
  for (const caso of pendentes) await caso();
  console.log(`\n${ok} verificações ok, ${falhas.length} falha(s). Nenhuma conexão com banco foi aberta.`);
  if (falhas.length) {
    console.log(`Falharam: ${falhas.join(' | ')}`);
    process.exit(1);
  }
  process.exit(0);
})();
