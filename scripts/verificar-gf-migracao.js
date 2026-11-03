'use strict';

/**
 * Verificação da fatia Migração por planilha (Maturacao/55).
 *   1) OFFLINE (sempre): o domínio portado contra o ouro do CÓDIGO REAL do front (`apoio-gf-migracao/ouro.js`: validade do histórico, `parseMigrationDate`,
 *      corte individual, abertura, saldo da conta e da ficha, idempotência/conflito/superada), a flag (404 desligada, 401 sem sessão, 405 com Allow),
 *      o anúncio `realFeatures.migration`, o limite configurável da conferência e que o status numérico dos pagamentos no legado não foi reclassificado
 *      (1 = Não Confirmado, 2 = Confirmado, 0 = automático).
 *   2) POSTGRES LOCAL DESCARTÁVEL (sem `--offline`): cria `fdb_mig_<aleatório>` em localhost:5432, migra por run-migrations, roda scripts/apoio-gf-migracao/filho.js
 *      (HTTP do gate: planilha de 3 clientes, corte individual, cobrar x não cobrar, pós-pago com abatimento, sem planilha = zero, idempotência por sourceKey,
 *      conflito, planilha antes e depois de movimento novo, conferência, auditoria sem dado pessoal) e apaga o banco.
 *   npm run verificar:gf-migracao            (completo)       node scripts/verificar-gf-migracao.js --offline   (sem banco)
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
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}

async function offline() {
  console.log('Ouro do código real do front');
  await passo('o porte concorda com o front: validade, datas, corte individual, abertura, saldo da conta e da ficha, lote (ouro gerado do código do front)', () => {
    const { verificar } = require('./apoio-gf-migracao/ouro');
    const saida = verificar();
    assert.deepEqual(saida.falhas.slice(0, 5), []); assert.ok(saida.ok > 5000, `só ${saida.ok} conferências`);
    console.log(`        ouro migração: ${saida.ok}/${saida.ok} conferências iguais`);
  });

  const dom = r('src/gestao-fadas/_comum/dominio/migracao-planilha');
  const saldo = r('src/gestao-fadas/_comum/dominio/financeiro-saldo');
  const hist = (o) => ({ version: 1, clientId: '900300', clientName: 'Cliente Teste', cutoffAt: '2026-10-10T12:00:00', batchId: 'L1', sourceKey: 'K1', approvedBy: 'Laya', approvedAt: '2026-10-31T12:00:00.000Z', note: 'ok', rateCents: 296,
    importedDebitCents: 0, importedCreditCents: 0, collectDebt: false, postpaid: false, items: [], ...o });
  const pag = (id, quando, valor) => ({ id, clientId: '900300', client: 'Cliente Teste', amount: valor, method: 'PIX', paidAt: quando, informedAt: quando, informedBy: 'Khloe', status: 'Informado', purchase: { minutes: 30, amount: valor, table: 'regular', priceVersionId: 'VAL-001' } });
  const saldoDe = (h, pagamentos) => saldo.contaDaCliente('900300', pagamentos, [], dom.offsetDaAbertura(h, dom.linhasDaConta('900300', pagamentos, []))).balance;

  console.log('Regras da Nice, em centavos');
  await passo('abertura = crédito - (cobrar ? débito : 0); "não cobrar" não entra; "cobrar" entra e exige composição fechada', () => {
    assert.equal(dom.aberturaEmCentavos(hist({ importedCreditCents: 10000 })), 10000);
    assert.equal(dom.aberturaEmCentavos(hist({ importedDebitCents: 12000, collectDebt: false })), 0);
    const cobrar = hist({ importedDebitCents: 12000, collectDebt: true, items: [{ id: 'I', date: '01/01/2026', tarot: 'O', minutes: 10, valueTodayCents: 12000, allocatedCents: 12000, partial: false }] });
    assert.equal(dom.aberturaEmCentavos(cobrar), -12000); assert.ok(dom.historicoValido(cobrar)); assert.ok(!dom.historicoValido({ ...cobrar, items: [] }));
  });
  await passo('corte individual: antes do corte fica no histórico; depois entra na conta; no instante do corte ainda é histórico', () => {
    const h = hist({ importedCreditCents: 10000 });
    assert.equal(dom.depoisDoCorte(h, { at: '2026-10-10T15:00:00Z' }), false, '12:00 em São Paulo = 15:00 UTC: não é depois');
    assert.equal(dom.depoisDoCorte(h, { at: '2026-10-10T15:00:01Z' }), true);
    assert.equal(dom.depoisDoCorte(h, { at: '2026-10-09T15:00:00Z' }), false);
  });
  await passo('pós-pago com abatimentos: -120,00, paga 50,00 e 30,00 depois do corte = -40,00; pagamento antes do corte não abate', () => {
    const h = hist({ importedDebitCents: 12000, collectDebt: true, postpaid: true, items: [{ id: 'I', date: '01/01/2026', tarot: 'O', minutes: 10, valueTodayCents: 12000, allocatedCents: 12000, partial: false }] });
    assert.equal(saldoDe(h, []), -120);
    assert.equal(saldoDe(h, [pag('P1', '2026-10-12T12:00:00-03:00', 50), pag('P2', '2026-10-14T12:00:00-03:00', 30)]), -40);
    assert.equal(saldoDe(h, [pag('P0', '2026-10-01T12:00:00-03:00', 50)]), -120, 'antes do corte já está dentro do débito importado');
  });
  await passo('não cobrar: 120,00 de débito fica fora; o pagamento novo vira crédito inteiro (0 + 50,00)', () => {
    const h = hist({ importedDebitCents: 12000, collectDebt: false, importedCreditCents: 0 });
    assert.equal(saldoDe(h, []), 0); assert.equal(saldoDe(h, [pag('P1', '2026-10-12T12:00:00-03:00', 50)]), 50);
  });
  await passo('planilha tardia: o mesmo movimento nunca conta duas vezes, venha a planilha antes ou depois', () => {
    const h = hist({ importedCreditCents: 10000, cutoffAt: '2026-10-20T00:00:00' });
    const antes = pag('P1', '2026-10-15T12:00:00-03:00', 88.8); const depois = pag('P2', '2026-10-25T12:00:00-03:00', 88.8);
    assert.equal(saldoDe(h, [antes]), 100); assert.equal(saldoDe(h, [depois]), 188.8); assert.equal(saldoDe(h, [antes, depois]), 188.8);
  });
  await passo('cliente sem planilha: nenhum histórico, nenhum offset (abre em zero)', () => {
    assert.equal(saldo.contaDaCliente('900300', [], [], 0).balance, 0);
    const ctx = r('src/gestao-fadas/features/financeiro-cliente/fin.contexto');
    return ctx.carregar({ pagamentos: async () => [], consultas: async () => [], beneficios: async () => [], partida: async () => null, migracao: async () => null, perfilEm: async () => null }, '900300', { perfilPagamento: '' })
      .then((c) => { assert.equal(c.profile.credit, 0); assert.equal(c.partida.origem, 'sem-planilha-zero'); assert.equal(c.partida.centavos, 0); });
  });
  await passo('o saldo calculado do legado não decide: o leitor do legado nem é chamado ao carregar o contexto', () => {
    const ctx = r('src/gestao-fadas/features/financeiro-cliente/fin.contexto');
    let chamado = false; ctx.definirLeitorDePartida(async () => { chamado = true; return new Map(); });
    return ctx.carregar({ pagamentos: async () => [], consultas: async () => [], beneficios: async () => [], partida: async () => 5330, migracao: async () => null, perfilEm: async () => null }, '900300', { perfilPagamento: '', partidaViva: { centavos: 99999 } })
      .then((c) => { ctx.definirLeitorDePartida(null); assert.equal(chamado, false); assert.equal(c.profile.credit, 0); });
  });
  await passo('conferência: limite padrão R$ 50,00, configurável por query e por env; só "acima" marca', () => {
    const { limiteDaConferencia, classificar } = r('src/gestao-fadas/features/migracao/migracao.conferencia');
    assert.equal(limiteDaConferencia({}, {}), 5000); assert.equal(limiteDaConferencia({ thresholdCents: '1000' }, {}), 1000); assert.equal(limiteDaConferencia({}, { GF_MIGRACAO_LIMITE_CONFERENCIA_CENTAVOS: '2500' }), 2500);
    assert.throws(() => limiteDaConferencia({ thresholdCents: '-1' }, {}));
    assert.equal(classificar(0, { centavos: 5000 }, 5000).status, 'confere'); assert.equal(classificar(0, { centavos: 5001 }, 5000).status, 'diferenca'); assert.equal(classificar(0, undefined, 5000).status, 'fora-do-legado');
  });
  await passo('conferência no mesmo ponto: `saldoDaAbertura` com `ate` ignora o que veio depois do corte; "não cobrar" compara só o crédito; resumo de chave é estável', () => {
    const leg = r('src/gestao-fadas/_comum/dominio/saldo-legado');
    const { classificar, corteComoInstante } = r('src/gestao-fadas/features/migracao/migracao.conferencia');
    const hist2 = { pagamentos: [{ pagoEm: '2019-12-01 10:00:00', valor: '100.00', numero: 1, texto: 'informado' }, { pagoEm: '2020-06-01 10:00:00', valor: '50.00', numero: 1, texto: 'informado' }], consultas: [{ fim: '2020-07-01 10:00:00', minutos: 10, bonus: 0 }] };
    assert.equal(corteComoInstante('2020-01-01T00:00:00'), '2020-01-01 00:00:00'); assert.equal(corteComoInstante('01/01/2020'), '2020-01-01 00:00:00'); assert.equal(corteComoInstante('xx'), null);
    const ate = leg.saldoDaAbertura(hist2, { ate: '2020-01-01 00:00:00' });
    assert.equal(ate.centavos, 10000); assert.deepEqual(ate.depoisDoCorte, { pagamentos: 1, consultas: 1 });
    assert.notEqual(leg.saldoDaAbertura(hist2).centavos, 10000); assert.equal(leg.saldoDaAbertura(hist2).depoisDoCorte, undefined);
    assert.equal(classificar(10000, ate, 5000).status, 'confere');
    const divida = { centavos: -11840, dividaCentavos: 11840 };
    assert.equal(classificar(0, divida, 5000, { cobrarDebito: false }).status, 'confere'); assert.equal(classificar(0, divida, 5000, { cobrarDebito: true }).status, 'diferenca');
    assert.equal(classificar(30000, ate, 5000).status, 'diferenca'); assert.equal(classificar(30000, ate, 5000).reason.code, 'diferenca-no-corte');
    const { resumoDaChave } = r('src/gestao-fadas/features/migracao/migracao.service');
    assert.equal(resumoDaChave('abc'), 'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  await passo('os status numéricos dos pagamentos no legado seguem como estavam: 1 = Não Confirmado, 2 = Confirmado, 0 = automático (Mercado Pago, nunca escrito)', () => {
    const p = r('src/gestao-fadas/legado-escrita/provisorio');
    assert.equal(p.STATUS_PAGTO_NOVO, 1); assert.equal(p.STATUS_PAGTO_CONFIRMADO, 2);
    const leg = r('src/gestao-fadas/_comum/dominio/saldo-legado');
    const base = { pagoEm: '2026-10-01 10:00:00', criadoEm: null, valor: '88.80', texto: 'informado' };
    const credito = (numero) => leg.saldoDaAbertura({ pagamentos: [{ ...base, numero }], consultas: [] }).centavos;
    assert.ok(credito(0) > 0 && credito(1) > 0 && credito(2) > 0, '0, 1 e 2 continuam contando como pagamento');
  });

  console.log('Gate');
  const { criarGate } = r('src/gestao-fadas/gate');
  const { migracaoLigada } = r('src/gestao-fadas/gate/rotas-migracao');
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
  const antes = process.env.GF_FATIA_MIGRACAO;
  const ROTAS = [['GET', '/migration/histories'], ['GET', '/migration/histories/x'], ['POST', '/migration/apply'], ['GET', '/migration/reconciliation'], ['GET', '/migration/without-sheet']];
  try {
    await passo('flag desligada: toda a fatia responde 404 NOT_FOUND antes do método e da sessão; ligada, a sessão anuncia migration', async () => {
      delete process.env.GF_FATIA_MIGRACAO;
      assert.equal(migracaoLigada(process.env), false);
      for (const [m, p] of ROTAS) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 404, `${m} ${p}`); assert.equal(a.j.error.code, 'NOT_FOUND'); }
      const c = await chamar('DELETE', '/migration/apply'); assert.equal(c.status, 404);
      process.env.GF_FATIA_MIGRACAO = 'true'; assert.equal(migracaoLigada(process.env), true);
    });
    await passo('flag ligada: 401 sem sessão e 405 com Allow', async () => {
      process.env.GF_FATIA_MIGRACAO = 'true';
      for (const [m, p] of ROTAS) { const a = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(a.status, 401, `${m} ${p}`); assert.equal(a.j.error.code, 'SESSION_REQUIRED'); }
      const b = await chamar('DELETE', '/migration/histories'); assert.equal(b.status, 405); assert.equal(b.h.get('allow'), 'GET');
      const c = await chamar('GET', '/migration/apply'); assert.equal(c.status, 405); assert.equal(c.h.get('allow'), 'POST');
    });
    await passo('a sessão anuncia realFeatures.migration só com a flag (retrocompatível)', () => {
      const fonte = require('fs').readFileSync(path.join(raiz, 'src/gestao-fadas/gate/sessao-nativa.js'), 'utf8');
      assert.ok(/migracaoLigada\(env\) \? \{ migration: true \}/.test(fonte));
    });
  } finally {
    if (antes === undefined) delete process.env.GF_FATIA_MIGRACAO; else process.env.GF_FATIA_MIGRACAO = antes;
    srv.close();
  }
}

async function comBanco() {
  const banco = pg.nomeBanco('mig');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-migracao', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_mig_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_mig_* restante).');
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
