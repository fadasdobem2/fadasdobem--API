'use strict';

/**
 * FILHO de scripts/verificar-gf-migracao.js: roda contra o Postgres DESCARTÁVEL (fdb_mig_*) já migrado, com DB_* só no ambiente deste processo.
 * Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado: o saldo calculado do legado e a existência
 * da cliente vêm de leitores falsos): aplicar o lote de uma planilha de 3 clientes, abertura da planilha, corte individual, cobrar x não cobrar, pós-pago
 * com abatimento, cliente sem planilha em ZERO, idempotência por sourceKey, conflito, lote atômico, planilha ANTES e DEPOIS de movimento novo, conferência
 * e relatório "sem planilha", perfis, auditoria sem dado pessoal e o gatilho que barra UPDATE/DELETE. Nenhum nome de cliente real; ids fictícios 9002xx.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true',
  GF_FATIA_CONSULTA: 'true', GF_FATIA_AGENDA: 'true', GF_FATIA_PRESENCA: 'true', GF_FATIA_PRECOS: 'true', GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_RESTRICOES: 'true', GF_FATIA_MIGRACAO: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
delete process.env.GF_MIGRACAO_LIMITE_CONFERENCIA_CENTAVOS;
process.env.GF_FINANCEIRO_REGRAS = 'false'; // registros simplificados, como o filho de Pagamentos; as regras refeitas têm o verificador próprio
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const pagamentos = require(r('src/gestao-fadas/features/financeiro-cliente/pagamentos.service'));
  const migracao = require(r('src/gestao-fadas/features/migracao/migracao.service'));
  const contexto = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));

  // Legado falso: saldo CALCULADO (conferência, nunca decide). 900201 = 100,00; 900202 = 200,00; 900203 = -80,00; 900204 = 55,30; 900206 = 53,30 (sem planilha).
  const CALCULADO = { 900201: 10000, 900202: 20000, 900203: -8000, 900204: 5530, 900205: 0, 900206: 5330, 900207: 5330, 900208: 0 };
  const EXISTE = new Set(Object.keys(CALCULADO));
  contexto.definirLeitorDePartida(async (ids) => new Map(ids.filter((id) => EXISTE.has(id)).map((id) => [id, { centavos: CALCULADO[id], conhecido: true, nome: `Cliente ${id}` }])));
  pagamentos.definirVerificadorDeCliente(async (id) => EXISTE.has(id));
  migracao.definirVerificadorDeClientes(async (ids) => new Set(ids.filter((id) => EXISTE.has(id))));

  const u = { atend: await criarUsuario('Atendente Mig'), adm: await criarUsuario('Administradora Mig'), assist: await criarUsuario('Assistente Mig'), tar: await criarUsuario('Tarologa Mig') };
  let sessao = { userId: u.atend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-mig' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(base + p, { method: metodo, headers: { 'content-type': 'application/json' }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 400), h: resp.headers };
  };
  const como = (perfil) => {
    const mapa = { atendente: [u.atend, 'Khloe'], administradora: [u.adm, 'Laya'], assistente: [u.assist, 'Assist'], tarologa: [u.tar, 'Osíris'] };
    const [userId, displayName] = mapa[perfil];
    sessao = { userId, role: perfil, displayName, ...(perfil === 'tarologa' ? { tarotId: '9001' } : {}) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-mig-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  const conta = async (id) => (await chamar('GET', `/payments/accounts?ids=${id}`)).j.accounts[id];
  const hist = (clientId, corte, o) => ({
    version: 1, clientId, clientName: 'Cliente Teste', cutoffAt: corte, batchId: o.batchId || 'LOTE-1', sourceKey: o.sourceKey || `${clientId}:${o.batchId || 'LOTE-1'}:${corte}`, approvedBy: 'Laya', approvedAt: '2026-10-31T12:00:00.000Z',
    note: 'Aprovado na conferência.', rateCents: 296, importedDebitCents: o.debito || 0, importedCreditCents: o.credito || 0, collectDebt: Boolean(o.cobrar), postpaid: Boolean(o.pos),
    items: o.cobrar && o.debito ? [{ id: 'I1', date: '01/01/2026', tarot: 'Osíris', minutes: 40, valueTodayCents: o.debito, allocatedCents: o.debito, partial: false }] : [],
    ...(o.posCredito ? { postpaidCredit: o.posCredito } : {}),
  });
  const aplicar = (histories, expectedLatest, operationKey = n()) => chamar('POST', '/migration/apply', { operationKey, ...(expectedLatest ? { expectedLatest } : {}), histories });
  const pag = (id, clientId, extra = {}) => ({
    id, clientId, client: `Cliente ${clientId}`, amount: 88.8, method: 'PIX', bank: 'Mercado Pago', payerName: 'Cliente', informedAt: '2000-01-01T00:00:00.000Z', informedBy: 'Hacker', status: 'Informado',
    purchase: { minutes: 30, amount: 88.8, table: 'regular', priceVersionId: 'VAL-001' }, audit: [{ id: `${id}-a1`, action: 'Pagamento informado', detail: 'x', actor: 'Hacker', createdAt: '2000-01-01T00:00:00.000Z' }], ...extra,
  });
  const lancar = (id, clientId, extra) => chamar('POST', '/payments', { operationKey: n(), record: pag(id, clientId, extra) });
  const PASSADO = '2020-01-01T00:00:00'; // pagamento de agora é DEPOIS deste corte (entra na conta)
  const FUTURO = '2099-01-01T00:00:00'; // pagamento de agora é ANTES deste corte (fica no histórico)

  console.log('Esquema');
  await passo('a tabela existe com os CHECKs, a migração roda de novo e UPDATE/DELETE são barrados (só acrescenta)', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = 'gf_migracao_historicos'"), 1);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM pg_constraint WHERE conname LIKE 'chk_migracao_historicos_%'") >= 10);
    await require(r('migrations/20261202000000-gestao-fadas-migracao-planilha')).up({ sequelize });
    await assert.rejects(() => sequelize.query("INSERT INTO gf_migracao_historicos (id, id_cliente, seq, source_key, source_hash, batch_id, corte_em, credito_centavos, debito_centavos, cobrar_debito, pos_pago, aprovado_em, item, criado_por, operation_key) VALUES ('x','abc',1,'k',repeat('a',64),'b','c',0,0,false,false,now(),'{}','a','op-xxxxxxxx')"));
  });

  console.log('Perfis e leitura vazia');
  como('administradora');
  await passo('GET vazio: 200, DTO puro, no-store; a taróloga não lê; o atendente lê mas não aplica; a assistente não aplica', async () => {
    const x = await chamar('GET', '/migration/histories'); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items, []); assert.ok(!('sucesso' in x.j)); assert.equal(x.h.get('cache-control'), 'no-store');
    como('tarologa'); assert.equal((await chamar('GET', '/migration/histories')).status, 403);
    como('atendente'); assert.equal((await chamar('GET', '/migration/histories')).status, 200);
    const a = await aplicar([hist('900201', PASSADO, { credito: 100 })]); assert.equal(a.status, 403, a.t);
    como('assistente'); assert.equal((await aplicar([hist('900201', PASSADO, { credito: 100 })])).status, 403);
    assert.equal((await chamar('GET', '/migration/reconciliation')).status, 403); assert.equal((await chamar('GET', '/migration/without-sheet')).status, 403);
    como('administradora');
  });

  console.log('Cliente SEM planilha começa em zero');
  await passo('sem planilha: abertura 0 (o saldo calculado do legado NÃO decide), mesmo com 53,30 calculado; o pagamento novo soma sobre zero', async () => {
    let c = await conta('900206'); assert.equal(c.openingCents, 0); assert.equal(c.balanceCents, 0); assert.equal(c.openingSource, 'sem-planilha-zero'); assert.ok(!('migration' in c));
    como('atendente'); const x = await lancar('pag-f1', '900206'); assert.equal(x.status, 200, x.t); como('administradora');
    c = await conta('900206'); assert.equal(c.openingCents, 0); assert.equal(c.balanceCents, 8880); assert.equal(c.openingFrozen, true);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_saldos_partida WHERE id_cliente = '900206' AND fonte = 'sem-planilha-zero' AND centavos = 0"), 1);
  });
  await passo('linha antiga congelada com o saldo do legado (versão anterior) é ignorada: a cliente sem planilha segue em zero', async () => {
    await sequelize.query("INSERT INTO gf_saldos_partida (id_cliente, centavos, fonte, congelado_por, operation_key) VALUES ('900207', 5330, 'legado.calculado-pagamentos-menos-consumo', 'Sistema', 'op-antiga-0001')");
    como('atendente'); await lancar('pag-g1', '900207'); como('administradora');
    const c = await conta('900207'); assert.equal(c.balanceCents, 8880, 'só o pagamento novo; os 53,30 do legado não entram');
  });

  console.log('Aplicar a planilha de 3 clientes');
  const A = hist('900201', '2026-10-10T12:00:00', { credito: 10000 }); // crédito, corte individual
  const B = hist('900202', '2026-10-10T12:00:00', { debito: 12000, cobrar: false }); // débito NÃO cobrar
  const C = hist('900203', '2026-10-05T09:00:00', { debito: 12000, cobrar: true, pos: true, posCredito: { limit: 300, paymentTermDays: 7 } }); // pós-pago devendo, COBRAR
  let primeiraChave;
  await passo('aplicar o lote: 200, 3 aplicadas, histórico devolvido igual ao enviado; quem vê pagamento lê', async () => {
    primeiraChave = n();
    const x = await aplicar([A, B, C], { 900201: null, 900202: null, 900203: null }, primeiraChave); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.applied, 3); assert.equal(x.j.repeated, 0); assert.equal(x.j.items.length, 3); assert.deepEqual(x.j.items[0], A);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_migracao_historicos'), 3);
    como('atendente'); const l = await chamar('GET', '/migration/histories'); assert.equal(l.status, 200); assert.equal(l.j.items.length, 3); assert.deepEqual(l.j.items.map((i) => i.clientId), ['900201', '900202', '900203']);
    const um = await chamar('GET', '/migration/histories?clientId=900203'); assert.equal(um.j.items.length, 1); assert.equal(um.j.items[0].postpaidCredit.limit, 300);
    const obter = await chamar('GET', `/migration/histories/${um.j.entries[0].id}`); assert.equal(obter.status, 200); assert.deepEqual(obter.j.item, C);
    assert.equal((await chamar('GET', '/migration/histories/inexistente')).status, 404);
    const pagina = await chamar('GET', '/migration/histories?limit=2'); assert.equal(pagina.j.items.length, 2); assert.equal(pagina.j.nextCursor, pagina.j.entries[1].id);
    como('administradora');
  });
  await passo('a assinatura da gravação fica na auditoria SEM nome de cliente; o lote é uma operação', async () => {
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'migracao.aplicar'"), 1);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'migracao.aplicar' AND (antes::text ILIKE '%Cliente Teste%' OR depois::text ILIKE '%Cliente Teste%')"), 0);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_migracao_historicos WHERE criado_por = 'Laya'"), 3);
  });
  await passo('saldo de abertura vem da planilha (cliente com corte individual): crédito 100,00, sem tocar no calculado do legado (100,00 coincide só de acaso)', async () => {
    const c = await conta('900201'); assert.equal(c.openingCents, 10000); assert.equal(c.balanceCents, 10000); assert.equal(c.openingSource, 'planilha-migracao'); assert.equal(c.migration.cutoffAt, '2026-10-10T12:00:00');
  });
  await passo('débito NÃO COBRAR: a ficha guarda o histórico, mas a conta operacional abre em 0 (o legado calculado dizia 200,00)', async () => {
    const c = await conta('900202'); assert.equal(c.balanceCents, 0); assert.equal(c.migrationOpeningCents, 0); assert.equal(c.migration.importedDebitCents, 12000); assert.equal(c.migration.collectDebt, false);
  });
  await passo('pós-pago devendo, débito COBRAR: abre em -120,00 e o perfil vira Pós-pago pela planilha', async () => {
    const c = await conta('900203'); assert.equal(c.balanceCents, -12000); assert.equal(c.paymentProfile, 'Pós-pago'); assert.equal(c.migration.collectDebt, true); assert.equal(c.migration.postpaid, true);
  });
  await passo('abatimento do pós-pago: pagamento depois do corte abate o débito (-120,00 + 88,80 = -31,20); o "não cobrar" NÃO consome o pagamento novo (0 + 88,80)', async () => {
    como('atendente'); assert.equal((await lancar('pag-c1', '900203')).status, 200); assert.equal((await lancar('pag-b1', '900202')).status, 200); como('administradora');
    assert.equal((await conta('900203')).balanceCents, -12000 + 8880); assert.equal((await conta('900202')).balanceCents, 8880);
  });

  console.log('Idempotência, conflito e atomicidade');
  await passo('mesma operationKey e corpo repete a resposta sem gravar; outro corpo com a mesma chave é 409 OPERATION_KEY_CONFLICT', async () => {
    const x = await aplicar([A, B, C], { 900201: null, 900202: null, 900203: null }, primeiraChave); assert.equal(x.status, 200); assert.equal(x.j.applied, 3); assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_migracao_historicos'), 3);
    const y = await aplicar([A], { 900201: null }, primeiraChave); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'OPERATION_KEY_CONFLICT');
  });
  await passo('mesmo sourceKey e mesmos dados com chave nova: nada a gravar (idempotente por sourceKey)', async () => {
    const x = await aplicar([A, B, C]); assert.equal(x.status, 200, x.t); assert.equal(x.j.applied, 0); assert.equal(x.j.repeated, 3); assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_migracao_historicos'), 3);
  });
  await passo('mesmo sourceKey com dados diferentes: 422 com a frase do front, e nada do lote entra (lote atômico)', async () => {
    const D = hist('900204', PASSADO, { credito: 5000 });
    const x = await aplicar([D, { ...A, note: 'Outro texto.' }]); assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, 'Esta conferência já foi aplicada com outros dados. Revise o lote antes de aplicar novamente.');
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_migracao_historicos WHERE id_cliente = '900204'"), 0);
  });
  await passo('abertura mais recente: a nova revisão entra (seq 2) e a antiga reaplicada é "superada"', async () => {
    const A2 = hist('900201', '2026-10-12T12:00:00', { credito: 7000, sourceKey: 'A-2' });
    const x = await aplicar([A2], { 900201: A.sourceKey }); assert.equal(x.status, 200, x.t); assert.equal(x.j.entries[0].seq, 2);
    assert.equal((await conta('900201')).balanceCents, 7000, 'a revisão vigente é a última');
    const y = await aplicar([A]); assert.equal(y.status, 422); assert.equal(y.j.error.message, 'Esta conferência foi superada por uma abertura mais recente. Faça uma nova revisão antes de aplicar à ficha.');
    const z = await aplicar([A2]); assert.equal(z.status, 200); assert.equal(z.j.repeated, 1);
  });
  await passo('revisão esperada velha: 409 VERSION_CHANGED (a abertura mudou em outra aba) e nada entra', async () => {
    const A3 = hist('900201', '2026-10-13T12:00:00', { credito: 1000, sourceKey: 'A-3' });
    const x = await aplicar([A3], { 900201: A.sourceKey }); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.code, 'VERSION_CHANGED');
    const y = await aplicar([A3], {}); assert.equal(y.status, 409);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_migracao_historicos WHERE source_key = 'A-3'"), 0);
  });
  await passo('histórico inválido, cliente inexistente e exemplo de demonstração são recusados; corpo sem lote é 400', async () => {
    const x = await aplicar([{ ...A, sourceKey: 'Z-1', note: '' }]); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Confira a composição, o corte e os dados da abertura antes de aplicar à ficha.');
    assert.equal((await aplicar([hist('999999', PASSADO, { credito: 1 })])).status, 404);
    assert.equal((await aplicar([{ ...hist('900204', PASSADO, { credito: 1 }), example: true }])).status, 422);
    assert.equal((await chamar('POST', '/migration/apply', { operationKey: n(), histories: [] })).status, 400);
    assert.equal((await chamar('POST', '/migration/apply', { histories: [A] })).status, 400);
  });
  await passo('o sourceKey do front é um JSON longo (milhares de caracteres): aceito, idempotente e sem nome de cliente na auditoria', async () => {
    const longa = hist('900208', PASSADO, { credito: 100, sourceKey: JSON.stringify({ lote: 'L', itens: 'x'.repeat(6000) }) });
    const x = await aplicar([longa]); assert.equal(x.status, 200, x.t); assert.equal(x.j.applied, 1);
    const y = await aplicar([longa]); assert.equal(y.j.applied, 0); assert.equal(y.j.repeated, 1);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_migracao_historicos WHERE id_cliente = '900208' AND char_length(source_key) > 6000"), 1);
  });
  await passo('corrida: dois lotes iguais com chaves diferentes ao mesmo tempo gravam UMA vez só', async () => {
    const E = hist('900208', PASSADO, { credito: 2500, sourceKey: 'E-1' });
    const dois = await Promise.all([aplicar([E]), aplicar([E])]);
    assert.deepEqual(dois.map((x) => x.status), [200, 200], dois.map((x) => x.t).join('|'));
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_migracao_historicos WHERE source_key = 'E-1'"), 1);
  });

  console.log('Planilha ANTES e DEPOIS do primeiro movimento novo');
  await passo('planilha depois do movimento: corte no futuro lê o pagamento antigo como histórico (sem contar duas vezes); corte no passado conta o pagamento', async () => {
    // 900206 já tem o pagamento pag-f1 de 88,80 (de agora) e a abertura registrada como sem planilha.
    assert.equal((await conta('900206')).balanceCents, 8880);
    const futuro = hist('900206', FUTURO, { credito: 10000, sourceKey: 'F-futuro' });
    assert.equal((await aplicar([futuro], { 900206: null })).status, 200);
    let c = await conta('900206'); assert.equal(c.balanceCents, 10000, 'o pagamento é anterior ao corte: está dentro dos 100,00 da planilha'); assert.equal(c.openingCents, 10000 - 8880, 'o crédito da conta desconta o que já aconteceu até o corte');
    assert.equal(c.receivedCents, 8880, 'o movimento continua visível no recebido');
    const passado = hist('900206', PASSADO, { credito: 10000, sourceKey: 'F-passado' });
    assert.equal((await aplicar([passado], { 900206: 'F-futuro' })).status, 200);
    c = await conta('900206'); assert.equal(c.balanceCents, 10000 + 8880, 'o pagamento é posterior ao corte: entra na conta'); assert.equal(c.openingCents, 10000);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_saldos_partida WHERE id_cliente = '900206' AND fonte = 'sem-planilha-zero'"), 1, 'a linha registrada no primeiro movimento não decide o saldo');
  });
  await passo('planilha antes do movimento: o primeiro movimento registra a origem "planilha-migracao" e o saldo segue a planilha', async () => {
    const G = hist('900205', PASSADO, { credito: 4000, sourceKey: 'G-1' });
    assert.equal((await aplicar([G])).status, 200); assert.equal((await conta('900205')).balanceCents, 4000);
    como('atendente'); assert.equal((await lancar('pag-h1', '900205')).status, 200); como('administradora');
    assert.equal((await conta('900205')).balanceCents, 4000 + 8880);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_saldos_partida WHERE id_cliente = '900205' AND fonte = 'planilha-migracao' AND centavos = 4000"), 1);
  });

  console.log('Conferência e relatório "sem planilha"');
  await passo('conferência: compara a abertura da planilha com o calculado do legado, marca acima de R$ 50 (padrão), sem nome nem dado pessoal', async () => {
    const x = await chamar('GET', '/migration/reconciliation'); assert.equal(x.status, 200, x.t);
    assert.equal(x.j.thresholdCents, 5000); assert.ok(x.j.totalWithSheet >= 6);
    const por = Object.fromEntries(x.j.clients.map((c) => [c.clientId, c]));
    assert.equal(por['900202'].status, 'diferenca'); assert.equal(por['900202'].sheetOpeningCents, 0); assert.equal(por['900202'].legacyCents, 20000); assert.equal(por['900202'].differenceCents, -20000);
    assert.equal(por['900203'].sheetOpeningCents, -12000); assert.equal(por['900203'].legacyCents, -8000); assert.equal(por['900203'].differenceCents, -4000); assert.equal(por['900203'].status, 'confere');
    assert.equal(por['900204'], undefined);
    assert.ok(!/Cliente Teste|clientName|nome/i.test(x.t + JSON.stringify(x.j)), 'sem nome de cliente');
    const baixo = await chamar('GET', '/migration/reconciliation?thresholdCents=1000'); assert.equal(baixo.j.thresholdCents, 1000); assert.equal(baixo.j.clients.find((c) => c.clientId === '900203').status, 'diferenca');
    assert.equal((await chamar('GET', '/migration/reconciliation?thresholdCents=abc')).status, 400);
    const pag = await chamar('GET', '/migration/reconciliation?limit=2'); assert.equal(pag.j.clients.length, 2); assert.ok(pag.j.nextCursor);
  });
  await passo('"sem planilha": a cliente com movimento e sem planilha aparece; as com planilha não; ids pedidos entram; abertura = 0', async () => {
    const x = await chamar('GET', '/migration/without-sheet?ids=900204'); assert.equal(x.status, 200, x.t);
    const ids = x.j.clients.map((c) => c.clientId);
    assert.ok(ids.includes('900207') && ids.includes('900204')); assert.ok(!ids.includes('900206') && !ids.includes('900201') && !ids.includes('900205'));
    const g = x.j.clients.find((c) => c.clientId === '900207'); assert.equal(g.hasMovements, true); assert.equal(g.openingSource, 'legado.calculado-pagamentos-menos-consumo');
    assert.equal(x.j.openingCents, 0); assert.ok(!/Cliente Teste|nome/i.test(JSON.stringify(x.j)));
  });

  console.log('Sempre acrescenta');
  await passo('UPDATE e DELETE direto na tabela são barrados pelo gatilho', async () => {
    await assert.rejects(() => sequelize.query("UPDATE gf_migracao_historicos SET batch_id = 'x' WHERE id_cliente = '900201'"), /so acrescenta/);
    await assert.rejects(() => sequelize.query("DELETE FROM gf_migracao_historicos WHERE id_cliente = '900201'"), /so acrescenta/);
  });
  await passo('a escrita desligada responde 503 WRITE_DISABLED na aplicação e a leitura segue', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
    try {
      const x = await aplicar([hist('900204', PASSADO, { credito: 1, sourceKey: 'W-1' })]); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
      assert.equal((await chamar('GET', '/migration/histories?clientId=900201')).status, 200);
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
  });

  srv.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
