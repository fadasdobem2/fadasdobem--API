'use strict';

/**
 * FILHO de scripts/verificar-gf-saldo-legado.js: Postgres DESCARTÁVEL (fdb_sal_*) já migrado; o legado MySQL NÃO é configurado. O leitor de
 * partida é o REAL (`fin.contexto`), só que com o histórico do legado trocado por linhas de mentira (mesmo formato do SELECT), de modo que
 * o cálculo de verdade roda: abertura calculada, congelada em `gf_saldos_partida` na primeira movimentação (corte por cliente) e depois
 * só movimentos do Postgres mexem no saldo.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_RESTRICOES: 'true', GF_FINANCEIRO_REGRAS: 'false' });
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const pagamentos = require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service'));
  const ciclo = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.service'));
  const agenda = require(r('src/gestao-fadas/features/agenda/agenda.service'));
  const restricoes = require(r('src/gestao-fadas/features/financeiro-cliente/restricoes.service'));
  const contexto = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));
  const leitura = require(r('src/gestao-fadas/features/financeiro-cliente/fin.saldo-legado'));
  const calculo = require(r('src/gestao-fadas/_comum/dominio/saldo-legado'));

  // Histórico de mentira por cliente, no formato das linhas do SELECT (tipo P pagamento, C consulta).
  const P = (dia, valor, numero = 0, texto = 'informado') => ({ tipo: 'P', t1: `${dia} 10:00:00`, t2: `${dia} 11:00:00`, valor, numero, texto });
  const C = (dia, minutos, bonus = 0) => ({ tipo: 'C', t1: `${dia} 15:00:00`, t2: `${dia} 14:00:00`, valor: `${dia} 14:00:00`, minutos, bonus });
  const HISTORICO = {
    900013: [P('2026-09-01', '88.80', 0), P('2026-09-10', '159.90', 2), C('2026-09-11', 70), C('2026-09-12', 0)], // FIFO: 8880 + 15990 - (30 min a 2,96 + 40 min a 2,665) = 5330
    900014: [C('2026-09-01', 20)], // dívida -59,20
    900016: [P('2026-08-01', '100.00', 1), C('2026-08-02', 15, 5)], // 10000 - 10*296 = 7040
    900017: [], 900018: [], 900019: [],
  };
  const EXISTE = new Set(Object.keys(HISTORICO));
  let chamadas = 0;
  contexto.definirLeitorDePartida(async (ids) => {
    chamadas += 1;
    const por = leitura.agrupar(ids.filter((id) => EXISTE.has(id)).flatMap((id) => (HISTORICO[id] || []).map((l) => ({ ...l, cliente: id }))), ids.filter((id) => EXISTE.has(id)));
    return new Map([...por].map(([id, h]) => [id, { centavos: calculo.saldoDaAbertura(h).centavos, conhecido: true, nome: `Cliente ${id}` }]));
  });
  const existe = async (id) => EXISTE.has(id);
  pagamentos.definirVerificadorDeCliente(existe); restricoes.definirVerificadorDeCliente(existe); ciclo.definirVerificadorDeCliente(existe); agenda.definirVerificadorDeCliente(existe);

  const uAtend = await criarUsuario('Atendente Saldo');
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: { userId: uAtend, role: 'atendente', displayName: 'Khloe' }, sessionId: 'sessao-sal' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300) };
  };
  const conta = async (id) => (await chamar('GET', `/payments/accounts?ids=${id}`)).j.accounts[id];
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const pag = (id, extra = {}) => ({ id, clientId: '900013', client: 'Cliente 900013', amount: 88.8, method: 'PIX', bank: 'Mercado Pago', payerName: 'Cliente 900013', informedAt: '2000-01-01T00:00:00.000Z', informedBy: 'x', status: 'Informado',
    purchase: { minutes: 30, amount: 88.8, table: 'regular', priceVersionId: 'VAL-001' }, audit: [{ id: `${id}-a1`, action: 'Pagamento informado', detail: 'x', actor: 'x', createdAt: '2000-01-01T00:00:00.000Z' }], ...extra });

  console.log('Saldo de abertura calculado, congelado e depois só movimentos novos');
  await passo('antes de qualquer movimento a conta mostra a abertura CALCULADA do legado e não congela nada', async () => {
    const a = await conta('900013'); assert.equal(a.openingCents, 5330); assert.equal(a.balanceCents, 5330); assert.equal(a.openingFrozen, false);
    const b = await conta('900014'); assert.equal(b.openingCents, -5920); assert.equal(b.balanceCents, -5920);
    const c = await conta('900016'); assert.equal(c.openingCents, 7040);
    assert.equal((await conta('900017')).openingCents, 0);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_saldos_partida'), 0);
  });
  await passo('a primeira movimentação nova congela a abertura calculada (fonte registrada) e soma o pagamento', async () => {
    const x = await chamar('POST', '/payments', { operationKey: 'op-saldo-legado-0001', record: pag('pag-sal-1') });
    assert.equal(x.status, 200, x.t);
    const [[l]] = await sequelize.query("SELECT centavos, fonte FROM gf_saldos_partida WHERE id_cliente = '900013'");
    assert.equal(Number(l.centavos), 5330); assert.equal(l.fonte, contexto.FONTE_PARTIDA);
    const c = await conta('900013'); assert.equal(c.openingFrozen, true); assert.equal(c.balanceCents, 5330 + 8880);
  });
  await passo('corte por cliente: o legado mudar depois (novo pagamento do Mercado Pago, nova consulta) NÃO mexe na conta congelada, mas mexe nas ainda não congeladas', async () => {
    HISTORICO[900013].push(P('2026-10-01', '500.00', 0), C('2026-10-02', 90));
    HISTORICO[900016].push(P('2026-10-01', '88.80', 0));
    const c = await conta('900013'); assert.equal(c.openingCents, 5330); assert.equal(c.balanceCents, 5330 + 8880);
    const d = await conta('900016'); assert.equal(d.openingCents, 7040 + 8880); assert.equal(d.openingFrozen, false);
  });
  await passo('cliente que nasce negativa: a cobertura usa a dívida; um pagamento novo congela -59,20 e a quita primeiro', async () => {
    const x = await chamar('POST', '/payments', { operationKey: 'op-saldo-legado-0002', record: pag('pag-sal-2', { clientId: '900014', client: 'Cliente 900014' }) });
    assert.equal(x.status, 200, x.t);
    const c = await conta('900014'); assert.equal(c.openingCents, -5920); assert.equal(c.openingFrozen, true); assert.equal(c.balanceCents, -5920 + 8880);
  });
  await passo('leitura em lote: uma chamada ao leitor para várias clientes', async () => {
    const antes = chamadas; const x = await chamar('GET', '/payments/accounts?ids=900017,900018,900019'); assert.equal(x.status, 200, x.t);
    assert.ok(chamadas - antes <= 1, `chamadas ${chamadas - antes}`);
  });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres descartável: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close();
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
