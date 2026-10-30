'use strict';

/**
 * Verificação da fatia Horários e escala (Maturacao/28 seção 5; padrão em Maturacao/29).
 *   1) OFFLINE (sempre): domínio puro (precedência por intervalo, preservar trechos, revisão), validação das entradas com as
 *      mensagens do front, flag da fatia, gate desligado = 404, 401 sem sessão, 405 com Allow, formato de erro da B.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_hor_<aleatório>` em localhost:5432, migra por run-migrations,
 *      roda scripts/apoio-gf-horarios/filho.js (HTTP do gate, idempotência, 409, auditoria, perfis) e apaga o banco no fim.
 *      DB_* só no ambiente dos filhos; nunca lê o .env nem toca em outro banco.
 *   npm run verificar:gf-horarios            (completo)       node scripts/verificar-gf-horarios.js --offline   (sem banco; entra em verificar:legado)
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
const rejeita = (fn, status, codigo) => assert.throws(fn, (e) => e.statusCode === status && e.dados.codigo === codigo, `esperava ${status} ${codigo}`);

async function offline() {
  const dom = r('src/gestao-fadas/_comum/dominio/horarios');
  const val = r('src/gestao-fadas/features/horarios/horarios.validacao');
  const base = { todayHours: '9h às 15h', periods: [{ start: '09:00', end: '15:00' }], note: '', updatedAt: '2026-11-01T10:00:00', absenceType: 'Nenhuma' };
  const reg = (ini, fim, extra = {}) => ({ ...base, startDate: ini, endDate: fim, ...extra });

  console.log('Domínio');
  await passo('dia único grava a chave tarot@data e o intervalo, tarot@ini..fim', () => {
    const a = dom.guardarExcecao({}, 'osiris', reg('2026-11-05', '2026-11-05'));
    assert.deepEqual(Object.keys(a), ['osiris@2026-11-05']);
    assert.deepEqual(Object.keys(dom.guardarExcecao({}, 'osiris', reg('2026-11-05', '2026-11-07'))), ['osiris@2026-11-05..2026-11-07']);
  });
  await passo('intervalo novo no meio de outro preserva as duas pontas do antigo (e as notas do período original)', () => {
    const antigo = dom.guardarExcecao({}, 'osiris', reg('2026-11-10', '2026-11-20', { updatedAt: 'a' }));
    const n = dom.guardarExcecao(antigo, 'osiris', reg('2026-11-14', '2026-11-15', { updatedAt: 'b' }));
    assert.deepEqual(Object.keys(n).sort(), ['osiris@2026-11-10..2026-11-13', 'osiris@2026-11-14..2026-11-15', 'osiris@2026-11-16..2026-11-20']);
    assert.equal(n['osiris@2026-11-16..2026-11-20'].noteStartDate, '2026-11-10');
    assert.equal(n['osiris@2026-11-16..2026-11-20'].noteEndDate, '2026-11-20');
  });
  await passo('exceção de outro tarólogo e dia fora do intervalo não são tocados', () => {
    const m = { ...dom.guardarExcecao({}, 'nyx', reg('2026-11-05', '2026-11-05')), ...dom.guardarExcecao({}, 'osiris', reg('2026-11-30', '2026-11-30')) };
    const n = dom.guardarExcecao(m, 'osiris', reg('2026-11-01', '2026-11-10'));
    assert.ok(n['nyx@2026-11-05'] && n['osiris@2026-11-30'] && n['osiris@2026-11-01..2026-11-10']);
  });
  await passo('replaceKey tira o registro original (editor completo move ou encurta o seu)', () => {
    const m = dom.guardarExcecao({}, 'osiris', reg('2026-11-05', '2026-11-05'));
    const n = dom.guardarExcecao(m, 'osiris', reg('2026-11-06', '2026-11-06'), 'osiris@2026-11-05');
    assert.deepEqual(Object.keys(n), ['osiris@2026-11-06']);
  });
  await passo('revisão: estável, independe da ordem e muda com o conjunto', () => {
    assert.equal(dom.revisaoDe(['a', 'b']), dom.revisaoDe(['b', 'a']));
    assert.notEqual(dom.revisaoDe(['a']), dom.revisaoDe(['a', 'b']));
    assert.notEqual(dom.revisaoDe([]), dom.revisaoDe(['a']));
  });

  console.log('Validação (mensagens do front)');
  const corpo = (o, extra = {}) => ({ operationKey: 'chave-0001', expectedRevision: 'x', override: o, ...extra });
  await passo('aceita 1 a 3 períodos, virada às 06h e ausência sem períodos', () => {
    val.corpoExcecao(corpo(reg('2026-11-05', '2026-11-05', { periods: [{ start: '22:00', end: '06:00' }] })));
    val.corpoExcecao(corpo(reg('2026-11-05', '2026-11-05', { periods: [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '15:00' }, { start: '16:00', end: '18:00' }] })));
    val.corpoExcecao(corpo(reg('2026-11-05', '2026-11-06', { absenceType: 'Férias', todayHours: 'Férias', periods: [] })));
  });
  await passo('períodos iguais, sobrepostos, saída antes da entrada e horário mal formado: 422 RULE_VIOLATION', () => {
    const p = (periods) => () => val.corpoExcecao(corpo(reg('2026-11-05', '2026-11-05', { periods })));
    rejeita(p([{ start: '09:00', end: '09:00' }]), 422, 'RULE_VIOLATION');
    rejeita(p([{ start: '09:00', end: '12:00' }, { start: '11:00', end: '13:00' }]), 422, 'RULE_VIOLATION');
    rejeita(p([{ start: '15:00', end: '09:00' }]), 422, 'RULE_VIOLATION');
    rejeita(p([{ start: '9h', end: '12:00' }]), 422, 'RULE_VIOLATION');
  });
  await passo('data inválida, fim antes do início, ausência desconhecida, 4 períodos (422 do front), chave curta: 400/422', () => {
    rejeita(() => val.corpoExcecao(corpo(reg('2026-02-30', '2026-02-30'))), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoExcecao(corpo(reg('2026-11-06', '2026-11-05'))), 422, 'RULE_VIOLATION');
    rejeita(() => val.corpoExcecao(corpo(reg('2026-11-05', '2026-11-05', { absenceType: 'Sumiu' }))), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoExcecao(corpo(reg('2026-11-05', '2026-11-05', { periods: Array(4).fill({ start: '09:00', end: '10:00' }) }))), 422, 'RULE_VIOLATION'); // "Informe de um a três períodos." (Maturacao/44)
    rejeita(() => val.corpoExcecao({ ...corpo(reg('2026-11-05', '2026-11-05')), operationKey: 'curta' }), 400, 'INVALID_INPUT');
    rejeita(() => val.corpoExcecao({ operationKey: 'chave-0001', expectedRevision: 'x' }), 400, 'INVALID_INPUT');
  });
  await passo('semanal: texto de horário ou folga; dia desconhecido e texto livre recusados', () => {
    val.corpoSemanal({ operationKey: 'chave-0001', weeklySchedule: { segunda: '9h às 15h · 16h às 22h', domingo: 'Folga' } });
    rejeita(() => val.corpoSemanal({ operationKey: 'chave-0001', weeklySchedule: { segunda: 'qualquer coisa' } }), 422, 'RULE_VIOLATION');
    rejeita(() => val.corpoSemanal({ operationKey: 'chave-0001', weeklySchedule: { feriado: '9h às 10h' } }), 400, 'INVALID_INPUT');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { horariosLigado } = r('src/gestao-fadas/gate/rotas-horarios');
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => sessao }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const url = (p) => `http://127.0.0.1:${srv.address().port}/api${p}`;
  const chamar = async (metodo, p, corpoJson) => {
    const resp = await fetch(url(p), { method: metodo, headers: { 'content-type': 'application/json' }, body: corpoJson === undefined ? undefined : JSON.stringify(corpoJson) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const antes = process.env.GF_FATIA_HORARIOS;
  try {
    await passo('flag lida de GF_FATIA_HORARIOS (só "true" liga)', () => {
      assert.equal(horariosLigado({ GF_FATIA_HORARIOS: 'true' }), true);
      assert.equal(horariosLigado({ GF_FATIA_HORARIOS: '1' }), false);
      assert.equal(horariosLigado({}), false);
    });
    delete process.env.GF_FATIA_HORARIOS;
    await passo('fatia desligada: /schedules responde 404 NOT_FOUND no formato da B, antes da sessão', async () => {
      const x = await chamar('GET', '/schedules');
      assert.equal(x.status, 404); assert.equal(x.j.error.code, 'NOT_FOUND'); assert.equal(x.h.get('cache-control'), 'no-store');
    });
    process.env.GF_FATIA_HORARIOS = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow (antes da sessão)', async () => {
      const a = await chamar('GET', '/schedules');
      assert.equal(a.status, 401); assert.equal(a.j.error.code, 'SESSION_REQUIRED');
      const b = await chamar('POST', '/schedules');
      assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET');
      const c = await chamar('GET', '/schedules/osiris/overrides');
      assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'PUT');
    });
    await passo('perfil sem conta de equipe nem tarotId (taróloga sem vínculo): 403 ACCESS_DENIED', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'Osíris' }, sessionId: 's1' };
      const a = await chamar('GET', '/schedules');
      assert.equal(a.status, 403); assert.equal(a.j.error.code, 'ACCESS_DENIED');
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_HORARIOS; else process.env.GF_FATIA_HORARIOS = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('hor');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-horarios', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_hor_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_hor_* restante).');
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
