'use strict';

/**
 * Verificação da fatia Ponto, Escala e calendário da operação (v702/v706 da Nice; pacote da Nice, docs/banco/17_Ponto_Escala_Atividade_v702.md).
 *   1) OFFLINE (sempre): o domínio do servidor (`ponto-turno`, `ponto-escala`, `ponto-jornada`, `operacao-calendario`, `escala-registro`) responde IGUAL ao
 *      código real do front em todos os casos do OURO (`gerar-ouro-gf-ponto.js`), cada mutante do fonte é pego pelo ouro, o ouro cobre as bordas
 *      que importam, e o gate: flag, sem sessão (401 em TEXTO, como o front lê), método, availability público.
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_pon_<aleatório>` em localhost:5432, migra por run-migrations, roda
 *      scripts/apoio-gf-ponto/filho.js (HTTP do gate: ponto, escala, equipe, diário, auditoria) e apaga o banco no fim.
 *   npm run verificar:gf-ponto            (completo)       node scripts/verificar-gf-ponto.js --offline   (sem banco; entra em verificar:legado)
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');
const { ouro, DOM, carregarMutante, fnsDoServidor, compararOuro, mutantePresenca, MUTANTES } = require('./apoio-gf-ponto/comparar');

const raiz = path.join(__dirname, '..');
let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}

async function offline() {
  console.log('Domínio contra o ouro do front');
  const relogio = Date.now; Date.now = () => { throw new Error('Date.now() chamado dentro da regra: o relógio tem de ser injetado'); };
  let resultado;
  try { resultado = compararOuro(fnsDoServidor()); } finally { Date.now = relogio; }
  await passo(`ponto, escala, calendário, registro e jornada idênticos ao front (${JSON.stringify(resultado.contagem)})`, () => {
    if (resultado.falhas.length) throw new Error(`${resultado.falhas.length} divergências; a primeira: ${resultado.falhas[0]}`);
  });
  await passo('o ouro cobre recusas, os quatro estados do turno, domingo fechado, retorno e janela confirmada', () => {
    const erros = new Set(); const estados = new Set(); const origens = new Set(); let fechados = 0;
    for (const t of ouro.turno) for (const p of t.esperado) { if (p.r.erro) erros.add(p.r.erro); if (p.estado) estados.add(p.estado); }
    for (const g of ouro.registro) for (const d of g.esperado.porData) { origens.add(d.origem); if (d.fechado) fechados += 1; }
    assert.ok(erros.size >= 4 && ['working', 'paused', 'ended', 'unconfirmed'].every((e) => estados.has(e)), `${[...erros]} ${[...estados]}`);
    assert.ok(fechados > 50 && ['Horário confirmado', 'Retorno informado', 'Escala informada', 'Ausência informada', 'Horário habitual', 'Horário informado'].every((o) => origens.has(o)), [...origens].join());
    assert.ok(ouro.calendario.grupo.casos.length > 300 && ouro.jornada.length > 100 && ouro.escala.length > 250);
  });
  console.log('Mutantes do servidor (o ouro tem de pegar cada um)');
  for (const [arquivo, de, para, modulo] of MUTANTES) {
    await passo(`mutante pego: ${arquivo}: ${de.slice(0, 60)}`, () => {
      const mut = carregarMutante(`${DOM}/${arquivo}`, de, para);
      const r = compararOuro(fnsDoServidor({ [modulo]: mut }), { parar: true });
      assert.ok(r.falhas.length > 0, 'o ouro não percebeu a troca');
    });
  }
  await passo('mutante pego: presenca-agenda.js: versão do horário habitual por vigência', () => {
    const r = compararOuro(fnsDoServidor({ 'escala-registro': mutantePresenca() }), { parar: true });
    assert.ok(r.falhas.length > 0);
  });
  console.log('Arquivos pequenos (um assunto por arquivo)');
  await passo('cada arquivo novo do domínio e da fatia tem menos de 300 linhas', () => {
    const fs = require('fs');
    for (const f of ['ponto-turno', 'ponto-escala', 'ponto-jornada', 'operacao-calendario', 'escala-registro']) assert.ok(fs.readFileSync(path.join(raiz, DOM, `${f}.js`), 'utf8').split('\n').length < 300, f);
    for (const f of fs.readdirSync(path.join(raiz, 'src/gestao-fadas/features/ponto'))) assert.ok(fs.readFileSync(path.join(raiz, 'src/gestao-fadas/features/ponto', f), 'utf8').split('\n').length < 300, f);
  });

  console.log('Gate');
  const { criarRotasPonto, pontoLigado } = require(path.join(raiz, 'src/gestao-fadas/gate/rotas-ponto'));
  let sessao = { status: 'absent' };
  const app = express();
  app.use('/api', criarRotasPonto({ validar: async () => sessao }));
  app.use((req, res) => res.status(404).json({ doFront: true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((f) => srv.once('listening', f));
  const chamar = async (metodo, q) => { const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api/staff-clock?resource=${q}`, { method: metodo }); const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ } return { status: resp.status, j, h: resp.headers }; };
  const antes = process.env.GF_FATIA_PONTO;
  try {
    await passo('flag lida de GF_FATIA_PONTO (só "true" liga)', () => {
      assert.equal(pontoLigado({ GF_FATIA_PONTO: 'true' }), true); assert.equal(pontoLigado({ GF_FATIA_PONTO: '1' }), false); assert.equal(pontoLigado({}), false);
    });
    delete process.env.GF_FATIA_PONTO;
    await passo('fatia desligada: passa adiante para a rota do front (nem a sessão é consultada)', async () => {
      const x = await chamar('GET', 'availability'); assert.equal(x.status, 404); assert.equal(x.j.doFront, true);
    });
    process.env.GF_FATIA_PONTO = 'true';
    await passo('ligada: availability público; sem sessão 401 com o erro em TEXTO (o front lê `error` como string); método fora do contrato 405', async () => {
      const a = await chamar('GET', 'availability'); assert.equal(a.status, 200); assert.deepEqual(a.j, { enabled: true }); assert.equal(a.h.get('cache-control'), 'no-store');
      const b = await chamar('GET', 'current'); assert.equal(b.status, 401); assert.equal(typeof b.j.error, 'string');
      const c = await chamar('DELETE', 'current'); assert.equal(c.status, 405); assert.equal(c.j.error, 'Método não permitido.'); assert.match(c.h.get('allow'), /GET/);
      sessao = { status: 'invalid' }; assert.equal((await chamar('GET', 'session')).status, 401);
      sessao = { status: 'access-unavailable' }; assert.equal((await chamar('GET', 'session')).status, 403);
    });
    await passo('recepção do diário sem token configurado: 503 em texto, antes de qualquer sessão', async () => {
      delete process.env.STAFF_ACTIVITY_INGEST_TOKEN;
      const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api/staff-clock?resource=ingest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(resp.status, 503); assert.match((await resp.json()).error, /não configurada/);
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_PONTO; else process.env.GF_FATIA_PONTO = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('pon');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-ponto', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_pon_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_pon_* restante).');
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
