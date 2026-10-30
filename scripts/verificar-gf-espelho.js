'use strict';

/**
 * Verificação do ESPELHO ENDURECIDO (órfãs/atomicidade; Maturacao/37). Sem tocar no legado real em nenhum momento.
 *   1) OFFLINE (sempre): chave natural, detalhe com chave (limite de 300), allowlist da leitura de candidatas, flag desligada.
 *   2) POSTGRES DESCARTÁVEL `fdb_esp_*` (sem `--offline`): migra e roda apoio-gf-espelho/filho.js com um legado FALSO em memória que
 *      interpreta o SQL EXATO da allowlist (falha antes do INSERT, queda entre INSERT e vínculo, reexecução, duplicata evitada).
 *   A prova contra o MySQL de dev (cópia temporária InnoDB) é `npm run ensaiar:gf-legado-consulta`.
 *   npm run verificar:gf-espelho            node scripts/verificar-gf-espelho.js --offline
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0; const falhas = [];
async function passo(nome, fn) { try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); } }

async function offline() {
  const legado = r('src/gestao-fadas/legado-escrita');
  const { T, iniciada, base } = require('./apoio-gf-consulta/cenarios');
  const { chaveDaIntencao, serializar, lerDoDetalhe, detalheComChave } = legado.chave;
  console.log('Chave natural da intenção');
  await passo('a chave usa cliente, tarotId, dtConsulta e iniConsulta do mesmo mapeamento do INSERT', () => {
    const it = iniciada({ clientId: '900013' });
    const k = chaveDaIntencao(it, new Date(T(5)));
    const linha = legado.mapeamento.linhaDoLegado(it, 7, new Date(T(5))).colunas;
    assert.equal(k.idUsuario, linha.idUsuario); assert.equal(k.dtConsulta, linha.dtConsulta); assert.equal(k.iniConsulta, linha.iniConsulta); assert.equal(k.tarotId, 'osiris');
  });
  await passo('serializa e lê de volta; detalhe nunca passa de 300 e a chave nunca é truncada', () => {
    const k = chaveDaIntencao(base(), new Date(T(5)));
    assert.deepEqual(lerDoDetalhe(`algo ${serializar(k)}`), k);
    const d = detalheComChave('x'.repeat(500), k); assert.ok(d.length <= 300); assert.deepEqual(lerDoDetalhe(d), k);
    assert.equal(lerDoDetalhe('sem chave'), null); assert.equal(lerDoDetalhe('#k=1|a|2026-01-01'), null); assert.equal(lerDoDetalhe(null), null);
    assert.equal(detalheComChave('só texto', null), 'só texto');
  });
  await passo('data inválida na intenção lança MapeamentoError (quem registra a intenção não derruba a consulta)', () => {
    assert.throws(() => chaveDaIntencao(base({ startedAt: 'ontem', sentToTarologistAt: undefined })), legado.mapeamento.MapeamentoError);
  });
  console.log('Leitura de candidatas e allowlist');
  await passo('SELECT_CANDIDATAS é leitura com `?` e está na allowlist; variação do texto continua recusada', () => {
    const s = legado.sql;
    assert.equal(s.motivoDeRecusa(s.SELECT_CANDIDATAS), null); assert.match(s.SELECT_CANDIDATAS, /^SELECT idConsulta FROM tbl_consultas WHERE idUsuario = \? AND idTarologo = \? AND dtConsulta = \? AND iniConsulta = \?/);
    assert.ok(s.motivoDeRecusa(`${s.SELECT_CANDIDATAS}; DELETE FROM tbl_consultas`)); assert.ok(s.motivoDeRecusa('SELECT idConsulta FROM tbl_consultas')); assert.ok(s.motivoDeRecusa('DELETE FROM tbl_consultas WHERE idConsulta = 1'));
  });
  await passo('buscarCandidatas só passa os 4 valores da chave e devolve ids em texto', async () => {
    const vistos = []; const ex = { execute: async (q, v) => { vistos.push([q, v]); return [[{ idConsulta: 5 }, { idConsulta: 9 }]]; } };
    assert.deepEqual(await legado.consultas.buscarCandidatas(ex, { idUsuario: 1, idTarologo: 2, dtConsulta: 'a', iniConsulta: 'b', extra: 'x' }), ['5', '9']);
    assert.deepEqual(vistos[0], [legado.sql.SELECT_CANDIDATAS, [1, 2, 'a', 'b']]);
  });
  await passo('reconciliação com a flag desligada não faz nada (nem abre conexão)', async () => {
    delete process.env.GF_LEGADO_ESCRITA_ENABLED;
    const rec = r('src/gestao-fadas/features/consultas-ciclo/ciclo.reconciliacao');
    const x = await rec.reconciliar({ refazer: async () => { throw new Error('não podia chamar'); } });
    assert.equal(x.desligado, true); assert.equal(x.examinadas, 0); assert.equal(rec.agendar({}), null);
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('esp');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-espelho', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_esp_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_esp_* restante).');
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
