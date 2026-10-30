'use strict';

/**
 * Verificação da fatia Ficha da cliente (Maturacao/36): orientação financeira da supervisora, observações da cliente e busca/histórico do sistema novo.
 *   1) OFFLINE (sempre): os portes contra o ouro do CÓDIGO REAL do front (`apoio-gf-ficha/ouro.js`: `decideClientFinancialGuidance`,
 *      `appendClientNote`, `editClientNote`, `normalizeTextFormatting`; mutantes são recusados), a flag, 404 com a fatia desligada, 401 sem sessão e 405 com Allow.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_fch_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-ficha/filho.js e filho-busca.js (HTTP do gate, idempotência, 409, corrida, auditoria, perfis, busca e histórico) e apaga o banco.
 *   npm run verificar:gf-ficha            (completo)       node scripts/verificar-gf-ficha.js --offline   (sem banco; entra em verificar:legado)
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

async function offline() {
  console.log('Ouro do código real do front');
  await passo('os portes concordam com o front: orientação (todos os papéis, ações e estados), observações e formatação (ouro do código do front)', () => {
    const { verificar } = require('./apoio-gf-ficha/ouro');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 1500, `só ${saida.ok} conferências`);
    console.log(`        ouro ficha: ${saida.ok}/${saida.ok} conferências iguais`);
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { fichaLigada } = r('src/gestao-fadas/gate/rotas-ficha');
  const sessao = { status: 'absent' };
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
  const antes = process.env.GF_FATIA_FICHA;
  const CAMINHOS = ['/client-guidance', '/client-notes'];
  try {
    await passo('a flag só liga com "true"', () => {
      assert.equal(fichaLigada({ GF_FATIA_FICHA: 'true' }), true); assert.equal(fichaLigada({ GF_FATIA_FICHA: '1' }), false); assert.equal(fichaLigada({}), false);
    });
    delete process.env.GF_FATIA_FICHA;
    await passo('desligada: GET e PUT respondem 404 NOT_FOUND antes da sessão, com no-store', async () => {
      for (const c of CAMINHOS) for (const m of ['GET', 'PUT']) { const a = await chamar(m, c, m === 'GET' ? undefined : {}); assert.equal(a.status, 404, `${m} ${c}`); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store'); }
    });
    process.env.GF_FATIA_FICHA = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow antes da sessão', async () => {
      for (const c of CAMINHOS) {
        for (const m of ['GET', 'PUT']) { const a = await chamar(m, c, m === 'GET' ? undefined : {}); assert.equal(a.status, 401, `${m} ${c}`); assert.equal(a.j.error.code, 'SESSION_REQUIRED'); }
        const b = await chamar('DELETE', c); assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET, PUT');
      }
    });
    await passo('a sessão nativa anuncia clientFile só quando ligada (retrocompatível)', () => {
      const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.match(fonte, /fichaLigada\(env\) \? \{ clientFile: true \} : \{\}/);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_FICHA; else process.env.GF_FATIA_FICHA = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('fch');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    codigo = 0;
    for (const filho of ['filho.js', 'filho-busca.js']) {
      if (!require('fs').existsSync(path.join(__dirname, 'apoio-gf-ficha', filho))) continue;
      const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-ficha', filho)], extra);
      process.stdout.write(f.stdout);
      if (f.status !== 0) { process.stderr.write(f.stderr); codigo = f.status; }
    }
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_fch_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_fch_* restante).');
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
