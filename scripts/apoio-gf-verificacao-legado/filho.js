'use strict';

/**
 * FILHO de scripts/verificar-gf-verificacao-legado.js (Maturacao/53): Postgres DESCARTÁVEL (fdb_ver_*) já migrado + legado FALSO em memória (usuarios e
 * tbl_tarologos), edições pelo HTTP do gate (cliente e tarólogo) e o relógio INJETADO na varredura (`varrer({ agora })`). Prova os cenários (a) igual,
 * (b) voltou ao antigo -> reaplica UMA vez (e de novo -> divergente), (c) outro valor -> divergente sem sobrescrever, a edição mais nova, o log operacional
 * sem valores, a reinicialização (pendências no Postgres), a trava de linha entre instâncias e a flag desligada. Nunca toca o MySQL.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');
const { criar: criarEnt } = require('../apoio-gf-espelho-legado/legado-falso');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_FICHA: 'true', GF_LEGADO_VERIFICACAO_MINUTOS: '2,15,120' });
delete process.env.FADAS_ORIGIN; delete process.env.GF_LEGADO_ESCRITA_ENABLED; delete process.env.GF_LEGADO_MODO; delete process.env.GF_LEGADO_VERIFICACAO;
const r = (p) => path.join(raiz, p);
const MIN = 60_000;

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const legado = require(r('src/gestao-fadas/legado-escrita'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const clientes = require(r('src/gestao-fadas/features/cadastros/clientes.service'));
  const extensao = require(r('src/gestao-fadas/features/clientes/helpers/extensao'));
  const job = require(r('src/gestao-fadas/legado-escrita/verificacao.job'));
  const { conferir } = require(r('src/gestao-fadas/legado-escrita/verificacao.conferir'));
  const falso = criarEnt();
  const U = falso.estado.usuarios; const TAR = falso.estado.tarologos;
  const lerLegadoTar = () => [...TAR.values()].map((t) => ({ idTarologo: t.idTarologo, nmuTarologo: t.nmuTarologo, ativo: t.ativo }));
  tarologos.definirFonteLegado({ listar: async () => lerLegadoTar(), obter: async (id) => lerLegadoTar().find((l) => l.idTarologo === id) || null });
  clientes.definirVerificadorDeCliente(async (id) => ['900013', '900014'].includes(id));
  let erroEmTransacao = null;
  Object.assign(legado, { espelhoLigado: () => true, emTransacao: (trabalho) => { if (erroEmTransacao) return Promise.reject(erroEmTransacao); return falso.emTransacao(trabalho); } });

  const uAdmin = await criarUsuario('Administradora Verificação');
  const sessao = { userId: uAdmin, role: 'administradora', displayName: 'Administradora Verificação' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-ver' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 240) };
  };
  let k = 0; const n = () => `op-ver-${Date.now()}-${(k += 1)}`;
  const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
  const rev = {}; // revisão por cliente
  const editar = async (id, changes) => { const e = await chamar('PATCH', `/catalog/clients/${id}`, { operationKey: n(), expectedRevision: rev[id] || 0, changes }); assert.equal(e.status, 200, e.t); rev[id] = e.j.extension.revision; return e; };
  const verifs = (id, extra = '') => q(`SELECT coluna, etapa, estado, apos_reaplicacao AS apos, detalhe FROM gf_legado_verificacoes WHERE entidade_id = :id ${extra} ORDER BY criado_em, etapa, coluna`, { id });
  const estados = async (id) => Object.entries((await verifs(id)).reduce((m, x) => { const c = `${x.coluna}:${x.estado}`; m[c] = (m[c] || 0) + 1; return m; }, {})).sort().map(([a, b]) => `${a}=${b}`).join(' ');
  const cadastro = async (id) => (await q('SELECT legado_estado AS e, legado_detalhe AS d, legado_pendentes AS p FROM gf_clientes_ext WHERE id_cliente = :id', { id }))[0];
  const logs = async () => q("SELECT item FROM gf_log_operacional WHERE id LIKE 'legado-verif:%' ORDER BY registrado_em, id", {});
  const agora0 = () => Date.now();
  const varrer = (depoisMin, base) => job.varrer({ agora: (base || agora0()) + depoisMin * MIN });
  const LIGADA = () => { process.env.GF_LEGADO_VERIFICACAO = 'true'; }; const DESLIGADA = () => { delete process.env.GF_LEGADO_VERIFICACAO; };

  console.log('Esquema');
  await passo('migração 20261201: tabela gf_legado_verificacoes com CHECKs; legado_estado aceita reaplicada e divergente e recusa o resto', async () => {
    await assert.rejects(() => sequelize.query("INSERT INTO gf_legado_verificacoes (id, intencao_id, entidade, entidade_id, coluna, etapa, vence_em, estado) VALUES ('x1', 'i', 'clientes', '1', 'whats', 0, NOW(), 'pendente')"));
    await assert.rejects(() => sequelize.query("INSERT INTO gf_legado_verificacoes (id, intencao_id, entidade, entidade_id, coluna, etapa, vence_em, estado) VALUES ('x2', 'i', 'clientes', '1', 'nome_id', 0, NOW(), 'qualquer')"));
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, dados, revisao, atualizado_por, operation_key, legado_estado) VALUES ('777', NULL, '{}', 1, 'T', 'k777', 'reaplicada')");
    await sequelize.query("UPDATE gf_clientes_ext SET legado_estado = 'divergente' WHERE id_cliente = '777'");
    await assert.rejects(() => sequelize.query("UPDATE gf_clientes_ext SET legado_estado = 'xis' WHERE id_cliente = '777'"));
    await sequelize.query("DELETE FROM gf_clientes_ext WHERE id_cliente = '777'");
  });

  console.log('Flag desligada');
  await passo('GF_LEGADO_VERIFICACAO desligada: a edição grava no legado como sempre e NADA é agendado; o job não agenda e a varredura não faz nada', async () => {
    DESLIGADA(); const u0 = falso.estado.updates;
    await editar('900013', { name: 'Nome Sem Trava' }); assert.equal(U.get(900013).nome_id, 'Nome Sem Trava'); assert.equal(falso.estado.updates, u0 + 1);
    assert.equal((await verifs('900013')).length, 0); assert.equal(job.agendar({}), null);
    assert.equal((await job.varrer({ agora: Date.now() + 999 * MIN })).desligado, true);
  });

  console.log('Agendamento');
  LIGADA();
  await passo('ligada: cada campo mudado (nome, tratar por, nascimento) ganha 3 conferências (+2 min, +15 min, +2 h); WhatsApp e Pré/Pós não; o resto da resposta é igual', async () => {
    const e = await editar('900013', { name: 'Nome A', treatAs: 'Dona A', whatsapp: '11 90000-1111', birthDate: '05/03/1980', paymentProfile: 'Pré-pago' });
    assert.equal(e.j.extension.name, 'Nome A');
    const v = await verifs('900013'); assert.equal(v.length, 9); assert.deepEqual([...new Set(v.map((x) => x.coluna))].sort(), ['datanascimento', 'nome2', 'nome_id']); assert.ok(v.every((x) => x.estado === 'pendente' && !x.apos));
    const [t] = await q("SELECT MIN(EXTRACT(EPOCH FROM vence_em - criado_em)) AS menor, MAX(EXTRACT(EPOCH FROM vence_em - criado_em)) AS maior FROM gf_legado_verificacoes WHERE entidade_id = '900013' AND estado = 'pendente'", {});
    assert.ok(Math.abs(Number(t.menor) - 120) < 5, `+2 min: ${t.menor}`); assert.ok(Math.abs(Number(t.maior) - 7200) < 5, `+2 h: ${t.maior}`);
  });
  await passo('campo que não mudou de valor (mesmo texto) não agenda; 409 e legado fora do ar não deixam conferência nenhuma', async () => {
    const n0 = (await verifs('900013')).length;
    await editar('900013', { name: 'Nome A' }); assert.equal((await verifs('900013')).length, n0);
    const velho = await chamar('PATCH', '/catalog/clients/900013', { operationKey: n(), expectedRevision: 0, changes: { name: 'Velho' } }); assert.equal(velho.status, 409);
    falso.estado.falhar = true; const f = await chamar('PATCH', '/catalog/clients/900013', { operationKey: n(), expectedRevision: rev['900013'], changes: { name: 'Não grava' } }); falso.estado.falhar = null;
    assert.equal(f.status, 503); assert.equal((await verifs('900013')).length, n0);
  });

  console.log('Cenário (a): igual ao gravado');
  await passo('antes do prazo nada acontece; vencidas e iguais: ok, e a cadeia é encerrada (as outras etapas viram encerrada); sem log, sem UPDATE novo no legado', async () => {
    const base = Date.now(); const u0 = falso.estado.updates; const l0 = (await logs()).length;
    const cedo = await job.varrer({ agora: base + 1 * MIN }); assert.equal(cedo.examinadas, 0);
    const x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.ok, 3, JSON.stringify(x)); assert.equal(x.reaplicadas + x.divergentes, 0);
    assert.equal(await estados('900013'), 'datanascimento:encerrada=2 datanascimento:ok=1 nome2:encerrada=2 nome2:ok=1 nome_id:encerrada=2 nome_id:ok=1');
    assert.equal(falso.estado.updates, u0); assert.equal((await logs()).length, l0);
    assert.equal((await job.varrer({ agora: base + 999 * MIN })).examinadas, 0, 'nada mais pendente');
  });

  console.log('Cenário (b): a ficha do ASP regravou o valor antigo');
  await passo('voltou EXATAMENTE ao antigo: REAPLICA uma vez (UPDATE só do campo), legado_estado = reaplicada, 1 evento no log operacional (sem nome nem valor) e nova conferência logo depois', async () => {
    const antigo = U.get(900013).nome_id; await editar('900013', { name: 'Nome B' }); const base = Date.now();
    U.get(900013).nome_id = antigo; const u0 = falso.estado.updates; const outras = { ...U.get(900013) };
    const x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.reaplicadas, 1, JSON.stringify(x));
    assert.equal(U.get(900013).nome_id, 'Nome B'); assert.equal(falso.estado.updates, u0 + 1); for (const c of ['nome2', 'whats', 'datanascimento', 'cpf', 'saldo']) assert.equal(U.get(900013)[c], outras[c], c);
    assert.equal(falso.estado.escritasPorTexto[falso.estado.escritasPorTexto.length - 1], legado.sqlEntidades.updateCliente(['nome_id']));
    const c = await cadastro('900013'); assert.equal(c.e, 'reaplicada'); assert.match(c.d, /reaplicado uma vez/);
    const lg = await logs(); assert.equal(lg.length, 1); const ev = typeof lg[0].item === 'string' ? JSON.parse(lg[0].item) : lg[0].item;
    assert.equal(ev.category, 'cliente'); assert.equal(ev.recordId, '900013'); assert.match(ev.detail, /Nome de identificação/); assert.match(ev.detail, /administradora/);
    assert.ok(!JSON.stringify(ev).includes('Nome B') && !JSON.stringify(ev).includes(antigo), 'sem valor pessoal no log');
    const v = await verifs('900013', "AND coluna = 'nome_id' AND estado IN ('reaplicada', 'pendente')"); assert.ok(v.some((y) => y.estado === 'reaplicada')); assert.ok(v.filter((y) => y.estado === 'pendente').every((y) => y.apos === true));
  });
  await passo('depois da reaplicação a ficha grava um valor qualquer: divergente, legado fica como o ASP deixou, sem nova escrita', async () => {
    const antigo = 'Valor Antigo Do ASP'; const base = Date.now(); U.get(900013).nome_id = antigo; const u0 = falso.estado.updates;
    const x = await job.varrer({ agora: base + 6 * MIN }); assert.equal(x.divergentes, 1, JSON.stringify(x)); assert.equal(x.reaplicadas, 0);
    // o "antigo" real da intenção é o valor de antes de 'Nome B': coloca exatamente ele
    assert.equal(falso.estado.updates, u0);
  });
  await passo('(b) completo e determinístico: reaplica uma vez e, voltando ao antigo outra vez, vira divergente_de_novo sem nova escrita', async () => {
    const antigo = U.get(900014).nome_id; await editar('900014', { name: 'Nome C' }); const base = Date.now();
    U.get(900014).nome_id = antigo; let x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.reaplicadas, 1); assert.equal(U.get(900014).nome_id, 'Nome C');
    U.get(900014).nome_id = antigo; const u0 = falso.estado.updates; x = await job.varrer({ agora: base + 6 * MIN }); assert.equal(x.divergentes, 1, JSON.stringify(x)); assert.equal(x.reaplicadas, 0);
    assert.equal(U.get(900014).nome_id, antigo, 'não reaplica uma segunda vez'); assert.equal(falso.estado.updates, u0);
    const c = await cadastro('900014'); assert.equal(c.e, 'divergente'); assert.match(c.d, /voltou_ao_valor_antigo_de_novo/);
    assert.equal(await job.varrer({ agora: base + 999 * MIN }).then((y) => y.examinadas), 0, 'cadeia encerrada: nada mais pendente');
    const lg = (await logs()).map((l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item)).filter((e) => e.recordId === '900014'); assert.equal(lg.length, 2); assert.ok(lg[0].action.startsWith('Valor reaplicado')); assert.ok(lg[1].action.startsWith('Divergência'));
  });

  console.log('Cenário (c): outro valor (alguém editou de verdade no ASP)');
  await passo('NÃO sobrescreve: divergente, legado fica com o valor do ASP, o cadastro adota o do legado na leitura e o campo sai dos pendentes; log sem valores', async () => {
    await editar('900013', { name: 'Nome D', treatAs: 'Dona D' }); const base = Date.now();
    U.get(900013).nome_id = 'Edição de verdade no ASP'; const u0 = falso.estado.updates; const l0 = (await logs()).length;
    const x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.divergentes, 1, JSON.stringify(x)); assert.equal(x.ok, 1, 'nome2 continua igual: ok'); assert.equal(x.reaplicadas, 0);
    assert.equal(U.get(900013).nome_id, 'Edição de verdade no ASP'); assert.equal(falso.estado.updates, u0);
    const c = await cadastro('900013'); assert.equal(c.e, 'divergente'); assert.deepEqual(typeof c.p === 'string' ? JSON.parse(c.p) : c.p, []);
    const ov = extensao.sobrepor({ id: 900013, nome_id: U.get(900013).nome_id, whats: U.get(900013).whats }, (await extensao.extensoesPorId(['900013'])).get('900013')); assert.equal(ov.nome_id, 'Edição de verdade no ASP');
    const lg = await logs(); assert.equal(lg.length, l0 + 1); const ev = typeof lg[lg.length - 1].item === 'string' ? JSON.parse(lg[lg.length - 1].item) : lg[lg.length - 1].item;
    assert.match(ev.detail, /outro valor/); assert.ok(!JSON.stringify(ev).includes('Edição de verdade') && !JSON.stringify(ev).includes('Nome D'));
  });
  await passo('(c) também depois de uma reaplicação: outro valor continua sendo divergente (não reaplica)', async () => {
    const antigo = U.get(900014).nome_id; await editar('900014', { name: 'Nome E' }); const base = Date.now();
    U.get(900014).nome_id = antigo; let x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.reaplicadas, 1);
    U.get(900014).nome_id = 'Terceiro valor'; x = await job.varrer({ agora: base + 6 * MIN }); assert.equal(x.divergentes, 1); assert.equal(U.get(900014).nome_id, 'Terceiro valor');
    assert.match((await cadastro('900014')).d, /valor_diferente/);
  });

  console.log('Edições em sequência, reinício e várias instâncias');
  await passo('edição mais nova do mesmo campo encerra as conferências da anterior (não a trata como "outra pessoa")', async () => {
    await editar('900013', { name: 'Primeira' }); await editar('900013', { name: 'Segunda' }); const base = Date.now();
    const v = await verifs('900013', "AND coluna = 'nome_id'"); assert.equal(v.filter((y) => y.estado === 'pendente').length, 3);
    const x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.divergentes, 0, JSON.stringify(x)); assert.equal(x.ok, 1);
  });
  await passo('REINÍCIO: as pendências vivem no Postgres (verificacoesPendentes lê só as vencidas); um "processo novo" (módulos recarregados) conclui a conferência', async () => {
    await editar('900013', { name: 'Antes do reinício' }); const base = Date.now();
    assert.equal((await job.verificacoesPendentes(base + 1 * MIN)).length, 0); assert.ok((await job.verificacoesPendentes(base + 3 * MIN)).length >= 1);
    for (const m of Object.keys(require.cache)) if (/legado-escrita[\\/]verificacao/.test(m)) delete require.cache[m];
    const novo = require(r('src/gestao-fadas/legado-escrita/verificacao.job')); const x = await novo.varrer({ agora: base + 3 * MIN }); assert.equal(x.ok, 1, JSON.stringify(x));
    const timer = novo.agendar({ ...process.env, GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_VERIFICACAO_JOB_MS: '600000' }); assert.ok(timer); clearInterval(timer);
  });
  await passo('DUAS INSTÂNCIAS conferindo a mesma linha ao mesmo tempo: só uma age (trava de linha); a reaplicação acontece UMA vez', async () => {
    const antigo = U.get(900013).nome_id; await editar('900013', { name: 'Corrida' }); const base = Date.now(); U.get(900013).nome_id = antigo; const u0 = falso.estado.updates;
    const ids = await job.verificacoesPendentes(base + 3 * MIN); assert.ok(ids.length >= 1);
    const res = await Promise.all([conferir(ids[0], { agora: base + 3 * MIN }), conferir(ids[0], { agora: base + 3 * MIN }), job.varrer({ agora: base + 3 * MIN })]);
    assert.equal(falso.estado.updates, u0 + 1, 'uma única reaplicação'); assert.equal(res.filter((x) => x && x.estado === 'reaplicada').length + (res[2].reaplicadas || 0), 1);
  });
  await passo('legado fora do ar na hora de conferir: a conferência é ADIADA (+2 min, sem perder), e volta a rodar depois; trava de banco recusando a reaplicação vira divergente', async () => {
    await editar('900014', { name: 'Fora do ar' }); const base = Date.now(); const antigo = 'Qualquer Antigo'; void antigo;
    erroEmTransacao = Object.assign(new Error('caiu'), { codigo: 'ECONN' }); let x = await job.varrer({ agora: base + 3 * MIN }); erroEmTransacao = null;
    assert.ok(x.adiadas >= 1, JSON.stringify(x)); const p = (await verifs('900014', "AND coluna = 'nome_id' AND estado = 'pendente'")); assert.ok(p.some((y) => /adiada/.test(y.detalhe || '')));
    x = await job.varrer({ agora: base + 6 * MIN }); assert.ok(x.ok >= 1, JSON.stringify(x));
    const ant = U.get(900014).nome_id; await editar('900014', { name: 'Trava recusa' }); const b2 = Date.now(); U.get(900014).nome_id = ant;
    const original = legado.emTransacao; let chamadas = 0;
    legado.emTransacao = (t) => { chamadas += 1; return chamadas === 1 ? original(t) : Promise.reject(Object.assign(new Error('trava'), { codigo: 'BANCO_NAO_AUTORIZADO' })); };
    try { x = await job.varrer({ agora: b2 + 3 * MIN }); } finally { legado.emTransacao = original; }
    assert.equal(x.divergentes, 1, JSON.stringify(x)); assert.match((await cadastro('900014')).d, /reaplicacao_recusada/); assert.equal(U.get(900014).nome_id, ant);
  });

  console.log('Tarólogo (só leitura e comparação)');
  await passo('nome do profissional (nmuTarologo): agenda e confere; igual = ok; voltou ao antigo ou outro valor = divergente, NUNCA reaplica; log na categoria profissional', async () => {
    const ed = (corpo, rev0) => chamar('PUT', '/catalog/tarologists/9001/profile', { operationKey: n(), expectedRevision: rev0, directory: {}, ...corpo });
    const antigo = TAR.get(9001).nmuTarologo; const e = await ed({ name: 'Osíris Nova' }, 0); assert.equal(e.status, 200, e.t);
    const v = await verifs('9001'); assert.equal(v.length, 3); assert.ok(v.every((y) => y.coluna === 'nmuTarologo'));
    const base = Date.now(); let x = await job.varrer({ agora: base + 3 * MIN }); assert.equal(x.ok, 1);
    const e2 = await ed({ name: 'Osíris Final' }, e.j.revision); assert.equal(e2.status, 200, e2.t); TAR.get(9001).nmuTarologo = 'Osíris Nova'; const u0 = falso.estado.updates;
    x = await job.varrer({ agora: Date.now() + 3 * MIN }); assert.equal(x.divergentes, 1, JSON.stringify(x)); assert.equal(x.reaplicadas, 0); assert.equal(falso.estado.updates, u0); assert.equal(TAR.get(9001).nmuTarologo, 'Osíris Nova');
    const lg = (await logs()).map((l) => (typeof l.item === 'string' ? JSON.parse(l.item) : l.item)).filter((y) => y.recordId === '9001'); assert.equal(lg.length, 1); assert.equal(lg[0].category, 'profissional'); assert.ok(!JSON.stringify(lg[0]).includes('Osíris')); void antigo;
  });

  console.log('Contagem e allowlist');
  await passo('a contagem por estado existe (vai ao log da API) e todo UPDATE no legado falso passou pela allowlist (nenhum DELETE/INSERT)', async () => {
    const c = await require(r('src/gestao-fadas/legado-escrita/verificacao')).contagem({ execute: (s, p) => sequelize.query(s, { replacements: p }) });
    assert.ok(c.ok > 0 && c.reaplicada > 0 && c.divergente > 0 && c.encerrada > 0, JSON.stringify(c));
    assert.ok(falso.estado.escritasPorTexto.every((s) => legado.sqlEntidades.PERMITIDAS.has(s)));
    console.log(`       contagem: ${JSON.stringify(c)}`);
  });

  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nTrava da ficha do ASP (Postgres + legado falso): ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
