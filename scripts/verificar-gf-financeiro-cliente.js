'use strict';

/**
 * Verificação da fatia Valores, Pagamentos e Restrições (Maturacao/29 seção 10).
 *   1) OFFLINE (sempre): o domínio financeiro portado contra o ouro do CÓDIGO REAL do front (`verificar-gf-financeiro.js`: saldo, lotes,
 *      cobertura do excesso, preços, restrições), a validação do recebimento e do benefício, as três flags, 404 com a fatia desligada, 401 sem
 *      sessão, 405 com Allow e o formato de erro do gate.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_pag_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-financeiro/filho.js (HTTP do gate, idempotência, 409, corrida, auditoria, perfis, saldo de partida congelado, conferência
 *      do excesso com saldo real, restrições, fontes do Painel) e apaga o banco. DB_* só no ambiente dos filhos; nunca lê o .env nem toca em
 *      outro banco. O legado MySQL nem é configurado (leitor falso).
 *   npm run verificar:gf-pagamentos            (completo)       node scripts/verificar-gf-financeiro-cliente.js --offline   (sem banco; entra em verificar:legado)
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
const dizErro = (fn, texto) => assert.throws(fn, (e) => String(e.message).includes(texto), `esperava "${texto}"`);

async function offline() {
  console.log('Ouro do código real do front');
  await passo('domínio financeiro, preços e restrições iguais ao código do front', () => {
    const saida = execFileSync(process.execPath, [path.join(__dirname, 'verificar-gf-financeiro.js')], { encoding: 'utf8' });
    assert.match(saida, /ouro financeiro: (\d+)\/\1 cenários iguais/);
  });

  console.log('Validação');
  const v = r('src/gestao-fadas/features/financeiro-cliente/pagamentos.validacao');
  const base = { id: 'p1', clientId: '900013', client: 'Cliente', amount: 88.8, method: 'PIX', informedAt: '2026-10-30T12:00:00.000Z', informedBy: 'x', status: 'Informado' };
  await passo('recebimento: forma aceita; centavos quebrados, método, status, cliente e pacote recusados', () => {
    v.forma(base);
    for (const ruim of [{ amount: 10.005 }, { amount: 0 }, { method: 'Bitcoin' }, { status: 'Qualquer' }, { clientId: 'abc' }, { clientId: '0' }, { confirmation: 'Talvez' }, { bank: 'Banco X' }, { paidAt: 'ontem' }]) {
      assert.throws(() => v.forma({ ...base, ...ruim }), (e) => e.status === 400 || e.statusCode === 400 || /Dados inválidos/.test(e.message), JSON.stringify(ruim));
    }
    dizErro(() => v.forma({ ...base, purchase: { minutes: 30, amount: 70, table: 'regular' } }), 'Confira os minutos comprados e o valor da compra.');
  });
  await passo('benefício: as regras de createMinuteBenefit, com as mensagens do front', () => {
    const b = { id: 'b1', clientId: '900013', kind: 'Cortesia', minutes: 15, unitValue: 2.96, reason: 'x' };
    v.beneficio(b);
    dizErro(() => v.beneficio({ ...b, minutes: 0 }), 'Informe de 1 a 1440 minutos inteiros.');
    dizErro(() => v.beneficio({ ...b, minutes: 1.5 }), 'Informe de 1 a 1440 minutos inteiros.');
    dizErro(() => v.beneficio({ ...b, kind: 'Crédito' }), 'Informe de 1 a 1440 minutos inteiros.');
    dizErro(() => v.beneficio({ ...b, reason: '  ' }), 'Informe o motivo do bônus ou da cortesia.');
    dizErro(() => v.beneficio({ ...b, unitValue: -1 }), 'Confira a referência do minuto.');
  });
  await passo('revisão: história só cresce, cancelado não reabre, movimento novo só do Financeiro', () => {
    const adm = { nome: 'Laya', p: { canViewAllPayments: true } }; const ate = { nome: 'Khloe', p: { canViewAllPayments: false } };
    const a = { ...base, audit: [{ id: 'a1', action: 'x', actor: 'a', createdAt: 't' }], movements: [] };
    dizErro(() => v.carimbarRevisao(a, { ...a, audit: [] }, adm, 'agora'), 'O histórico do pagamento não pode ser apagado.');
    dizErro(() => v.carimbarRevisao({ ...a, status: 'Cancelado' }, { ...a, status: 'Informado' }, adm, 'agora'), 'não pode ser reaberto');
    const mov = { id: 'm1', kind: 'refund', amount: 1, bankEffect: -1, creditEffect: -1, occurredAt: '2026-10-30T12:00:00.000Z', actor: 'x', note: '' };
    assert.throws(() => v.carimbarRevisao(a, { ...a, movements: [mov] }, ate, 'agora'), (e) => e.statusCode === 403 || e.status === 403 || /não está disponível/.test(e.message));
    const ok2 = v.carimbarRevisao(a, { ...a, movements: [mov] }, adm, '2026-10-30T13:00:00.000Z');
    assert.equal(ok2.movements[0].actor, 'Laya'); assert.equal(ok2.movements[0].recordedAt, '2026-10-30T13:00:00.000Z');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { precosLigado, pagamentosLigado, restricoesLigado } = r('src/gestao-fadas/gate/rotas-financeiro');
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
  const FLAGS = ['GF_FATIA_PRECOS', 'GF_FATIA_PAGAMENTOS', 'GF_FATIA_RESTRICOES'];
  const antes = Object.fromEntries(FLAGS.map((f) => [f, process.env[f]]));
  try {
    await passo('cada flag lida do seu nome (só "true" liga)', () => {
      assert.equal(precosLigado({ GF_FATIA_PRECOS: 'true' }), true); assert.equal(pagamentosLigado({ GF_FATIA_PAGAMENTOS: 'true' }), true); assert.equal(restricoesLigado({ GF_FATIA_RESTRICOES: 'true' }), true);
      assert.equal(precosLigado({ GF_FATIA_PRECOS: '1' }), false); assert.equal(pagamentosLigado({}), false); assert.equal(restricoesLigado({ GF_FATIA_PAGAMENTOS: 'true' }), false);
    });
    for (const f of FLAGS) delete process.env[f];
    await passo('desligadas: /pricing, /payments e /restrictions respondem 404 NOT_FOUND antes da sessão, com no-store', async () => {
      for (const [m, p] of [['GET', '/pricing'], ['POST', '/pricing/versions'], ['GET', '/payments'], ['GET', '/payments/accounts?ids=1'], ['POST', '/payments'], ['POST', '/payments/benefits'], ['POST', '/payments/x/revise'], ['GET', '/restrictions'], ['PUT', '/restrictions/x']]) {
        const a = await chamar(m, p, m === 'GET' ? undefined : {});
        assert.equal(a.status, 404, `${m} ${p}`); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store');
      }
    });
    await passo('uma flag não liga as outras: só pagamentos ligada, preços e restrições seguem 404', async () => {
      process.env.GF_FATIA_PAGAMENTOS = 'true';
      assert.equal((await chamar('GET', '/pricing')).status, 404); assert.equal((await chamar('GET', '/restrictions')).status, 404);
      assert.equal((await chamar('GET', '/payments')).status, 401);
      delete process.env.GF_FATIA_PAGAMENTOS;
    });
    for (const f of FLAGS) process.env[f] = 'true';
    await passo('ligadas, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow antes da sessão', async () => {
      for (const p of ['/pricing', '/payments', '/payments/accounts?ids=1', '/restrictions']) { const a = await chamar('GET', p); assert.equal(a.status, 401, p); assert.equal(a.j.error.code, 'SESSION_REQUIRED'); }
      const b = await chamar('DELETE', '/pricing'); assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET');
      const c = await chamar('GET', '/payments/benefits'); assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'POST');
      const d = await chamar('POST', '/restrictions/x'); assert.equal(d.status, 405); assert.equal(d.h.get('allow'), 'PUT');
      const e = await chamar('PUT', '/payments'); assert.equal(e.status, 405); assert.equal(e.h.get('allow'), 'GET, POST');
    });
    await passo('perfil sem a capacidade leva 403 ACCESS_DENIED no formato da B (taróloga em pagamentos e preços)', async () => {
      sessao = { status: 'identity', identity: { userId: 'u-1', role: 'tarologa', displayName: 'T', tarotId: '9001' }, sessionId: 's1' };
      for (const [m, p] of [['GET', '/pricing'], ['GET', '/payments'], ['POST', '/payments']]) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 403, `${m} ${p}`); assert.equal(a.j.error.code, 'ACCESS_DENIED'); }
      sessao = { status: 'identity', identity: { userId: 'u-2', role: 'atendente', displayName: 'A' }, sessionId: 's2' };
      const x = await chamar('POST', '/pricing/versions', {}); assert.equal(x.status, 403);
    });
    await passo('a sessão nativa anuncia pricing, payments e restrictions só quando ligados (retrocompatível)', async () => {
      const { criarProvedorNativo } = r('src/gestao-fadas/gate/sessao-nativa');
      assert.equal(typeof criarProvedorNativo, 'function');
      const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.match(fonte, /precosLigado\(env\) \? \{ pricing: true \} : \{\}/); assert.match(fonte, /pagamentosLigado\(env\) \? \{ payments: true \} : \{\}/); assert.match(fonte, /restricoesLigado\(env\) \? \{ restrictions: true \} : \{\}/);
    });
  } finally {
    for (const f of FLAGS) { if (antes[f] === undefined) delete process.env[f]; else process.env[f] = antes[f]; }
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('pag');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-financeiro', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_* restante).');
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
