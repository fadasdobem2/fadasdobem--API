'use strict';

/**
 * Verificação do LEGADO COMO FONTE (Maturacao/46): o campo que tem casa no legado é gravado no legado, dentro do pedido, antes do commit do Postgres.
 *   1) OFFLINE (sempre): a TRAVA DE BANCO (`GF_LEGADO_ESCRITA_BANCOS`: vazia = nenhuma escrita, banco fora da lista recusa a CADA escrita, produção e
 *      fadasdobem02 nunca valem), o modo e as flags, e os envs locais (a trava existe e nunca lista produção).
 *   2) POSTGRES DESCARTÁVEL `fdb_lf_*` (sem `--offline`): migra e roda apoio-gf-legado-fonte/filho.js (HTTP do gate + legado FALSO em memória).
 *   A prova contra o MySQL de dev (cópias temporárias InnoDB) é `npm run ensaiar:gf-legado-cadastros`.
 *   npm run verificar:gf-legado-fonte     node scripts/verificar-gf-legado-fonte.js --offline
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0; const falhas = [];
async function passo(nome, fn) { try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); } }

/** Conexão falsa: só responde `SELECT DATABASE()` e conta o que chega a ser executado. */
const conexaoFalsa = (banco) => { const c = { executadas: [], query: async (q) => { if (/SELECT DATABASE/i.test(q)) return [[{ banco }]]; return [[]]; }, execute: async (q) => { c.executadas.push(q); return [{ affectedRows: 1 }]; } }; return c; };

async function offline() {
  const legado = r('src/gestao-fadas/legado-escrita');
  const UPD = legado.sqlEntidades.updateCliente(['nome_id']);
  const salvo = process.env.GF_LEGADO_ESCRITA_BANCOS; const salvoPg = process.env.GESTAO_FADAS_ESCRITA_ENABLED; process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
  const com = async (lista, banco, fn) => { if (lista === undefined) delete process.env.GF_LEGADO_ESCRITA_BANCOS; else process.env.GF_LEGADO_ESCRITA_BANCOS = lista; const c = conexaoFalsa(banco); try { return await fn(legado.envolver(c), c); } finally { if (salvo === undefined) delete process.env.GF_LEGADO_ESCRITA_BANCOS; else process.env.GF_LEGADO_ESCRITA_BANCOS = salvo; } };
  const recusa = (x) => x && x.codigo === 'BANCO_NAO_AUTORIZADO' && /trava de banco/.test(x.message);

  console.log('Trava de banco (GF_LEGADO_ESCRITA_BANCOS)');
  await passo('padrão VAZIO (ou ausente) = nenhuma escrita: recusa com erro claro ANTES de executar', async () => {
    for (const lista of [undefined, '', '  ,  ']) await com(lista, 'fadasdobem01', async (ex, c) => { await assert.rejects(() => ex.execute(UPD, ['A', 1]), recusa); assert.equal(c.executadas.length, 0); });
  });
  await passo('banco conectado fora da lista: recusa a escrita (o nome vem de SELECT DATABASE(), não da configuração)', async () => {
    await com('fadasdobem01', 'banco_descartavel_fake', async (ex, c) => { await assert.rejects(() => ex.execute(UPD, ['A', 1]), (x) => recusa(x) && /banco_descartavel_fake/.test(x.message)); assert.equal(c.executadas.length, 0); });
    await com('fadasdobem01', '', async (ex) => { await assert.rejects(() => ex.execute(UPD, ['A', 1]), recusa); });
  });
  await passo('banco na lista: a escrita passa (sem diferenciar maiúsculas); leitura não pede a trava', async () => {
    await com('fadasdobem01', 'fadasdobem01', async (ex, c) => { await ex.execute(UPD, ['A', 1]); assert.equal(c.executadas.length, 1); });
    await com(' Outro_Dev , FADASDOBEM01 ', 'fadasdobem01', async (ex, c) => { await ex.execute(UPD, ['A', 1]); assert.equal(c.executadas.length, 1); });
    await com(undefined, 'fadasdobem01', async (ex, c) => { await ex.execute(legado.sqlEntidades.SELECT_CLIENTE, [1]); assert.equal(c.executadas.length, 1); });
  });
  await passo('PRODUÇÃO e fadasdobem02 nunca valem, nem se alguém os puser na lista', async () => {
    for (const banco of ['fadasdobem', 'fadasdobem02', 'FADASDOBEM']) await com(`fadasdobem01,${banco}`, banco, async (ex, c) => { await assert.rejects(() => ex.execute(UPD, ['A', 1]), (x) => recusa(x) && /produção/.test(x.message)); assert.equal(c.executadas.length, 0); });
  });
  await passo('a trava é conferida a CADA escrita (o banco pode mudar entre duas instruções)', async () => {
    process.env.GF_LEGADO_ESCRITA_BANCOS = 'fadasdobem01'; let atual = 'fadasdobem01'; const c = { executadas: [], query: async () => [[{ banco: atual }]], execute: async (q) => { c.executadas.push(q); return [{ affectedRows: 1 }]; } };
    try { const ex = legado.envolver(c); await ex.execute(UPD, ['A', 1]); atual = 'fadasdobem02'; await assert.rejects(() => ex.execute(UPD, ['B', 1]), recusa); assert.equal(c.executadas.length, 1); } finally { if (salvo === undefined) delete process.env.GF_LEGADO_ESCRITA_BANCOS; else process.env.GF_LEGADO_ESCRITA_BANCOS = salvo; }
  });
  await passo('constantes da trava: produção e fadasdobem02 são fixos no código; a lista é lida do env sem depender de maiúsculas ou espaços', () => {
    assert.deepEqual([...legado.BANCOS_NUNCA].sort(), ['fadasdobem', 'fadasdobem02']); assert.deepEqual(legado.bancosPermitidos({}), []); assert.deepEqual(legado.bancosPermitidos({ GF_LEGADO_ESCRITA_BANCOS: 'A, b ,' }), ['a', 'b']);
  });
  if (salvoPg === undefined) delete process.env.GESTAO_FADAS_ESCRITA_ENABLED; else process.env.GESTAO_FADAS_ESCRITA_ENABLED = salvoPg;

  console.log('Modo e flags');
  await passo('legado primeiro só com o geral E a flag da entidade (consultas também tem a sua: GF_LEGADO_CONSULTAS); GF_LEGADO_MODO=copia volta ao modo anterior', () => {
    const L = legado.espelhoLigado; const lp = legado.legadoPrimeiro;
    const geral = { GF_LEGADO_ESCRITA_ENABLED: 'true' };
    assert.equal(L(geral, 'consultas'), false); assert.equal(L({ ...geral, GF_LEGADO_CONSULTAS: 'true' }, 'consultas'), true); assert.equal(L({ GF_LEGADO_CONSULTAS: 'true' }, 'consultas'), false);
    assert.equal(lp.ativo('clientes', { ...geral, GF_LEGADO_CLIENTES: 'true' }), true); assert.equal(lp.ativo('clientes', { ...geral, GF_LEGADO_CLIENTES: 'true', GF_LEGADO_MODO: 'copia' }), false);
    assert.equal(lp.ativo('tarologos', geral), false); assert.equal(lp.modoPrimeiro({}), true); assert.equal(lp.modoPrimeiro({ GF_LEGADO_MODO: 'copia' }), false);
  });
  await passo('erro do legado vira 503 neutro (sem vazar texto do banco); valor que não cabe na coluna vira 422 com o motivo', () => {
    const lp = legado.legadoPrimeiro; const salvoErro = console.error; console.error = () => {};
    try {
      const e = lp.falhaDoLegado(Object.assign(new Error('Access denied for user root@10.0.0.1'), { codigo: 'ER_ACCESS' }));
      assert.equal(e.statusCode, 503); assert.equal(e.message, lp.MENSAGEM_NEUTRA); assert.ok(!/root|10\.0/.test(e.message)); assert.equal(e.dados.codigo, 'LEGACY_UNAVAILABLE');
      const m = lp.falhaDoLegado(new legado.mapeamento.MapeamentoError('name: vazio.')); assert.equal(m.statusCode, 422);
    } finally { console.error = salvoErro; }
  });
  await passo('o ENSAIO (cópias TEMPORÁRIAS) segue só em banco de dev e sem depender da trava', () => {
    assert.equal(legado.bancoDeDev('fadasdobem'), false); assert.equal(legado.bancoDeDev('fadasdobem02'), false); assert.equal(legado.bancoDeDev('fadasdobem01'), true);
  });

  console.log('Ambientes locais');
  await passo('a trava existe onde há flag ligada e NUNCA lista produção (fadasdobem) nem fadasdobem02; o app.js continua sem o job de reconciliação (só o da trava da ficha do ASP)', () => {
    for (const rel of ['.local-dev/api.env', '.env', '.env.example', '.env.local']) {
      const f = path.join(raiz, rel); if (!fs.existsSync(f)) continue;
      const linhas = fs.readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('#'));
      const bancos = linhas.filter((l) => /^\s*GF_LEGADO_ESCRITA_BANCOS\s*=/.test(l)).flatMap((l) => l.split('=').slice(1).join('=').replace(/["']/g, '').split(',').map((b) => b.trim().toLowerCase()).filter(Boolean));
      const ligadas = linhas.filter((l) => /^\s*GF_LEGADO_[A-Z_]*\s*=\s*"?true"?\s*$/i.test(l));
      assert.ok(!bancos.includes('fadasdobem') && !bancos.includes('fadasdobem02'), `${rel} lista banco proibido`);
      assert.ok(bancos.every((b) => /(01|dev|teste)$/.test(b)), `${rel}: a trava só pode listar banco de dev`);
      if (ligadas.length) assert.ok(bancos.length > 0, `${rel} liga escrita no legado sem a trava de banco`);
    }
    assert.ok(!/legado-escrita|reconciliacao|reconciliarTudo/.test(fs.readFileSync(path.join(raiz, 'app.js'), 'utf8').split('\n').filter((l) => !/verificacao\.job/.test(l)).join('\n'))); // o job da trava da ficha do ASP (Maturacao/53) é o único registrado
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('lf');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const fi = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-legado-fonte', 'filho.js')], extra);
    process.stdout.write(fi.stdout);
    if (fi.status !== 0) process.stderr.write(fi.stderr);
    codigo = fi.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_lf_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_lf_* restante).');
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
