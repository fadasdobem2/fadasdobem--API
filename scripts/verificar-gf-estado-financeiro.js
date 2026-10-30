'use strict';

/**
 * Verificação da fatia Estado financeiro (Maturacao/43).
 *   1) OFFLINE (sempre): os portes (`motivos-financeiros`, `adicionais`, `pendencias-adicional`, `log-operacional`) contra o ouro do CÓDIGO REAL do front
 *      (`apoio-gf-estado-financeiro/ouro.js`), a flag, 404 com a fatia desligada, 401 sem sessão, 405 com Allow e o anúncio da sessão.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_est_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-estado-financeiro/filho.js (HTTP do gate: motivos, adicionais, pendência addition:, trilha, auditoria) e apaga o banco.
 *   npm run verificar:gf-estado-financeiro   (completo)      node scripts/verificar-gf-estado-financeiro.js --offline   (sem banco; entra em verificar:legado)
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
  const mot = r('src/gestao-fadas/_comum/dominio/motivos-financeiros');
  const adi = r('src/gestao-fadas/_comum/dominio/adicionais');
  console.log('Ouro do código real do front');
  await passo('os portes concordam com o front: motivos (criar, revisar, validar, normalizar), adicionais (categoria, regra, ocorrência, quantidade), pendência addition: e a forma da trilha', () => {
    const { verificar } = require('./apoio-gf-estado-financeiro/ouro');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 5000, `só ${saida.ok} conferências`);
    const d = saida.detalhe;
    console.log(`        ouro estado financeiro: ${saida.ok}/${saida.ok} conferências iguais (${d.motivos} comandos de motivos, ${d.recusasMotivos} recusas com a mesma frase; ${d.adicionais} comandos de adicionais, ${d.recusasAdicionais} recusas; ${d.pendencias} pendências addition:; ${d.lojas} armazéns adulterados; ${d.trilhas} trilhas)`);
  });
  console.log('Mutantes e forma');
  await passo('o que o front nunca produz é recusado: papel sem acesso, versão pulada, nome Outros, texto do extrato com campo estranho, ocorrência fora das datas', () => {
    const loja = { version: 1, reasons: mot.sementes() };
    assert.throws(() => mot.adicionar(loja, { id: 'a', scope: 'client', nature: 'payment', name: 'Novo' }, 'X', '2026-10-30T10:00:00.000Z', 'atendente'), /O cadastro de motivos está disponível/);
    assert.throws(() => mot.adicionar(loja, { id: 'a', scope: 'client', nature: 'payment', name: 'outros' }, 'X', '2026-10-30T10:00:00.000Z', 'administradora'), /Outros já está disponível/);
    assert.throws(() => mot.revisar(loja, 'financial-reason-charge', 7, { active: false }, 'X', '2026-10-30T10:00:00.000Z', 'administradora'), (e) => e.tipo === 'conflito');
    assert.equal(mot.lojaValida({ version: 1, reasons: [...loja.reasons, { ...loja.reasons[0], version: 3 }] }), false);
    const regra = { id: 'R', tarotId: '1', categoryId: 'monitoria', categoryName: 'Monitoria', value: { kind: 'fixed', amount: 5 }, frequency: 'weekly', startDate: '2026-10-30', description: '', history: [{ action: 'created', date: '2026-10-30', at: '2026-10-30T10:00:00.000Z', by: 'X' }] };
    const l2 = adi.adicionarRegra(adi.lojaVazia(), regra, '2026-10-30');
    assert.deepEqual(adi.datasDaRegra(regra, '2026-11-13'), ['2026-10-30', '2026-11-06', '2026-11-13']);
    assert.equal(adi.materializar(l2, [], '2026-11-06', '2026-11-06T10:00:00.000Z', 'X').loja.occurrences.length, 2);
    assert.equal(adi.numeroPtBr(1234.5, 2, 2), '1.234,50'); assert.equal(adi.numeroPtBr(3, 0, 3), '3'); assert.equal(adi.numeroPtBr(100000, 0, 3), '100.000');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { estadoFinanceiroLigado } = r('src/gestao-fadas/gate/rotas-estado-financeiro');
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'absent' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  };
  const ROTAS = [['GET', '/financial-reasons'], ['PUT', '/financial-reasons'], ['GET', '/payout-additions'], ['PUT', '/payout-additions'], ['GET', '/operation-audit'], ['POST', '/operation-audit']];
  const antes = process.env.GF_FATIA_ESTADO_FINANCEIRO;
  try {
    await passo('a flag só liga com "true"', () => {
      assert.equal(estadoFinanceiroLigado({ GF_FATIA_ESTADO_FINANCEIRO: 'true' }), true); assert.equal(estadoFinanceiroLigado({ GF_FATIA_ESTADO_FINANCEIRO: '1' }), false); assert.equal(estadoFinanceiroLigado({}), false);
    });
    delete process.env.GF_FATIA_ESTADO_FINANCEIRO;
    await passo('desligada: as seis rotas respondem 404 NOT_FOUND antes da sessão, com no-store', async () => {
      for (const [m, p] of ROTAS) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 404, `${m} ${p}`); assert.equal(a.j.error.code, 'NOT_FOUND'); assert.equal(a.h.get('cache-control'), 'no-store'); }
    });
    process.env.GF_FATIA_ESTADO_FINANCEIRO = 'true';
    await passo('ligada, sem sessão: 401 SESSION_REQUIRED; método errado: 405 com Allow antes da sessão', async () => {
      for (const [m, p] of ROTAS) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 401, `${m} ${p}`); assert.equal(a.j.error.code, 'SESSION_REQUIRED'); }
      assert.equal((await chamar('DELETE', '/financial-reasons')).h.get('allow'), 'GET, PUT'); assert.equal((await chamar('DELETE', '/payout-additions')).h.get('allow'), 'GET, PUT'); assert.equal((await chamar('PUT', '/operation-audit')).h.get('allow'), 'GET, POST');
    });
    await passo('a sessão nativa anuncia financialState só quando ligada (retrocompatível)', () => {
      const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.match(fonte, /estadoFinanceiroLigado\(env\) \? \{ financialState: true \} : \{\}/);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_ESTADO_FINANCEIRO; else process.env.GF_FATIA_ESTADO_FINANCEIRO = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('est');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-estado-financeiro', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_est_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_est_* restante).');
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
