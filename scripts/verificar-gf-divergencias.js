'use strict';

/**
 * Verificação da fatia Divergências (Maturacao/31).
 *   1) OFFLINE (sempre): o domínio portado contra o ouro do CÓDIGO REAL do front (`apoio-gf-divergencias/ouro.js`: tudo o que
 *      `changeReaderDivergence`, `appendDivergenceComment` e `clearReaderDivergenceTrash` produzem é aceito; mutantes são recusados;
 *      visibilidade da taróloga), forma, criação, transições da equipe, carimbo, a flag, 404 com a fatia desligada, 401 sem sessão e 405 com Allow.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_div_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-divergencias/filho.js (HTTP do gate, idempotência, 409, corrida, auditoria, perfis, vínculos, fontes do Painel) e apaga o banco.
 *   npm run verificar:gf-divergencias            (completo)       node scripts/verificar-gf-divergencias.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}
const recusa = (fn, texto) => assert.throws(fn, (e) => e.name === 'DivergenciaInvalidaError' && (!texto || String(e.message).includes(texto)), `esperava recusa "${texto || ''}"`);

async function offline() {
  const dom = r('src/gestao-fadas/_comum/dominio/divergencias');
  const base = { id: 'DIV-1', kind: 'Operacional', area: 'Consulta', issueType: 'Outro', clientId: '900013', client: 'Cliente', tarotId: '9001', tarot: 'Osíris', reporterTarotId: '9001', reason: 'Conferir.', status: 'Pendente', reportedBy: 'Osíris', createdAt: '2026-10-30T12:00:00.000Z' };
  const tar = { tarologa: true, proprio: '9001', p: {} };
  const eq = { tarologa: false, proprio: '', p: { canViewDivergences: true, canViewFinancialDivergences: true, canManageConsultations: true } };

  console.log('Ouro do código real do front');
  await passo('o porte aceita tudo o que o front produz e recusa os mutantes (ouro gerado do código do front)', () => {
    const { verificar } = require('./apoio-gf-divergencias/ouro');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 1000, `só ${saida.ok} conferências`);
    console.log(`        ouro divergências: ${saida.ok}/${saida.ok} conferências iguais`);
  });

  await passo('a decisão (consulta ausente no futuro, minutagem e efeitos da resolução) concorda com o front (ouro do código do front)', () => {
    const { verificar } = require('./apoio-gf-divergencias/ouro-decisao');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 3000, `só ${saida.ok} conferências`);
    console.log(`        ouro decisão: ${saida.ok}/${saida.ok} conferências iguais`);
  });
  console.log('Forma, criação e transições');
  await passo('forma: aceita o registro do front; recusa tipo, área, situação, assunto, cliente, razão e data ruins', () => {
    dom.forma(base);
    for (const ruim of [{ kind: 'Outra' }, { area: 'Banco' }, { status: 'Qualquer' }, { issueType: 'X' }, { clientId: 'abc' }, { clientId: '0' }, { reason: '  ' }, { reason: 'x'.repeat(4001) }, { createdAt: 'ontem' }, { kind: 'Operacional', area: 'Pagamento' }, { amount: -1 }, { history: [{ id: 'h' }] }, { comments: [{ id: 'c', at: '2026-10-30T12:00:00.000Z', actor: 'a', text: 't', source: 'outro' }] }]) recusa(() => dom.forma({ ...base, ...ruim }));
    dom.forma({ ...base, clientId: '', clientIdentificationPending: true });
  });
  await passo('criação: a taróloga cria Operacional dela Pendente; em nome de outra, resolvida ou com histórico é recusado; a equipe só cria Financeira', () => {
    dom.conferirCriacao(base, tar);
    recusa(() => dom.conferirCriacao({ ...base, tarotId: '9002' }, tar), 'em seu nome'); recusa(() => dom.conferirCriacao({ ...base, reporterTarotId: '9002' }, tar), 'em seu nome');
    recusa(() => dom.conferirCriacao({ ...base, kind: 'Financeira', area: 'Consulta' }, tar), 'em seu nome');
    recusa(() => dom.conferirCriacao({ ...base, status: 'Resolvida' }, tar)); recusa(() => dom.conferirCriacao({ ...base, history: [] , deletedAt: '2026-10-30T12:00:00.000Z' }, tar));
    recusa(() => dom.conferirCriacao(base, eq), 'financeiras'); dom.conferirCriacao({ ...base, kind: 'Financeira', tarotId: '9002', reporterTarotId: undefined }, eq);
  });
  await passo('repetida: mesmo assunto aberto da mesma consulta, ou a mesma consulta ausente, é recusado com a frase do front', () => {
    const c = { ...base, consultationId: 'C-1', id: 'DIV-2' };
    assert.equal(dom.repetida(c, [{ ...base, consultationId: 'C-1' }], '9001'), 'Essa divergência já está aguardando análise.');
    assert.equal(dom.repetida(c, [{ ...base, consultationId: 'C-2' }], '9001'), null);
    assert.equal(dom.repetida(c, [{ ...base, consultationId: 'C-1', status: 'Resolvida' }], '9001'), null);
    const a = { ...base, issueType: 'Consulta ausente', reportedDate: '2026-10-29', reportedTime: '10:00', id: 'DIV-3' };
    assert.match(dom.repetida(a, [{ ...a, id: 'DIV-4' }], '9001'), /pedido de conferência aberto/);
    assert.equal(dom.repetida(a, [{ ...a, id: 'DIV-4', reportedTime: '11:00' }], '9001'), null);
  });
  await passo('equipe: Pendente a Em conferência, depois Resolvida só com decisão e autor; comentário só da equipe; arquivada e excluída não mudam', () => {
    const rev = { ...base, status: 'Em conferência', updatedAt: '2026-10-30T13:00:00.000Z' };
    assert.equal(dom.conferirTransicao(base, rev, eq), 'conferencia');
    const res = { ...rev, status: 'Resolvida', resolvedBy: 'Clara', resolvedAt: '2026-10-30T14:00:00.000Z', decision: 'Conferido.', clientId: '900014' };
    assert.equal(dom.conferirTransicao(rev, res, eq), 'resolucao'); assert.equal(dom.conferirTransicao(base, res, eq), 'resolucao');
    recusa(() => dom.conferirTransicao(rev, { ...res, decision: '' }, eq), 'decisão'); recusa(() => dom.conferirTransicao(res, { ...res, status: 'Em conferência' }, eq));
    recusa(() => dom.conferirTransicao(base, { ...rev, reason: 'Outra' }, eq)); recusa(() => dom.conferirTransicao(base, { ...rev, tarotId: '9009' }, eq));
    recusa(() => dom.conferirTransicao(base, { ...rev, comments: [{ id: 'c', at: '2026-10-30T13:00:00.000Z', actor: 'a', text: 't', source: 'tarologist' }] }, eq), 'comentar');
    assert.equal(dom.conferirTransicao(base, { ...base, comments: [{ id: 'c', at: '2026-10-30T13:00:00.000Z', actor: 'a', text: 't', source: 'staff' }] }, eq), 'comentario');
    const arq = { ...base, status: 'Arquivada', statusBeforeArchive: 'Pendente', archivedAt: '2026-10-30T13:00:00.000Z', archivedBy: 'Osíris', archiveReason: 'x' };
    recusa(() => dom.conferirTransicao(arq, { ...arq, status: 'Resolvida', resolvedBy: 'C', resolvedAt: '2026-10-30T14:00:00.000Z', decision: 'x' }, eq));
    recusa(() => dom.conferirTransicao({ ...base, deletedAt: '2026-10-30T13:00:00.000Z', deletedBy: 'Osíris', deleteReason: 'x' }, { ...base, deletedAt: undefined }, eq));
  });
  await passo('v706: cancelar substitui arquivar; só resolvida excluída se restaura; cancelada não é aberta; minutos iguais não editam', () => {
    const snap = (x) => ({ reason: x.reason, status: x.status });
    const ev = (acao, antes, depois) => [{ id: 'h', at: '2026-10-30T13:00:00.000Z', actor: 'Osíris', action: acao, before: snap(antes), after: snap(depois) }];
    const canc = { ...base, status: 'Arquivada', statusBeforeArchive: 'Pendente', readerCancelledAt: '2026-10-30T13:00:00.000Z', readerCancelledBy: 'Osíris', archivedAt: '2026-10-30T13:00:00.000Z', archivedBy: 'Osíris', history: ev('Pedido cancelado', base, { ...base, status: 'Arquivada' }) };
    assert.equal(dom.conferirTransicao(base, canc, tar), 'cancelamento'); assert.equal(dom.aberta(canc), false); assert.equal(dom.estado.aba(canc), 'excluidas');
    recusa(() => dom.conferirTransicao(base, { ...canc, history: ev('Retirada e arquivada', base, { ...base, status: 'Arquivada' }), readerCancelledAt: undefined, readerCancelledBy: undefined }, tar));
    recusa(() => dom.conferirTransicao(canc, { ...canc, reason: 'Editar', history: [...canc.history, ...ev('Relato editado', canc, canc)] }, tar), 'cancelado');
    const resolvida = { ...base, status: 'Resolvida', resolvedBy: 'Clara', resolvedAt: '2026-10-30T12:30:00.000Z', decision: 'Conferido.' };
    const excl = { ...resolvida, deletedAt: '2026-10-30T13:00:00.000Z', deletedBy: 'Osíris', deleteReason: 'Engano.' };
    const rest = { ...excl, deletedAt: undefined, deletedBy: undefined, deleteReason: undefined, history: ev('Restaurada', excl, resolvida) };
    assert.equal(dom.conferirTransicao(excl, rest, tar), 'restauracao');
    const abertaExcl = { ...base, deletedAt: '2026-10-30T13:00:00.000Z', deletedBy: 'Osíris', deleteReason: 'Engano.' };
    recusa(() => dom.conferirTransicao(abertaExcl, { ...base, history: ev('Restaurada', abertaExcl, base) }, tar), 'restaurar');
    recusa(() => dom.conferirTransicao({ ...canc, deletedAt: '2026-10-30T14:00:00.000Z', deletedBy: 'Osíris', deleteReason: 'x' }, { ...canc, history: ev('Restaurada', canc, canc) }, tar));
    const min = { ...base, issueType: 'Minutagem incorreta', recordedMinutes: 12, reportedMinutes: 30 };
    recusa(() => dom.conferirTransicao(min, { ...min, reportedMinutes: 12, history: ev('Relato editado', min, min) }, tar), 'Cancelar pedido');
    assert.equal(dom.conferirTransicao(min, { ...min, reportedMinutes: 45, history: ev('Relato editado', min, min) }, tar), 'edicao');
    assert.equal(dom.visivelDaTarologa({ ...base, deletedAt: '2026-10-30T13:00:00.000Z', readerTrashClearedAt: '2026-10-30T14:00:00.000Z' }, '9001'), false);
    assert.equal(dom.visivelDaTarologa({ ...canc, readerTrashClearedAt: '2026-10-30T14:00:00.000Z' }, '9001'), false);
  });
  await passo('Financeira: a equipe reescreve a aberta da mesma consulta (razão e autor novos) e não troca a consulta; resolver é decisão financeira', () => {
    const f = { ...base, kind: 'Financeira', area: 'Consulta', issueType: undefined, consultationId: 'C-1', reportedBy: 'Clara' };
    assert.equal(dom.conferirTransicao(f, { ...f, reason: 'Nova razão.', reportedBy: 'Laya', createdAt: '2026-10-30T15:00:00.000Z' }, eq), 'reescrita');
    assert.equal(dom.conferirTransicao({ ...f, status: 'Em conferência' }, { ...f, status: 'Pendente', reason: 'Nova razão.', createdAt: '2026-10-30T15:00:00.000Z' }, eq), 'reescrita');
    recusa(() => dom.conferirTransicao(f, { ...f, reason: 'Nova.', consultationId: 'C-2' }, eq));
    recusa(() => dom.conferirTransicao({ ...base, status: 'Em conferência' }, { ...base, status: 'Pendente' }, eq));
    assert.equal(dom.exigeResolver('resolucao'), true); assert.equal(dom.exigeResolver('reescrita'), false);
  });
  await passo('carimbo: o servidor troca instante e autor do que é novo e preserva o que já existia', () => {
    const antes = { ...base, history: [{ id: 'h0', at: '2026-10-30T12:30:00.000Z', actor: 'Osíris', action: 'Relato editado', before: { reason: 'a', status: 'Pendente' }, after: { reason: 'b', status: 'Pendente' } }] };
    const depois = { ...antes, status: 'Arquivada', statusBeforeArchive: 'Pendente', archivedAt: '2000-01-01T00:00:00.000Z', archivedBy: 'Hacker', archiveReason: 'x', updatedAt: '2000-01-01T00:00:00.000Z',
      history: [...antes.history, { id: 'h1', at: '2000-01-01T00:00:00.000Z', actor: 'Hacker', action: 'Retirada e arquivada', before: { reason: 'b', status: 'Pendente' }, after: { reason: 'b', status: 'Arquivada' } }] };
    const c = dom.carimbar(antes, depois, 'Osíris', '2026-10-31T00:00:00.000Z');
    assert.equal(c.archivedAt, '2026-10-31T00:00:00.000Z'); assert.equal(c.archivedBy, 'Osíris'); assert.equal(c.updatedAt, '2026-10-31T00:00:00.000Z');
    assert.equal(c.history[0].at, '2026-10-30T12:30:00.000Z'); assert.equal(c.history[1].actor, 'Osíris'); assert.equal(c.history[1].at, '2026-10-31T00:00:00.000Z');
    assert.equal(c.createdAt, base.createdAt); assert.equal(c.reportedBy, 'Osíris');
    const nova = dom.carimbar(null, { ...base, reportedBy: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }, 'Khloe', '2026-10-31T00:00:00.000Z');
    assert.equal(nova.createdAt, '2026-10-31T00:00:00.000Z'); assert.equal(nova.reportedBy, 'Khloe');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { divergenciasLigado } = r('src/gestao-fadas/gate/rotas-divergencias');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_DIVERGENCIAS;
  try {
    await passo('a flag só liga com "true"', () => {
      assert.equal(divergenciasLigado({ GF_FATIA_DIVERGENCIAS: 'true' }), true); assert.equal(divergenciasLigado({ GF_FATIA_DIVERGENCIAS: '1' }), false); assert.equal(divergenciasLigado({}), false); assert.equal(divergenciasLigado({ GF_FATIA_RESTRICOES: 'true' }), false);
    });
    delete process.env.GF_FATIA_DIVERGENCIAS;
    await passo('desligada: GET e PUT respondem 404 NOT_FOUND antes da sessão, com no-store', async () => {
      for (const [m, p] of [['GET', '/divergences'], ['PUT', '/divergences/x']]) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 404, `${m} ${p}`); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store'); }
    });
    process.env.GF_FATIA_DIVERGENCIAS = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow antes da sessão', async () => {
      for (const [m, p] of [['GET', '/divergences'], ['PUT', '/divergences/x']]) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 401, p); assert.equal(a.j.error.code, 'SESSION_REQUIRED'); }
      const b = await chamar('DELETE', '/divergences'); assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET');
      const c = await chamar('POST', '/divergences/x'); assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'PUT');
    });
    await passo('a sessão nativa anuncia divergences só quando ligada (retrocompatível)', () => {
      const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.match(fonte, /divergenciasLigado\(env\) \? \{ divergences: true \} : \{\}/);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_DIVERGENCIAS; else process.env.GF_FATIA_DIVERGENCIAS = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('div');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-divergencias', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_div_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_div_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
