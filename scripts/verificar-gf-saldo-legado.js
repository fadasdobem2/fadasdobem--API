'use strict';

/**
 * Verificação do SALDO DE ABERTURA CALCULADO do legado (Maturacao/52; sem planilha, decisão do Patrick de 30/10/2026).
 *   1) OFFLINE: cenários do front (lotes FIFO, status 0/1/2, bônus, consulta de 0 minuto, pagamento antigo, tabela de primeira consulta,
 *      dívida quitada pelo pagamento novo), a leitura SQL é só SELECT e uma ida, e 600 cenários aleatórios contra o domínio JÁ PROVADO
 *      pelo ouro do front (`contaDaCliente`, com lotes de tarifa única).
 *   2) POSTGRES DESCARTÁVEL `fdb_sal_*` (sem `--offline`): congelamento em `gf_saldos_partida` pelo HTTP do gate (apoio-gf-saldo-legado/filho.js).
 *   3) DEV (opcional, `--cnf=<arquivo> --secao=client-dev`): lê o histórico real do DEV e confere tempo de resposta. Só SELECT.
 *   npm run verificar:gf-saldo-legado          node scripts/verificar-gf-saldo-legado.js --offline
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
let ok = 0; const falhas = [];
async function passo(nome, fn) {
  try { const x = await fn(); ok += 1; console.log(`  ok  ${nome}${x ? ` (${x})` : ''}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 260)}`); }
}

const pagto = (dia, valor, numero = 1, texto = 'informado') => ({ pagoEm: `${dia} 10:00:00`, criadoEm: `${dia} 11:00:00`, valor, numero, texto });
const consulta = (dia, minutos, bonus = 0) => ({ fim: `${dia} 15:00:00`, ini: `${dia} 14:00:00`, dia: `${dia} 14:00:00`, minutos, bonus });

async function offline() {
  const d = r('src/gestao-fadas/_comum/dominio/saldo-legado');
  const calc = (pagamentos, consultas) => d.saldoDaAbertura({ pagamentos, consultas }).centavos;

  console.log('Cenários do front');
  await passo('pacote de 30 min a R$ 88,80 e consulta de 20 min deixam R$ 29,60', () => assert.equal(calc([pagto('2026-01-01', '88.80')], [consulta('2026-01-02', 20)]), 2960));
  await passo('FIFO: o lote de R$ 159,90 (60 min a 2,665) sai primeiro, depois o de R$ 88,80 (2,96)', () => {
    assert.equal(calc([pagto('2026-01-01', '159.90'), pagto('2026-01-02', '88.80')], [consulta('2026-01-03', 70)]), 8880 - 2960);
    assert.equal(calc([pagto('2026-01-01', '159.90')], [consulta('2026-01-03', 1), consulta('2026-01-04', 59)]), 0, 'sem sobra de arredondamento ao esgotar o lote');
  });
  await passo('a tarifa do lote vale mesmo com a consulta cobrindo parte dele (30 min do pacote de 60 a 2,665 = R$ 79,95)', () => assert.equal(calc([pagto('2026-01-01', '159.90')], [consulta('2026-01-02', 30)]), 7995));
  await passo('status 0 (automático), 1 (Informado) e 2 (Confirmado) contam; 3, pendente, bloqueado e cancelado não', () => {
    for (const n of [0, 1, 2]) assert.equal(calc([pagto('2026-01-01', '88.80', n)], []), 8880, `status ${n}`);
    assert.equal(calc([pagto('2026-01-01', '88.80', 3)], []), 0);
    for (const t of ['pendente', 'Bloqueado', 'Cancelado']) assert.equal(calc([pagto('2026-01-01', '88.80', 1, t)], []), 0, t);
    assert.equal(calc([pagto('2026-01-01', '88.80', null, 'confirmado')], []), 8880, 'cópia confirmada sem número');
  });
  await passo('bônus abate minutos da cobrança; bônus maior que o tempo não cobra', () => {
    assert.equal(calc([pagto('2026-01-01', '88.80')], [consulta('2026-01-02', 15, 5)]), 8880 - 2960);
    assert.equal(calc([pagto('2026-01-01', '88.80')], [consulta('2026-01-02', 5, 10)]), 8880);
  });
  await passo('consulta de 0 minuto ou sem tempo (aberta) não aconteceu: não cobra', () => assert.equal(calc([pagto('2026-01-01', '88.80')], [consulta('2026-01-02', 0), consulta('2026-01-03', null), { fim: '0000-00-00 00:00:00', ini: '2026-01-04 10:00:00', minutos: 0, bonus: 0 }]), 8880));
  await passo('pagamento antigo fora da tabela vira minutos a R$ 2,96: R$ 100,00 e 10 min = R$ 70,40', () => assert.equal(calc([pagto('2012-05-01', '100.00', 2)], [consulta('2012-05-02', 10)]), 7040));
  await passo('pagamento antigo na tabela fixa do front, inclusive a primeira consulta (R$ 35 = 15 min, 46 = 20, 67 = 30, 120 = 60)', () => {
    for (const [reais, min] of [[35, 15], [46, 20], [67, 30], [120, 60], [88.8, 30], [159.9, 60]]) assert.equal(d.loteDaCompra(Math.round(reais * 100)).minutes, min, String(reais));
    assert.equal(calc([pagto('2026-01-01', '35.00')], [consulta('2026-01-02', 15)]), 0);
    assert.equal(calc([pagto('2026-01-01', '120.00')], [consulta('2026-01-02', 60)]), 0);
    assert.equal(d.loteDaCompra(12000).unit, 2);
  });
  await passo('consumo sem crédito vira dívida a R$ 2,96 e o pagamento novo quita a dívida antes de formar crédito', () => {
    assert.equal(calc([], [consulta('2026-01-01', 10)]), -2960);
    assert.equal(calc([pagto('2026-01-02', '88.80')], [consulta('2026-01-01', 10)]), 8880 - 2960);
    assert.equal(calc([pagto('2026-01-02', '88.80')], [consulta('2026-01-01', 10), consulta('2026-01-03', 20)]), 8880 - 2960 - 5920);
  });
  await passo('sem validade: crédito de 2009 continua valendo; dinheiro mal formado ou zero é ignorado', () => {
    assert.equal(calc([pagto('2009-03-01', '44.40')], []), 4440);
    for (const v of ['0.00', '-5.00', '', null, 'abc']) assert.equal(calc([pagto('2026-01-01', v)], []), 0, String(v));
  });
  await passo('datas zeradas não quebram: pagamento sem data entra primeiro', () => assert.equal(calc([{ pagoEm: '0000-00-00 00:00:00', criadoEm: null, valor: '88.80', numero: 1, texto: '' }], [consulta('2026-01-02', 10)]), 8880 - 2960));

  console.log('Leitura SQL');
  const leitura = r('src/gestao-fadas/features/financeiro-cliente/fin.saldo-legado');
  const { ehLeitura } = r('src/models/legado/somente-leitura');
  await passo('uma única instrução SELECT, indexada por idUsuario, sem coluna de dado pessoal', () => {
    assert.ok(ehLeitura(leitura.SQL));
    assert.equal((leitura.SQL.match(/idUsuario IN \(:ids\)/g) || []).length, 3);
    assert.doesNotMatch(leitura.SQL, /usuarios|nome|cpf|email|fone|whats|senha/i);
  });
  await passo('agrupar separa pagamentos e consultas por cliente e ignora cliente fora do pedido', () => {
    const por = leitura.agrupar([{ tipo: 'P', cliente: 1, t1: 'a', t2: 'b', valor: '1.00', numero: 1, texto: 'x' }, { tipo: 'C', cliente: 1, t1: 'a', t2: 'b', valor: 'c', minutos: 5, bonus: 0 }, { tipo: 'P', cliente: 9, valor: '1.00' }], [1, 2]);
    assert.equal(por.get('1').pagamentos.length, 1); assert.equal(por.get('1').consultas.length, 1); assert.equal(por.get('2').pagamentos.length, 0); assert.ok(!por.has('9'));
  });

  console.log('Contra o domínio provado pelo ouro do front');
  await passo('600 históricos aleatórios (tarifa única de R$ 2,96): mesmo saldo que contaDaCliente', () => {
    const saldo = r('src/gestao-fadas/_comum/dominio/financeiro-saldo');
    let seed = 20261030; const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const valores = ['44.40', '59.20', '74.00', '88.80', '118.40', '177.60', '100.00', '50.00', '29.90', '250.00'];
    for (let i = 0; i < 600; i += 1) {
      const dia = (k) => `2026-${String(1 + Math.floor(k / 28)).padStart(2, '0')}-${String(1 + (k % 28)).padStart(2, '0')}`;
      const pg = Array.from({ length: Math.floor(rnd() * 6) }, () => ({ dia: dia(Math.floor(rnd() * 200)), valor: valores[Math.floor(rnd() * valores.length)], n: Math.floor(rnd() * 3) }));
      const cs = Array.from({ length: Math.floor(rnd() * 12) }, () => ({ dia: dia(Math.floor(rnd() * 200)), min: Math.floor(rnd() * 61), bonus: rnd() < 0.2 ? Math.floor(rnd() * 8) : 0 }));
      const meu = calc(pg.map((p) => pagto(p.dia, p.valor, p.n)), cs.map((c) => consulta(c.dia, c.min, c.bonus)));
      const pagFront = pg.map((p, j) => ({ id: `p${j}`, clientId: '1', amount: Number(p.valor), method: 'Depósito', status: 'Informado', informedAt: `${p.dia}T10:00:00Z`, paidAt: p.dia, movements: [] }));
      const conFront = cs.map((c, j) => ({ id: `c${j}`, clientId: '1', status: 'Concluída', startedAt: `${c.dia}T14:00:00Z`, endedAt: `${c.dia}T15:00:00Z`, durationSeconds: Math.max(0, c.min - c.bonus) * 60, minuteValue: 2.96, billing: { minimumWaived: true } }));
      const front = Math.round(saldo.contaDaCliente('1', pagFront, conFront, 0).balance * 100);
      assert.equal(meu, front, `caso ${i}: ${JSON.stringify({ pg, cs })} meu=${meu} front=${front}`);
    }
  });
}

async function dev() {
  if (!arg('cnf')) { console.log('\nDEV: pulado (sem --cnf).'); return; }
  console.log('\nDEV (somente leitura)');
  const cfg = {}; let sec;
  for (const l of require('fs').readFileSync(arg('cnf'), 'utf8').split('\n')) { const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; cfg[sec] = {}; continue; } const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) cfg[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, ''); }
  const d = cfg[arg('secao') || 'client-dev'];
  if (!d || !/(01|dev|teste)$/i.test(d.database)) { console.log('  recusado: não é banco de desenvolvimento'); falhas.push('dev'); return; }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password });
  delete process.env.GF_LEGADO_ESCRITA_ENABLED;
  const { lendo } = r('src/gestao-fadas/_comum/legado');
  const { saldosCalculados } = r('src/gestao-fadas/features/financeiro-cliente/fin.saldo-legado');
  let ids = [];
  await passo('clientes do DEV com histórico (amostra de até 40)', async () => {
    const linhas = await lendo((m) => m.LegadoConsulta.sequelize.query('SELECT idUsuario AS id FROM tbl_consultas GROUP BY idUsuario ORDER BY COUNT(*) DESC LIMIT 40', { type: 'SELECT' }));
    ids = linhas.map((l) => String(l.id)); assert.ok(ids.length > 0); return `${ids.length} clientes`;
  });
  await passo('uma cliente por vez: cada cálculo cabe no tempo de uma requisição (< 1 s) e o lote de 40 também', async () => {
    let pior = 0;
    for (const id of ids) { const t0 = Date.now(); const m = await saldosCalculados([id]); pior = Math.max(pior, Date.now() - t0); assert.ok(Number.isInteger(m.get(id).centavos)); }
    const t1 = Date.now(); await saldosCalculados(ids); const lote = Date.now() - t1;
    assert.ok(pior < 1000 && lote < 3000, `pior ${pior} ms, lote ${lote} ms`); return `pior ${pior} ms, lote de ${ids.length}: ${lote} ms`;
  });
  await passo('cliente sem histórico dá zero; id inexistente não quebra', async () => { const m = await saldosCalculados(['2147483000']); assert.equal(m.get('2147483000').centavos, 0); });
  await r('src/models/legado').encerrarLegado();
}

async function comBanco() {
  const banco = pg.nomeBanco('sal'); let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`\nBanco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-saldo-legado', 'filho.js')], extra);
    process.stdout.write(f.stdout); if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_sal_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_sal_* restante).');
  }
  return codigo;
}

(async () => {
  await offline(); await dev();
  console.log(`\nverificar-gf-saldo-legado (offline${arg('cnf') ? ' + DEV' : ''}): ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
