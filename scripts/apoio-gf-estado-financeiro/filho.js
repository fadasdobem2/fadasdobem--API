'use strict';

/**
 * FILHO de scripts/verificar-gf-estado-financeiro.js: roda contra o Postgres DESCARTÁVEL (fdb_est_*) já migrado, com DB_* só no ambiente deste processo.
 * Prova pelo HTTP do gate (sessão de mentira, usuários reais da A no banco; o MySQL legado NÃO é configurado): Motivos financeiros (leitura, criar, revisar,
 * versões, perfis, 409, idempotência, corrida), Adicionais (categorias, regras, ocorrências, quantidade, perfis, 409), a pendência `addition:` derivada no servidor
 * (derivada, encaminhar, adulterada, resolvida), Trilha operacional (gravar, repetir, ler só a administradora), auditoria, escrita desligada e flag.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_ESTADO_FINANCEIRO: 'true', GF_FATIA_PENDENCIAS: 'true',
});
delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const comum = require(r('src/gestao-fadas/features/estado-financeiro/estado.comum'));
  const adicionaisSvc = require(r('src/gestao-fadas/features/estado-financeiro/adicionais.service'));
  const { hojeOperacional } = require(r('src/gestao-fadas/_comum/dia-operacional'));
  const u = { atend: await criarUsuario('Atendente Est'), adm: await criarUsuario('Administradora Est'), sup: await criarUsuario('Supervisora Est'), assist: await criarUsuario('Assistente Est'), tar: await criarUsuario('Tarologa Est') };
  let sessao = { userId: u.atend, role: 'atendente', displayName: 'Khloe' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-est' }) }, verificarLegado: async () => true }));
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
    const mapa = { atendente: [u.atend, 'Khloe'], administradora: [u.adm, 'Laya'], supervisora: [u.sup, 'Clara'], assistente: [u.assist, 'Assist'], tarologa: [u.tar, 'Osíris'] };
    const [userId, displayName] = mapa[perfil];
    sessao = { userId, role: perfil, displayName, ...(perfil === 'tarologa' ? { tarotId: '9001' } : {}) };
  };
  const n = () => { n.i = (n.i || 0) + 1; return `op-est-${Date.now()}-${n.i}`; };
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);
  // Relógio: a data civil é a do dia operacional de hoje (a mesma que as pendências usam).
  const hoje = hojeOperacional();
  comum.definirRelogio({ agora: () => new Date().toISOString(), hoje: () => hoje });
  adicionaisSvc.definirCatalogo(async () => [{ id: '9001', name: 'Osíris' }, { id: '9002', name: 'Ísis' }]);

  console.log('Esquema');
  await passo('as três tabelas existem, têm os CHECKs e a migração roda de novo sem erro', async () => {
    for (const t of ['gf_motivos_financeiros', 'gf_adicionais_itens', 'gf_log_operacional']) assert.equal(await contar(`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_name = '${t}'`), 1, t);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM pg_constraint WHERE conname LIKE 'chk_motivos_%' OR conname LIKE 'chk_adicionais_%' OR conname LIKE 'chk_log_operacional_%'") >= 17);
    await require(r('migrations/20261125000000-gestao-fadas-estado-financeiro')).up({ sequelize });
    await assert.rejects(() => sequelize.query("INSERT INTO gf_adicionais_itens (chave, tipo, item, criado_por, operation_key) VALUES ('x', 'outro', '{}', 'a', 'op-xxxxxxxx')"));
    await assert.rejects(() => sequelize.query("INSERT INTO gf_log_operacional (id, categoria, item, registrado_por, conta_id, operation_key) VALUES ('x', 'nada', '{}', 'a', '1', 'op-xxxxxxxx')"));
  });

  console.log('Motivos financeiros');
  const motivo = (id, extra = {}) => ({ id, version: 1, scope: 'client', nature: 'payment', name: 'Cortesia da casa', description: 'Explicação.', statementText: 'Pagamento de {data}', active: true, createdAt: '2000-01-01T00:00:00.000Z', createdBy: 'Hacker', ...extra });
  const gravarMotivo = (record, expectedVersion, operationKey = n()) => chamar('PUT', '/financial-reasons', { operationKey, expectedVersion, record });
  const lerMotivos = () => chamar('GET', '/financial-reasons');
  await passo('GET: as 17 sementes do front (versão 1), DTO puro e no-store; a taróloga é recusada (403)', async () => {
    como('atendente'); const x = await lerMotivos(); assert.equal(x.status, 200, x.t); assert.equal(x.j.items.length, 17); assert.ok(x.j.items.every((i) => i.versions.length === 1 && x.j.versions[i.id] === 1));
    assert.ok(!('sucesso' in x.j)); assert.equal(x.h.get('cache-control'), 'no-store');
    como('tarologa'); assert.equal((await lerMotivos()).status, 403); assert.equal((await gravarMotivo({ id: 'm1', versions: [motivo('m1')] }, 0)).status, 403);
  });
  const chaveCriar = n();
  await passo('a supervisora cria um motivo: o servidor carimba autor e instante e devolve versão 1', async () => {
    como('supervisora'); const x = await gravarMotivo({ id: 'm1', versions: [motivo('m1', { name: '  Cortesia   da casa ' })] }, 0, chaveCriar);
    assert.equal(x.status, 200, x.t); const v = x.j.items[0].versions[0]; assert.equal(v.createdBy, 'Clara'); assert.notEqual(v.createdAt, '2000-01-01T00:00:00.000Z'); assert.equal(v.name, 'Cortesia da casa'); assert.equal(x.j.versions.m1, 1);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_motivos_financeiros WHERE id = 'm1'"), 1);
  });
  await passo('mesma chave e corpo repete a resposta sem gravar de novo; mesma chave com outro corpo: 409 OPERATION_KEY_CONFLICT', async () => {
    const x = await gravarMotivo({ id: 'm1', versions: [motivo('m1', { name: '  Cortesia   da casa ' })] }, 0, chaveCriar); assert.equal(x.status, 200, x.t);
    const y = await gravarMotivo({ id: 'm1', versions: [motivo('m1', { name: 'Outro nome' })] }, 0, chaveCriar); assert.equal(y.status, 409); assert.equal(y.j.error.code, 'OPERATION_KEY_CONFLICT');
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_motivos_financeiros'), 1);
  });
  await passo('regras do front com as MESMAS frases: nome repetido, Outros, texto do extrato, explicação longa, natureza fora do escopo (422)', async () => {
    como('administradora');
    const casos = [
      [motivo('m2', { name: 'cortesia da CASA' }), 'Este motivo já existe neste tipo de movimento. Confira também os inativos.'], [motivo('m3', { name: 'Outros' }), 'Outros já está disponível para descrever um caso avulso.'],
      [motivo('m4', { name: 'Novo', statementText: 'Com {x}' }), 'Use apenas a data do pagamento como campo variável no texto do extrato.'], [motivo('m5', { name: 'Novo', statementText: '   ' }), 'Informe o texto do extrato com até 180 caracteres.'],
      [motivo('m6', { name: 'Novo', description: 'd'.repeat(301) }), 'Use até 300 caracteres na explicação do motivo.'], [motivo('m7', { name: 'Novo', nature: 'payout' }), 'Escolha um tipo de movimento válido para esta conta.'],
      [motivo('m8', { name: 'x'.repeat(61) }), 'Informe um nome curto, com até 60 caracteres.'],
    ];
    for (const [rec, frase] of casos) { const x = await gravarMotivo({ id: rec.id, versions: [rec] }, 0); assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, frase); }
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_motivos_financeiros'), 1);
  });
  await passo('perfis: a atendente é recusada com a frase do front (422); administradora, assistente e supervisora criam', async () => {
    como('atendente'); let x = await gravarMotivo({ id: 'm9', versions: [motivo('m9', { name: 'Da atendente' })] }, 0); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'O cadastro de motivos está disponível para supervisora, assistente e administradora.');
    for (const [perfil, id] of [['administradora', 'm10'], ['assistente', 'm11']]) { como(perfil); x = await gravarMotivo({ id, versions: [motivo(id, { name: `Do ${perfil}` })] }, 0); assert.equal(x.status, 200, x.t); }
  });
  await passo('revisar: inativar o motivo cria a versão 2 (a 1 continua); versão velha: 409 com a frase do front; nada muda', async () => {
    como('supervisora'); const antes = (await lerMotivos()).j.items.find((i) => i.id === 'm1');
    const v2 = { ...antes.versions[0], version: 2, active: false };
    let x = await gravarMotivo({ id: 'm1', versions: [antes.versions[0], v2] }, 1); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].versions.length, 2); assert.equal(x.j.items[0].versions[1].active, false); assert.equal(x.j.items[0].versions[1].createdBy, 'Clara'); assert.equal(x.j.versions.m1, 2);
    x = await gravarMotivo({ id: 'm1', versions: [antes.versions[0], { ...v2, version: 2, active: true }] }, 1); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.code, 'VERSION_CHANGED'); assert.equal(x.j.error.message, 'Este motivo foi atualizado. Abra a edição novamente.');
    assert.equal((await lerMotivos()).j.items.find((i) => i.id === 'm1').versions[0].active, true, 'a versão 1 não é reescrita');
  });
  await passo('histórico adulterado (versão antiga mudada, versão pulada, natureza trocada) é recusado e nada muda', async () => {
    const atual = (await lerMotivos()).j.items.find((i) => i.id === 'm1'); const [a, b] = atual.versions;
    for (const ruim of [[{ ...a, name: 'Reescrito' }, b, { ...b, version: 3, name: 'Novo nome' }], [a, b, { ...b, version: 4 }], [a, b, { ...b, version: 3, nature: 'refund' }]]) {
      const x = await gravarMotivo({ id: 'm1', versions: ruim }, 2); assert.ok([422, 400].includes(x.status), x.t);
    }
    assert.equal((await lerMotivos()).j.versions.m1, 2);
  });
  await passo('uma semente revisada pela primeira vez vira linha com a versão 1 (a semente) e a 2; a do front continua igual para quem não mexeu', async () => {
    como('administradora'); const lista = (await lerMotivos()).j.items; const semente = lista.find((i) => i.id === 'financial-reason-charge');
    const v2 = { ...semente.versions[0], version: 2, name: 'Consulta cobrada' };
    const x = await gravarMotivo({ id: semente.id, versions: [semente.versions[0], v2] }, 1); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].versions.length, 2);
    const depois = (await lerMotivos()).j; assert.equal(depois.items.length, 17 + 3); assert.equal(depois.versions['financial-reason-charge'], 2); assert.equal(depois.versions['financial-reason-refund'], 1);
  });
  await passo('corrida: duas revisões com a mesma versão, uma vence e a outra é 409', async () => {
    como('administradora'); const atual = (await lerMotivos()).j.items.find((i) => i.id === 'm10');
    const [a, b] = await Promise.all([gravarMotivo({ id: 'm10', versions: [atual.versions[0], { ...atual.versions[0], version: 2, name: 'A vence' }] }, 1), gravarMotivo({ id: 'm10', versions: [atual.versions[0], { ...atual.versions[0], version: 2, name: 'B vence' }] }, 1)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.t} | ${b.t}`);
  });
  await passo('forma ruim: id inválido, sem versões, operationKey curta e JSON quebrado (400)', async () => {
    let x = await gravarMotivo({ id: 'a b', versions: [motivo('x')] }, 0); assert.equal(x.status, 400);
    x = await gravarMotivo({ id: 'm20', versions: [] }, 0); assert.equal(x.status, 400);
    x = await chamar('PUT', '/financial-reasons', { operationKey: 'curta', expectedVersion: 0, record: { id: 'm20', versions: [motivo('m20')] } }); assert.equal(x.status, 400);
    const resp = await fetch(`${base}/financial-reasons`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{' }); assert.equal(resp.status, 400);
  });

  console.log('Adicionais do repasse');
  const gravarAd = (record, expectedVersion, operationKey = n()) => chamar('PUT', '/payout-additions', { operationKey, expectedVersion, record });
  const lerAd = () => chamar('GET', '/payout-additions');
  const cat = (id, name, extra = {}) => ({ id, name, ...extra });
  const regra = (id, extra = {}) => ({ id, tarotId: '9001', categoryId: 'monitoria', categoryName: 'Monitoria', value: { kind: 'unit', unitValue: 3.5, unitLabel: 'carta' }, frequency: 'weekly', startDate: hoje, description: '', history: [{ action: 'created', date: hoje, at: '2000-01-01T00:00:00.000Z', by: 'Hacker' }], ...extra });
  const oc = (rid, data, extra = {}) => ({ id: `PAO:${encodeURIComponent(rid)}:${data}`, ruleId: rid, date: data, status: 'pending', ...extra });
  await passo('GET inicial: as 3 categorias padrão (versão 1) e nada mais; a taróloga leva 403', async () => {
    como('atendente'); const x = await lerAd(); assert.equal(x.status, 200, x.t); assert.deepEqual(x.j.items.map((i) => i.key), ['category:carta-do-dia', 'category:monitoria', 'category:outros']); assert.deepEqual(Object.values(x.j.versions), [1, 1, 1]);
    como('tarologa'); assert.equal((await lerAd()).status, 403); assert.equal((await gravarAd({ kind: 'category', category: cat('c9', 'Nova') }, 0)).status, 403);
  });
  await passo('categoria nova: a assistente cria (versão 1); a atendente e a supervisora recebem a frase do front; nome repetido e vazio recusados', async () => {
    como('assistente'); let x = await gravarAd({ kind: 'category', category: cat('c-tarot', 'Tarot básico') }, 0); assert.equal(x.status, 200, x.t); assert.equal(x.j.versions['category:c-tarot'], 1);
    for (const perfil of ['atendente', 'supervisora']) { como(perfil); x = await gravarAd({ kind: 'category', category: cat('c-x', 'Outra') }, 0); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Seu acesso não permite alterar pagamentos.'); }
    como('assistente'); x = await gravarAd({ kind: 'category', category: cat('c-y', 'monitória') }, 0); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Esta categoria já existe.');
    x = await gravarAd({ kind: 'category', category: cat('c-z', ' ') }, 0); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Informe o nome da categoria, com até 60 caracteres.');
  });
  await passo('revisar categoria (Configurações): a supervisora renomeia e inativa; o servidor carimba a revisão; Outros e a atendente são recusados; versão velha: 409', async () => {
    como('supervisora'); const atual = (await lerAd()).j.items.find((i) => i.key === 'category:c-tarot').category;
    const nova = { ...atual, name: 'Tarot avançado', active: false, revisions: [{ name: 'Tarot avançado', active: false, at: '2000-01-01T00:00:00.000Z', by: 'Hacker' }] };
    let x = await gravarAd({ kind: 'category', category: nova }, 1); assert.equal(x.status, 200, x.t); const rev = x.j.items[0].category.revisions[0]; assert.equal(rev.by, 'Clara'); assert.notEqual(rev.at, '2000-01-01T00:00:00.000Z'); assert.equal(x.j.versions['category:c-tarot'], 2);
    x = await gravarAd({ kind: 'category', category: nova }, 1); assert.equal(x.status, 409, x.t);
    x = await gravarAd({ kind: 'category', category: cat('outros', 'Outros', { active: false }) }, 1); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Outros permanece disponível para descrever um adicional avulso.');
    como('atendente'); x = await gravarAd({ kind: 'category', category: { ...nova, name: 'X' } }, 2); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'O cadastro de adicionais não está disponível para edição.');
    como('supervisora'); x = await gravarAd({ kind: 'category', category: cat('monitoria', 'Monitoria 2', { active: true, revisions: [{ name: 'Monitoria 2', active: true, at: 'x', by: 'y' }] }) }, 1); assert.equal(x.status, 200, x.t); assert.equal(x.j.versions['category:monitoria'], 2);
  });
  await passo('regra por unidade: a assistente cria (carimbo do servidor); profissional que não existe, categoria inativa, data passada e perfil sem acesso recebem as frases do front', async () => {
    como('assistente'); const cat2 = (await lerAd()).j.items.find((i) => i.key === 'category:monitoria').category;
    let x = await gravarAd({ kind: 'rule', rule: regra('R1', { categoryName: cat2.name }) }, 0); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].rule.history[0].by, 'Assist'); assert.notEqual(x.j.items[0].rule.history[0].at, '2000-01-01T00:00:00.000Z'); assert.equal(x.j.versions['rule:R1'], 1);
    const frases = [[regra('R2', { tarotId: '7777', categoryName: cat2.name }), 'Selecione a profissional.'], [regra('R3', { categoryId: 'c-tarot', categoryName: 'Tarot avançado' }), 'Selecione uma categoria ativa cadastrada.'],
      [regra('R4', { startDate: '2020-01-01', categoryName: cat2.name }), 'Escolha a primeira data de lançamento a partir de hoje. Não geramos períodos retroativos.'], [regra('R5', { value: { kind: 'fixed', amount: 0 }, categoryName: cat2.name }), 'Informe um valor positivo válido e a unidade, quando aplicável.'],
      [regra('R6', { categoryId: 'outros', categoryName: 'Outros', description: ' ' }), 'Descreva qual é o adicional em Outros.']];
    for (const [rec, frase] of frases) { x = await gravarAd({ kind: 'rule', rule: rec }, 0); assert.equal(x.status, 422, x.t); assert.equal(x.j.error.message, frase); }
    como('supervisora'); x = await gravarAd({ kind: 'rule', rule: regra('R7', { categoryName: cat2.name }) }, 0); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Seu acesso não permite alterar pagamentos.');
    como('assistente'); x = await gravarAd({ kind: 'rule', rule: regra('R1', { categoryName: cat2.name }) }, 0); assert.equal(x.status, 409, 'id repetido com versão 0 é conflito');
  });
  await passo('ocorrência: só a devida nasce (pendente, por unidade); data que não é devida e id inventado são recusados', async () => {
    como('assistente'); let x = await gravarAd({ kind: 'occurrence', occurrence: oc('R1', hoje) }, 0); assert.equal(x.status, 200, x.t); assert.equal(x.j.items[0].occurrence.status, 'pending');
    x = await gravarAd({ kind: 'occurrence', occurrence: oc('R1', '2026-01-01') }, 0); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Este período não é devido nesta recorrência.');
    x = await gravarAd({ kind: 'occurrence', occurrence: oc('R1', hoje, { status: 'posted', adjustmentId: 'AJ-x' }) }, 1); assert.equal(x.status, 422, x.t);
  });
  await passo('regra de valor fixo: a ocorrência nasce lançada e o servidor devolve o lançamento (ajuste) calculado, sem guardar o ajuste', async () => {
    como('assistente'); const cat2 = (await lerAd()).j.items.find((i) => i.key === 'category:monitoria').category;
    let x = await gravarAd({ kind: 'rule', rule: regra('R8', { categoryName: cat2.name, value: { kind: 'fixed', amount: 25 }, frequency: 'monthly' }) }, 0); assert.equal(x.status, 200, x.t);
    x = await gravarAd({ kind: 'occurrence', occurrence: oc('R8', hoje, { status: 'posted', adjustmentId: `AJ-PAO:R8:${hoje}` }) }, 0); assert.equal(x.status, 200, x.t);
    const o = x.j.items[0]; assert.equal(o.occurrence.status, 'posted'); assert.equal(o.adjustment.amount, 25); assert.equal(o.adjustment.recurringRuleId, 'R8'); assert.equal(o.adjustment.registeredBy, 'Assist'); assert.match(o.adjustment.description, /^Monitoria 2 · Mensal de /);
    const lida = (await lerAd()).j.items.find((i) => i.key === `occurrence:PAO:R8:${hoje}`); assert.equal(lida.adjustment.amount, 25);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_adicionais_itens WHERE item::text LIKE '%\"amount\"%' AND tipo = 'ocorrencia'"), 0, 'o ajuste não é guardado');
  });
  const chaveOc = `occurrence:PAO:R1:${hoje}`;
  await passo('conferir a quantidade: zero registra período sem serviço; negativo e fora do limite recebem a frase do front; versão velha: 409; atendente é recusada', async () => {
    como('assistente'); const pend = (await lerAd()).j.items.find((i) => i.key === chaveOc).occurrence;
    let x = await gravarAd({ kind: 'occurrence', occurrence: { ...pend, status: 'posted', quantity: -1 } }, 1); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Informe a quantidade realizada, com até duas casas decimais, ou zero.');
    como('atendente'); x = await gravarAd({ kind: 'occurrence', occurrence: { ...pend, status: 'posted', quantity: 2 } }, 1); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Seu acesso não permite alterar pagamentos.');
    como('assistente'); x = await gravarAd({ kind: 'occurrence', occurrence: { ...pend, status: 'posted', quantity: 4, adjustmentId: `AJ-PAO:R1:${hoje}`, resolvedAt: 'x', resolvedBy: 'y' } }, 1); assert.equal(x.status, 200, x.t);
    const o = x.j.items[0]; assert.equal(o.occurrence.quantity, 4); assert.equal(o.occurrence.resolvedBy, 'Assist'); assert.equal(o.adjustment.amount, 14); assert.equal(o.adjustment.quantity, 4); assert.equal(x.j.versions[chaveOc], 2);
    x = await gravarAd({ kind: 'occurrence', occurrence: { ...pend, status: 'skipped', quantity: 0 } }, 1); assert.equal(x.status, 409, x.t);
    x = await gravarAd({ kind: 'occurrence', occurrence: { ...o.occurrence, status: 'skipped', quantity: 0 } }, 2); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Este período já foi conferido ou não está pendente.');
  });
  await passo('pausar e encerrar a recorrência: uma linha a mais no histórico, carimbo do servidor; encerrada não muda mais; histórico adulterado é recusado', async () => {
    como('assistente'); const atual = (await lerAd()).j.items.find((i) => i.key === 'rule:R1').rule;
    const pausa = { ...atual, history: [...atual.history, { action: 'paused', date: hoje, at: 'x', by: 'y' }] };
    let x = await gravarAd({ kind: 'rule', rule: { ...pausa, value: { kind: 'unit', unitValue: 99, unitLabel: 'carta' } } }, 1); assert.equal(x.status, 400, x.t);
    x = await gravarAd({ kind: 'rule', rule: pausa }, 1); assert.equal(x.status, 200, x.t); const h = x.j.items[0].rule.history; assert.equal(h.length, 2); assert.equal(h[1].by, 'Assist'); assert.equal(x.j.versions['rule:R1'], 2);
    const pausadaAntes = (await lerAd()).j.items.find((i) => i.key === 'rule:R1').rule;
    x = await gravarAd({ kind: 'rule', rule: { ...pausadaAntes, history: [...pausadaAntes.history, { action: 'paused', date: hoje, at: 'x', by: 'y' }] } }, 2); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'A situação da recorrência mudou. Confira novamente.');
    const pausada = (await lerAd()).j.items.find((i) => i.key === 'rule:R1').rule;
    const fim = { ...pausada, history: [...pausada.history, { action: 'ended', date: hoje, at: 'x', by: 'y' }] };
    x = await gravarAd({ kind: 'rule', rule: fim }, 2); assert.equal(x.status, 200, x.t);
    x = await gravarAd({ kind: 'rule', rule: { ...fim, history: [...fim.history, { action: 'resumed', date: hoje, at: 'x', by: 'y' }] } }, 3); assert.equal(x.status, 422); assert.equal(x.j.error.message, 'Esta recorrência já foi encerrada.');
  });
  await passo('corrida: duas categorias com o mesmo nome ao mesmo tempo, uma vence e a outra é recusada', async () => {
    como('assistente'); const [a, b] = await Promise.all([gravarAd({ kind: 'category', category: cat('cc-1', 'Corrida') }, 0), gravarAd({ kind: 'category', category: cat('cc-2', 'corrida') }, 0)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 422], `${a.t} | ${b.t}`);
  });

  console.log('Pendência addition: derivada no servidor');
  const orig = require(r('src/gestao-fadas/features/pendencias/pendencias.origem'));
  const antigos = ['GF_FATIA_PAGAMENTOS', 'GF_FATIA_DIVERGENCIAS'].map((k) => [k, process.env[k]]);
  Object.assign(process.env, { GF_FATIA_PAGAMENTOS: 'true', GF_FATIA_DIVERGENCIAS: 'true' });
  orig.definirLeitorDeFontes(null);
  const derivada = async () => (await chamar('GET', '/pending-routing/derived')).j;
  const snap = (extra = {}) => ({ id: `addition:PAO:R9:${hoje}`, occurrence: `PAO:R9:${hoje}`, referenceDate: hoje, financial: true, tone: 'addition', title: 'Adicional: quantidade a conferir', who: 'Ísis', detail: `Monitoria 2 · ${hoje.split('-').reverse().join('/')} · informar hora`, ...extra });
  const chave = (s) => JSON.stringify([s.id, s.occurrence]);
  const evento = (de, para, acao, motivo = 'Conferir isto.') => ({ at: '2000-01-01T00:00:00.000Z', actor: { id: 'Hacker', name: 'Hacker', role: 'administradora' }, action: acao, from: de, to: para, reason: motivo });
  const pendGravar = (record, expectedVersion) => chamar('PUT', '/pending-routing', { operationKey: n(), expectedVersion, record });
  await passo('o servidor deriva a pendência addition: da ocorrência pendente (nome da profissional, categoria, data e unidade), só para quem vê financeiras', async () => {
    como('assistente'); const cat2 = (await lerAd()).j.items.find((i) => i.key === 'category:monitoria').category;
    let x = await gravarAd({ kind: 'rule', rule: regra('R9', { tarotId: '9002', categoryName: cat2.name, value: { kind: 'unit', unitValue: 10, unitLabel: 'hora' } }) }, 0); assert.equal(x.status, 200, x.t);
    x = await gravarAd({ kind: 'occurrence', occurrence: oc('R9', hoje) }, 0); assert.equal(x.status, 200, x.t);
    como('administradora'); const it = (await derivada()).items.find((i) => i.id === `addition:PAO:R9:${hoje}`); assert.ok(it, JSON.stringify(await derivada()).slice(0, 300));
    assert.deepEqual({ ...it }, snap());
    como('atendente'); assert.equal((await derivada()).items.find((i) => i.id === `addition:PAO:R9:${hoje}`), undefined, 'financeira: a atendente não vê');
    como('administradora');
  });
  await passo('encaminhar com o snapshot do servidor: 200; snapshot adulterado: 409 com o texto do front; ocorrência que não existe: 409', async () => {
    como('assistente'); const s = snap();
    let x = await pendGravar({ key: chave(s), snapshot: { ...s, who: 'Outra' }, queue: 'administracao', events: [evento('financeiro', 'administracao', 'forward')] }, 0); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.message, 'A pendência mudou. Atualize a lista e tente novamente.');
    const f = snap({ id: 'addition:PAO:nao-existe:2026-01-01', occurrence: 'PAO:nao-existe:2026-01-01' });
    x = await pendGravar({ key: chave(f), snapshot: f, queue: 'administracao', events: [evento('financeiro', 'administracao', 'forward')] }, 0); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.message, 'Esta pendência não está mais disponível.');
    x = await pendGravar({ key: chave(s), snapshot: s, queue: 'administracao', events: [evento('financeiro', 'administracao', 'forward', 'Administração decide.')] }, 0); assert.equal(x.status, 200, x.t);
  });
  await passo('resolvida: recusada (409) enquanto a quantidade não foi conferida; aceita depois que a assistente confere a quantidade', async () => {
    como('assistente'); const s = snap(); const antes = (await chamar('GET', '/pending-routing')).j.items.find((i) => i.snapshot.id === s.id); const ver = (await chamar('GET', '/pending-routing')).j.versions[antes.key];
    const resolvida = { ...antes, resolvedAt: '2000-01-01T00:00:00.000Z', events: [...antes.events, evento('administracao', 'administracao', 'resolved', 'x')] };
    let x = await pendGravar(resolvida, ver); assert.equal(x.status, 409, x.t); assert.equal(x.j.error.message, 'A pendência mudou. Atualize a lista e tente novamente.');
    const pend = (await lerAd()).j.items.find((i) => i.key === `occurrence:PAO:R9:${hoje}`).occurrence;
    x = await gravarAd({ kind: 'occurrence', occurrence: { ...pend, status: 'posted', quantity: 2, adjustmentId: `AJ-PAO:R9:${hoje}` } }, 1); assert.equal(x.status, 200, x.t);
    assert.equal((await derivada()).items.find((i) => i.id === s.id), undefined, 'conferida, deixa de ser derivada');
    x = await pendGravar(resolvida, ver); assert.equal(x.status, 200, x.t); assert.ok(x.j.items[0].resolvedAt); assert.equal(x.j.items[0].events.at(-1).actor.name, 'Sistema');
  });
  await passo('sem o catálogo de tarólogos (legado fora do ar) a derivação de addition: não roda e a conferência cai para forma e filas', async () => {
    adicionaisSvc.definirCatalogo(async () => { throw new Error('legado fora'); });
    try {
      como('assistente'); const s = snap({ id: `addition:PAO:R9:2026-02-02`, occurrence: 'PAO:R9:2026-02-02' });
      const x = await pendGravar({ key: chave(s), snapshot: s, queue: 'administracao', events: [evento('financeiro', 'administracao', 'forward', 'Sem fonte.')] }, 0); assert.equal(x.status, 200, x.t);
    } finally { adicionaisSvc.definirCatalogo(async () => [{ id: '9001', name: 'Osíris' }, { id: '9002', name: 'Ísis' }]); }
  });
  antigos.forEach(([k, v]) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; });

  console.log('Trilha operacional');
  const ev = (id, extra = {}) => ({ id, category: 'pagamento', action: 'Lançou pagamento', actionCode: 'payment.created', recordId: 'pg-1', detail: 'Pagamento informado.', origin: 'captured', at: new Date().toISOString(), actorName: 'Khloe', actorKind: 'person', after: { valor: 10 }, ...extra });
  const gravarLog = (events, operationKey = n()) => chamar('POST', '/operation-audit', { operationKey, events });
  await passo('qualquer sessão entrega eventos (atendente e taróloga); mesma chave e corpo repete; evento de mesmo id não regrava', async () => {
    como('atendente'); const k = n(); const lote = [ev('log-1'), ev('log-2', { category: 'consulta', action: 'Lançou consulta' })]; let x = await gravarLog(lote, k); assert.equal(x.status, 200, x.t); assert.equal(x.j.stored, 2);
    x = await gravarLog(lote, k); assert.equal(x.status, 200); assert.equal(x.j.stored, 2, 'mesma resposta, sem regravar');
    x = await gravarLog([ev('log-1', { detail: 'Outro texto' }), ev('log-3')]); assert.equal(x.status, 200, x.t); assert.equal(x.j.stored, 1, 'log-1 já existe: vence o primeiro');
    como('tarologa'); x = await gravarLog([ev('log-4', { category: 'consulta' })]); assert.equal(x.status, 200, x.t);
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_log_operacional'), 4);
    assert.equal(await contar("SELECT COUNT(*) AS n FROM gf_log_operacional WHERE id = 'log-1' AND item->>'detail' = 'Pagamento informado.' AND registrado_por = 'Khloe'"), 1);
  });
  await passo('regressão: evento com id longo (o do front passa de 64 caracteres) é gravado; a auditoria guarda só o começo do id (entidade_id tem 64)', async () => {
    como('atendente'); const longo = `pagamento:${'a'.repeat(36)}:${'b'.repeat(120)}`; assert.ok(longo.length > 150);
    const x = await gravarLog([ev(longo)]); assert.equal(x.status, 200, x.t); assert.equal(x.j.stored, 1);
    assert.equal(await contar(`SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'estado-financeiro.log.registrar' AND char_length(entidade_id) <= 64 AND entidade_id LIKE 'pagamento:aaaa%'`), 1);
  });
  await passo('só a administradora lê a trilha (os outros e a taróloga: 403); o conteúdo volta como o navegador o mandou', async () => {
    for (const perfil of ['atendente', 'supervisora', 'assistente', 'tarologa']) { como(perfil); assert.equal((await chamar('GET', '/operation-audit')).status, 403, perfil); }
    como('administradora'); const x = await chamar('GET', '/operation-audit'); assert.equal(x.status, 200, x.t); assert.equal(x.j.items.length, 5); assert.equal(x.j.truncated, false);
    assert.deepEqual(x.j.items.find((i) => i.id === 'log-1').after, { valor: 10 });
  });
  await passo('forma ruim: categoria fora da lista, id repetido na mesma lista, lista vazia ou com mais de 100, o lote do front (400); nada é gravado', async () => {
    como('atendente');
    for (const ruim of [[ev('b-1', { category: 'outra' })], [ev('b-2'), ev('b-2')], [], Array.from({ length: 101 }, (_, i) => ev(`b-${i}-x`)), [ev('b-3', { origin: 'x' })], 'texto']) {
      const x = await gravarLog(ruim); assert.equal(x.status, 400, JSON.stringify(ruim).slice(0, 60));
    }
    assert.equal(await contar('SELECT COUNT(*) AS n FROM gf_log_operacional'), 5);
  });
  await passo('autoria pela sessão (E1.2): autor, papel e tipo forjados no corpo são ignorados; a taróloga não entrega evento de outro perfil (403)', async () => {
    como('atendente'); let x = await gravarLog([ev('forja-1', { actorId: 'FORJADO', actorName: 'Laya', actorRole: 'administradora', actorKind: 'system' })]); assert.equal(x.status, 200, x.t);
    como('tarologa'); x = await gravarLog([ev('forja-2', { category: 'consulta', tarotId: '9001', actorName: 'Laya', actorRole: 'administradora' })]); assert.equal(x.status, 200, x.t);
    x = await gravarLog([ev('forja-3', { category: 'consulta', tarotId: '9002' })]); assert.equal(x.status, 403, x.t);
    como('administradora'); x = await chamar('GET', '/operation-audit'); assert.equal(x.status, 200, x.t);
    const a = x.j.items.find((i) => i.id === 'forja-1'), b = x.j.items.find((i) => i.id === 'forja-2');
    assert.deepEqual([a.actorName, a.actorRole, a.actorKind, a.actorId === 'FORJADO'], ['Khloe', 'atendente', 'person', false]);
    assert.deepEqual([b.actorName, b.actorRole, b.actorKind], ['Osíris', 'tarologa', 'person']);
    assert.ok(!x.j.items.some((i) => i.id === 'forja-3'));
    assert.equal((await contar("SELECT COUNT(*) AS n FROM gf_log_operacional WHERE id = 'forja-1' AND registrado_por = 'Khloe'")), 1);
  });

  console.log('Auditoria, escrita desligada e legado');
  await passo('auditoria: uma linha por gravação aplicada, na mesma transação (sem linha para recusa)', async () => {
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'estado-financeiro.motivo.gravar'") >= 5);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao LIKE 'estado-financeiro.adicional.%'") >= 10);
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao = 'estado-financeiro.log.registrar'") >= 3);
    const escopos = ['estado-financeiro.motivos', 'estado-financeiro.adicionais', 'estado-financeiro.log'];
    assert.equal(await contar(`SELECT COUNT(*) AS n FROM gf_operacoes WHERE escopo IN ('${escopos.join("','")}')`), await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE acao LIKE 'estado-financeiro.%'"));
  });
  await passo('gravação desligada no ambiente: 503 WRITE_DISABLED nos três e nada é gravado; a leitura segue', async () => {
    process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false'; como('administradora');
    const antes = await contar('SELECT (SELECT COUNT(*) FROM gf_motivos_financeiros) + (SELECT COUNT(*) FROM gf_adicionais_itens) + (SELECT COUNT(*) FROM gf_log_operacional) AS n');
    try {
      let x = await gravarMotivo({ id: 'w1', versions: [motivo('w1', { name: 'Desligado' })] }, 0); assert.equal(x.status, 503); assert.equal(x.j.error.code, 'WRITE_DISABLED');
      x = await gravarAd({ kind: 'category', category: cat('w2', 'Desligada') }, 0); assert.equal(x.status, 503);
      x = await gravarLog([ev('w3')]); assert.equal(x.status, 503);
      assert.equal((await lerMotivos()).status, 200); assert.equal((await lerAd()).status, 200); assert.equal((await chamar('GET', '/operation-audit')).status, 200);
    } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
    assert.equal(await contar('SELECT (SELECT COUNT(*) FROM gf_motivos_financeiros) + (SELECT COUNT(*) FROM gf_adicionais_itens) + (SELECT COUNT(*) FROM gf_log_operacional) AS n'), antes);
  });
  await passo('com a flag desligada as seis rotas respondem 404 NOT_FOUND antes da sessão', async () => {
    const era = process.env.GF_FATIA_ESTADO_FINANCEIRO; delete process.env.GF_FATIA_ESTADO_FINANCEIRO;
    try { for (const [m, p] of [['GET', '/financial-reasons'], ['PUT', '/financial-reasons'], ['GET', '/payout-additions'], ['PUT', '/payout-additions'], ['GET', '/operation-audit'], ['POST', '/operation-audit']]) { const x = await chamar(m, p, m === 'GET' ? undefined : {}); assert.equal(x.status, 404, `${m} ${p}`); assert.equal(x.j.error.code, 'NOT_FOUND'); } } finally { process.env.GF_FATIA_ESTADO_FINANCEIRO = era; }
  });
  await passo('o legado não é tocado: nenhuma escrita no MySQL (não configurado aqui)', async () => { assert.equal(process.env.GF_LEGADO_ESCRITA_ENABLED, undefined); });

  srv.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  await sequelize.close().catch(() => {});
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
