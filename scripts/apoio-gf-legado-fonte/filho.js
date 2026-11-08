'use strict';

/**
 * FILHO de scripts/verificar-gf-legado-fonte.js (Maturacao/46): Postgres DESCARTÁVEL (fdb_lf_*) já migrado + legado FALSO em memória (usuarios, tbl_tarologos
 * e tbl_consultas), pelo HTTP do gate (cliente e tarólogo) e pelos services reais (consulta). Prova o LEGADO PRIMEIRO: o legado recebe dentro do pedido,
 * o Postgres guarda só o novo, legado fora = 503 e NADA salvo, desfazer quando o Postgres falha depois, reconciliação, idempotência e 409. Nunca toca o MySQL.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');
const { criar: criarEnt } = require('../apoio-gf-espelho-legado/legado-falso');
const { criar: criarCons } = require('../apoio-gf-espelho/legado-falso');
const { base } = require('../apoio-gf-consulta/cenarios');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_FICHA: 'true' });
delete process.env.FADAS_ORIGIN; delete process.env.GF_LEGADO_ESCRITA_ENABLED; delete process.env.GF_LEGADO_MODO;
const r = (p) => path.join(raiz, p);
const LEGADO = [{ idTarologo: 9001, nmuTarologo: 'Tarólogo Fictício A', ativo: 1 }, { idTarologo: 9002, nmuTarologo: 'Tarólogo Fictício B', ativo: 1 }];

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const { emTransacao: emPostgres } = require(r('src/gestao-fadas/novo/escritor'));
  const legado = require(r('src/gestao-fadas/legado-escrita'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const clientes = require(r('src/gestao-fadas/features/cadastros/clientes.service'));
  const store = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.store'));
  const espelhoC = require(r('src/gestao-fadas/features/consultas-ciclo/ciclo.espelho'));
  const extensao = require(r('src/gestao-fadas/features/clientes/helpers/extensao'));
  const falso = criarEnt(); const fc = criarCons();
  const U = falso.estado.usuarios; const TAR = falso.estado.tarologos;
  const lerLegadoTar = () => [...TAR.values()].map((t) => ({ idTarologo: t.idTarologo, nmuTarologo: t.nmuTarologo, ativo: t.ativo }));
  tarologos.definirFonteLegado({ listar: async () => lerLegadoTar(), obter: async (id) => lerLegadoTar().find((l) => l.idTarologo === id) || null });
  clientes.definirVerificadorDeCliente(async (id) => ['900013', '900014', '900099', '990002'].includes(id));
  let ligado = true;
  Object.assign(legado, { espelhoLigado: () => ligado, emTransacao: (trabalho, opts) => (opts && opts.entidade === 'consultas' ? fc : falso).emTransacao(trabalho) });

  const uAdmin = await criarUsuario('Administradora Legado Fonte');
  const sessao = { userId: uAdmin, role: 'administradora', displayName: 'Administradora Legado Fonte' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-lf' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 240) };
  };
  let k = 0; const n = () => `op-lf-${Date.now()}-${(k += 1)}`;
  const q = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
  const linhaC = async (id) => (await q('SELECT dados, perfil_pagamento AS pp, legado_estado AS e, legado_detalhe AS d, legado_pendentes AS p, revisao FROM gf_clientes_ext WHERE id_cliente = :id', { id }))[0];
  const linhaT = async (id) => (await q('SELECT nome, cadastro_ativo AS ativo, legado_estado AS e, legado_detalhe AS d, legado_pendentes AS p, revisao FROM gf_tarologos_perfil WHERE tarot_id = :id', { id }))[0];
  const intencoes = async (entidade, id) => q('SELECT estado, detalhe, legado_id AS l, antes, depois FROM gf_legado_intencoes WHERE entidade = :e AND entidade_id = :id ORDER BY criado_em', { e: entidade, id });
  const contagem = async (t) => Number((await q(`SELECT COUNT(*) AS n FROM ${t}`, {}))[0].n);
  const editar = (id, changes, rev, chave) => chamar('PATCH', `/catalog/clients/${id}`, { operationKey: chave || n(), expectedRevision: rev, changes });
  const dados = (l) => (typeof l.dados === 'string' ? JSON.parse(l.dados) : l.dados);

  console.log('Esquema');
  await passo('migração 20261129: tabela gf_legado_intencoes com CHECKs; estado e entidade fora da lista são recusados', async () => {
    assert.equal((await q("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_name = 'gf_legado_intencoes'", {}))[0].n, '12');
    await require(r('migrations/20261129000000-gestao-fadas-legado-fonte')).up({ sequelize });
    await assert.rejects(() => sequelize.query("INSERT INTO gf_legado_intencoes (id, entidade, entidade_id, estado) VALUES ('x1', 'cliente', '1', 'iniciada')"));
    await assert.rejects(() => sequelize.query("INSERT INTO gf_legado_intencoes (id, entidade, entidade_id, estado) VALUES ('x2', 'clientes', '1', 'qualquer')"));
  });

  console.log('Cliente: legado primeiro');
  let rev = 0; const antes13 = { ...U.get(900013) };
  await passo('editar nome, WhatsApp, nascimento e Pré/Pós: o LEGADO recebe os 3 campos; o Postgres guarda só Pré/Pós e a revisão (dados sem os campos do legado); resposta igual à de antes', async () => {
    const e = await editar('900013', { name: 'Nome Novo', whatsapp: '11 99999-0000', birthDate: '05/03/1980', paymentProfile: 'Pós-pago' }, 0);
    assert.equal(e.status, 200, e.t); rev = e.j.extension.revision; assert.equal(rev, 1);
    assert.equal(e.j.extension.name, 'Nome Novo'); assert.equal(e.j.extension.whatsapp, '11 99999-0000'); assert.equal(e.j.extension.birthDate, '05/03/1980'); assert.equal(e.j.extension.paymentProfile, 'Pós-pago');
    const u = U.get(900013); assert.equal(u.nome_id, 'Nome Novo'); assert.equal(u.whats, '11 99999-0000'); assert.equal(u.datanascimento, '1980-03-05 00:00:00');
    assert.equal(u.nome2, antes13.nome2); assert.equal(u.cpf, antes13.cpf); assert.equal(u.saldo, antes13.saldo); assert.equal(u.horanascimento, antes13.horanascimento);
    const l = await linhaC('900013'); assert.deepEqual(dados(l), {}); assert.equal(l.pp, 'Pós-pago'); assert.equal(l.e, 'espelhada'); assert.deepEqual(l.p, []);
    const i = await intencoes('clientes', '900013'); assert.equal(i.length, 1); assert.equal(i[0].estado, 'concluida'); assert.equal(i[0].l, '900013');
    const [a] = await q("SELECT antes, depois FROM gf_auditoria WHERE acao = 'cadastros.cliente.editar' AND entidade_id = '900013' ORDER BY ocorrido_em DESC LIMIT 1", {});
    assert.equal((typeof a.depois === 'string' ? JSON.parse(a.depois) : a.depois).legado.nome_id, 'Nome Novo'); assert.equal((typeof a.antes === 'string' ? JSON.parse(a.antes) : a.antes) === null, false === true);
  });
  await passo('leitura: GET /catalog/clients traz só o novo (Pré/Pós, revisão); nome, WhatsApp e nascimento vêm do legado (a fusão mostra o do legado, inclusive o que o ASP muda depois)', async () => {
    const g = await chamar('GET', '/catalog/clients?ids=900013'); const x = g.j.extensions['900013'];
    assert.equal(x.paymentProfile, 'Pós-pago'); assert.equal(x.revision, 1); assert.equal(x.name, undefined); assert.equal(x.whatsapp, undefined);
    U.get(900013).nome_id = 'O ASP renomeou';
    const ov = extensao.sobrepor({ id: 900013, nome_id: U.get(900013).nome_id, whats: U.get(900013).whats }, (await extensao.extensoesPorId(['900013'])).get('900013')); assert.equal(ov.nome_id, 'O ASP renomeou');
    U.get(900013).nome_id = 'Nome Novo';
  });
  await passo('mesma operationKey repetida: devolve a mesma resposta, NÃO grava de novo no legado e não cria operação nova', async () => {
    const chave = n(); const u0 = falso.estado.updates;
    const a = await editar('900013', { whatsapp: '11 98888-7777' }, 1, chave); assert.equal(a.status, 200, a.t); const u1 = falso.estado.updates; assert.equal(u1, u0 + 1);
    const ops = await contagem('gf_operacoes'); const b = await editar('900013', { whatsapp: '11 98888-7777' }, 1, chave);
    assert.equal(b.status, 200); assert.deepEqual(b.j.extension, a.j.extension); assert.equal(falso.estado.updates, u1); assert.equal(await contagem('gf_operacoes'), ops); rev = a.j.extension.revision;
    assert.equal(U.get(900013).whats, '11 98888-7777');
  });
  await passo('409 VERSION_CHANGED (revisão velha): nada é escrito no legado', async () => {
    const u0 = falso.estado.updates; const e = await editar('900013', { name: 'Velho' }, 0); assert.equal(e.status, 409, e.t); assert.equal(falso.estado.updates, u0); assert.equal(U.get(900013).nome_id, 'Nome Novo');
  });
  await passo('regra do front (nome acima de 50): 422 com a frase de sempre, legado intocado', async () => {
    const u0 = falso.estado.updates; const e = await editar('900013', { name: 'x'.repeat(51) }, rev); assert.equal(e.status, 422); assert.match(e.j.error.message, /Nome de identificação/); assert.equal(falso.estado.updates, u0);
  });
  await passo('LEGADO FORA DO AR: 503 com mensagem neutra e NADA salvo (sem revisão nova, sem operação, sem auditoria, Pré/Pós intacto); a intenção fica revertida; depois, a mesma chave funciona', async () => {
    const antes = await linhaC('900013'); const ops = await contagem('gf_operacoes'); const aud = await contagem('gf_auditoria'); const chave = n();
    falso.estado.falhar = true; const e = await editar('900013', { name: 'Não deve gravar', paymentProfile: 'Pré-pago' }, rev, chave); falso.estado.falhar = null;
    assert.equal(e.status, 503, e.t); assert.equal(e.j.error.code, 'SERVICE_UNAVAILABLE'); assert.match(e.j.error.message, /acessar o serviço/, 'a mensagem que o front já tem para 503');
    const depois = await linhaC('900013'); assert.equal(Number(depois.revisao), Number(antes.revisao)); assert.equal(depois.pp, 'Pós-pago');
    assert.equal(await contagem('gf_operacoes'), ops); assert.equal(await contagem('gf_auditoria'), aud); assert.equal(U.get(900013).nome_id, 'Nome Novo');
    const i = await intencoes('clientes', '900013'); assert.equal(i[i.length - 1].estado, 'revertida');
    const ok = await editar('900013', { name: 'Gravou agora', paymentProfile: 'Pré-pago' }, rev, chave); assert.equal(ok.status, 200, ok.t); rev = ok.j.extension.revision; assert.equal(U.get(900013).nome_id, 'Gravou agora');
  });
  await passo('o Postgres falha DEPOIS de o legado receber: o legado volta ao valor anterior (desfazer), nada fica no Postgres e a intenção fica revertida', async () => {
    const original = legado.entidades.clientes.marcar; const antesNome = U.get(900013).nome_id; const antesRev = (await linhaC('900013')).revisao;
    legado.entidades.clientes.marcar = async () => { throw new Error('Postgres caiu'); };
    let e; try { e = await editar('900013', { name: 'Vai desfazer' }, rev); } finally { legado.entidades.clientes.marcar = original; }
    assert.equal(e.status, 503, e.t); assert.equal(U.get(900013).nome_id, antesNome); assert.equal((await linhaC('900013')).revisao, antesRev);
    const i = await intencoes('clientes', '900013'); assert.equal(i[i.length - 1].estado, 'revertida');
  });
  await passo('o Postgres falha depois e o ASP já tinha mudado o campo: NÃO se sobrescreve o ASP (divergente, decisão humana)', async () => {
    const original = legado.entidades.clientes.marcar;
    legado.entidades.clientes.marcar = async () => { U.get(900013).nome_id = 'ASP mudou no meio'; throw new Error('Postgres caiu'); };
    let e; try { e = await editar('900013', { name: 'Outro nome' }, rev); } finally { legado.entidades.clientes.marcar = original; }
    assert.equal(e.status, 503); assert.equal(U.get(900013).nome_id, 'ASP mudou no meio'); const i = await intencoes('clientes', '900013'); assert.equal(i[i.length - 1].estado, 'divergente');
    U.get(900013).nome_id = 'Gravou agora';
  });
  await passo('queda do processo (intenção iniciada, pedido sem registro): a reconciliação devolve o legado; com o pedido registrado, só conclui; o que o ASP mudou depois é divergente', async () => {
    const it = require(r('src/gestao-fadas/legado-escrita/intencoes')); const depoisNome = 'Escrito e caiu';
    const abrir = (chave, antes, depois, id = '900013') => it.abrir({ entidade: 'clientes', entidadeId: id, escopo: 'cadastros.cliente.editar', operationKey: chave, legadoId: id, antes, depois });
    const a = await abrir('op-queda-1', { nome_id: 'Gravou agora' }, { nome_id: depoisNome }); U.get(900013).nome_id = depoisNome;
    const b = await abrir('op-queda-2', { nome_id: 'Antes B' }, { nome_id: 'Depois B' }, '900014'); const nomeB = U.get(900014).nome_id;
    await q(`INSERT INTO gf_operacoes (escopo, chave, hash_corpo, resposta) VALUES ('cadastros.cliente.editar', 'op-queda-2', '${'a'.repeat(64)}', '{}')`, {});
    const c = await abrir('op-queda-3', { nome_id: 'Antes C' }, { nome_id: 'Depois C' }, '900014'); U.get(900014).nome_id = 'ASP depois';
    const rec = await legado.reconciliacao.reconciliarIntencoes({ idadeMinutos: 0, agora: Date.now() + 60000, env: { GF_LEGADO_ESCRITA_ENABLED: 'true' } });
    assert.equal(rec.examinadas, 3, JSON.stringify(rec));
    const est = async (id) => (await q('SELECT estado FROM gf_legado_intencoes WHERE id = :id', { id }))[0].estado;
    assert.equal(await est(a), 'revertida'); assert.equal(await est(b), 'concluida'); assert.equal(await est(c), 'divergente');
    assert.equal(U.get(900013).nome_id, 'Gravou agora', 'revertida'); assert.equal(U.get(900014).nome_id, 'ASP depois', 'o ASP mudou: não se sobrescreve (b só concluiu)');
    U.get(900014).nome_id = nomeB;
  });
  await passo('dado ANTIGO só no Postgres (carga ainda não enviada) segue legível como fallback; editar o campo pelo legado primeiro o tira do Postgres', async () => {
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, dados, revisao, atualizado_por, operation_key, legado_estado, legado_pendentes) VALUES ('900014', '{\"name\":\"Antiga\",\"whatsapp\":\"1\"}', 1, 'T', 'op-antiga-lf', 'nao_espelhada', '[\"name\",\"whatsapp\"]')");
    const g = await chamar('GET', '/catalog/clients?ids=900014'); assert.equal(g.j.extensions['900014'].name, 'Antiga');
    const e = await editar('900014', { name: 'Agora no legado' }, 1); assert.equal(e.status, 200, e.t); assert.equal(U.get(900014).nome_id, 'Agora no legado');
    const l = await linhaC('900014'); assert.deepEqual(dados(l), { whatsapp: '1' }); assert.deepEqual(l.p, ['whatsapp']); assert.equal(l.e, 'nao_espelhada');
    assert.equal(e.j.extension.name, 'Agora no legado'); assert.equal(e.j.extension.whatsapp, '1');
  });
  await passo('só Pré/Pós (nenhum campo do legado): o legado nem é chamado', async () => {
    const u0 = falso.estado.updates; const e = await editar('900013', { paymentProfile: 'Pré-pago' }, (await linhaC('900013')).revisao); assert.equal(e.status, 200, e.t); assert.equal(falso.estado.updates, u0);
  });
  await passo('flag desligada: comportamento de antes (edição só no Postgres, nao_espelhada, legado intocado)', async () => {
    ligado = false; const u0 = falso.estado.updates; const nome = U.get(900013).nome_id;
    try { const e = await editar('900013', { name: 'Só Postgres' }, (await linhaC('900013')).revisao); assert.equal(e.status, 200, e.t); } finally { ligado = true; }
    assert.equal(falso.estado.updates, u0); assert.equal(U.get(900013).nome_id, nome); const l = await linhaC('900013'); assert.equal(l.e, 'nao_espelhada'); assert.deepEqual(l.p, ['name']);
    const e2 = await editar('900013', { name: 'Voltou pro legado' }, l.revisao); assert.equal(e2.status, 200); assert.equal(U.get(900013).nome_id, 'Voltou pro legado'); const l2 = await linhaC('900013'); assert.deepEqual(dados(l2), {}); assert.equal(l2.e, 'espelhada');
  });

  await passo('doc 47: nome de identificação já usado por outra cliente (sem diferenciar maiúscula) ou igual ao ID: 422 e legado intocado', async () => {
    const u0 = falso.estado.updates; const r1 = await editar('900013', { name: U.get(900014).nome_id.toUpperCase() }, (await linhaC('900013')).revisao); assert.equal(r1.status, 422, r1.t); assert.match(r1.j.error.message, /já existe/);
    const r2 = await editar('900013', { name: '900013' }, (await linhaC('900013')).revisao); assert.equal(r2.status, 422); assert.equal(falso.estado.updates, u0);
  });

  console.log('Tarólogo: legado primeiro');
  const ed = (id, corpo, rev0, chave) => chamar('PUT', `/catalog/tarologists/${id}/profile`, { operationKey: chave || n(), expectedRevision: rev0, directory: {}, ...corpo });
  let revT = 0;
  await passo('nome e situação vão para tbl_tarologos (nmuTarologo, ativo); o perfil do Postgres NÃO guarda nome nem situação; o catálogo mostra o do legado; nmcTarologo/status intactos', async () => {
    const e = await ed('9001', { name: 'Osíris Renomeada', registrationActive: false }, 0); assert.equal(e.status, 200, e.t); revT = e.j.revision;
    const t = TAR.get(9001); assert.equal(t.nmuTarologo, 'Osíris Renomeada'); assert.equal(t.ativo, 0); assert.equal(t.nmcTarologo, 'osiris'); assert.equal(t.status, 1);
    assert.equal(e.j.tarologist.name, 'Osíris Renomeada'); assert.equal(e.j.tarologist.registrationActive, false);
    const l = await linhaT('9001'); assert.equal(l.nome, null); assert.equal(l.ativo, null); assert.equal(l.e, 'espelhada'); assert.deepEqual(l.p, []);
    const g = await chamar('GET', '/catalog/tarologists'); const it = g.j.tarologists.find((x) => x.id === '9001'); assert.equal(it.name, 'Osíris Renomeada'); assert.equal(it.registrationActive, false);
    TAR.get(9001).nmuTarologo = 'O ASP mudou'; const g2 = await chamar('GET', '/catalog/tarologists'); assert.equal(g2.j.tarologists.find((x) => x.id === '9001').name, 'O ASP mudou'); TAR.get(9001).nmuTarologo = 'Osíris Renomeada';
  });
  await passo('biografia sozinha: legado não é chamado; legado fora do ar: 503 e nada salvo (revisão igual)', async () => {
    const u0 = falso.estado.updates; const b = await ed('9001', { directory: { biography: 'Texto novo' } }, revT); assert.equal(b.status, 200, b.t); assert.equal(falso.estado.updates, u0); revT = b.j.revision;
    const antes = await linhaT('9001'); falso.estado.falhar = true; const f = await ed('9001', { name: 'Não grava' }, revT); falso.estado.falhar = null;
    assert.equal(f.status, 503, f.t); assert.equal((await linhaT('9001')).revisao, antes.revisao); assert.equal(TAR.get(9001).nmuTarologo, 'Osíris Renomeada');
  });
  await passo('nome acima de 35 caracteres não cabe em nmuTarologo: NÃO é cortado; fica só no Postgres (pendente, erro "recusada") e o legado não recebe; 409 não escreve', async () => {
    const longo = 'N'.repeat(40); const u0 = falso.estado.updates; const e = await ed('9001', { name: longo }, revT); assert.equal(e.status, 200, e.t); assert.equal(falso.estado.updates, u0);
    const l = await linhaT('9001'); assert.equal(l.nome, longo); assert.equal(l.e, 'erro'); assert.match(l.d, /^recusada/); assert.equal(e.j.tarologist.name, longo);
    const v = await ed('9001', { name: 'Velho' }, 0); assert.equal(v.status, 409); assert.equal(falso.estado.updates, u0);
  });
  await passo('tarólogo SEM linha no legado (cadastro novo): nada a escrever lá, tudo no Postgres como antes', async () => {
    await sequelize.query("INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, nome, cadastro_ativo, perfil, revisao, atualizado_por) VALUES ('nova-sem-legado', NULL, 'Nova', true, '{}', 1, 'T')");
    const u0 = falso.estado.updates; const e = await ed('nova-sem-legado', { name: 'Nova Renomeada' }, 1); assert.equal(e.status, 200, e.t); assert.equal(falso.estado.updates, u0); assert.equal((await linhaT('nova-sem-legado')).nome, 'Nova Renomeada');
  });

  console.log('Consulta: legado primeiro');
  const linhaK = async (id) => (await q('SELECT id_consulta_legado AS l, legado_estado AS e, legado_detalhe AS d FROM gf_consultas_ext WHERE id = :id', { id }))[0];
  const existeK = async (id) => (await q('SELECT 1 AS x FROM gf_consultas_ext WHERE id = :id', { id })).length > 0;
  let seq = 0;
  const lancar = async (item, depoisDoAgendar) => {
    const comp = [];
    try {
      await emPostgres(async (ex) => { ex.posCommit = []; ex.compensacoes = comp; await store.inserir(ex, item, 'Teste', `op-lf-c-${item.id}`); await espelhoC.agendar(ex, { id: item.id, momento: 'lancamento', item }); if (depoisDoAgendar) await depoisDoAgendar(); });
    } catch (e) { for (const f of comp) await f(); throw e; }
  };
  const novo = (extra = {}) => { seq += 1; return base({ id: `lf-${seq}`, clientId: `9100${seq}`, ...extra }); };
  process.env.GF_LEGADO_CONSULTAS = 'true';
  await passo('lançar: a linha entra em tbl_consultas ANTES do commit e o Postgres guarda o objeto completo com o vínculo (id_consulta_legado) e estado espelhada, na mesma transação', async () => {
    const item = novo(); const n0 = fc.estado.linhas.length; await lancar(item);
    assert.equal(fc.estado.linhas.length, n0 + 1); const l = await linhaK(item.id); assert.equal(l.e, 'espelhada'); assert.equal(String(l.l), String(fc.estado.linhas[n0].idConsulta));
    const i = await intencoes('consultas', item.id); assert.equal(i.length, 1); assert.equal(i[0].estado, 'concluida');
  });
  await passo('iniciar/encerrar: UPDATE da linha do legado (sem nova linha), vínculo mantido', async () => {
    const item = novo(); await lancar(item); const n0 = fc.estado.linhas.length;
    const iniciada = { ...item, awaitingTarologistStart: false, tarologistStartedAt: item.startedAt };
    await emPostgres(async (ex) => { ex.posCommit = []; ex.compensacoes = []; await store.atualizar(ex, iniciada, 2); await espelhoC.agendar(ex, { id: item.id, momento: 'inicio', item: iniciada }); });
    assert.equal(fc.estado.linhas.length, n0); assert.equal((await linhaK(item.id)).e, 'espelhada');
  });
  await passo('LEGADO FORA DO AR ao lançar: 503 e a consulta NÃO é salva (nenhuma linha no Postgres, nenhuma no legado)', async () => {
    const item = novo(); const n0 = fc.estado.linhas.length; fc.estado.falharInsert = true;
    await assert.rejects(() => lancar(item), (e) => e.statusCode === 503 && /sistema antigo/.test(e.message)); fc.estado.falharInsert = null;
    assert.equal(await existeK(item.id), false); assert.equal(fc.estado.linhas.length, n0);
    const i = await intencoes('consultas', item.id); assert.equal(i[0].estado, 'revertida');
  });
  await passo('o Postgres falha DEPOIS do INSERT no legado: a linha fica órfã (nunca DELETE), a intenção fica divergente; repetir o lançamento ADOTA a órfã (sem duplicar)', async () => {
    const item = novo(); const n0 = fc.estado.linhas.length;
    await assert.rejects(() => lancar(item, async () => { throw new Error('Postgres caiu'); }), /Postgres caiu/);
    assert.equal(await existeK(item.id), false); assert.equal(fc.estado.linhas.length, n0 + 1); const i = await intencoes('consultas', item.id); assert.equal(i[i.length - 1].estado, 'divergente');
    await lancar(item); assert.equal(fc.estado.linhas.length, n0 + 1, 'adotou: nenhuma linha nova'); const l = await linhaK(item.id); assert.equal(l.e, 'espelhada'); assert.match(`${l.d}`, /adotada/);
  });
  await passo('tarólogo sem código no legado: a consulta é salva só no Postgres (sem_tarologo), sem escrita lá', async () => {
    const item = novo({ tarotId: 'sem-login' }); const n0 = fc.estado.linhas.length; await lancar(item); assert.equal(fc.estado.linhas.length, n0); assert.equal((await linhaK(item.id)).e, 'sem_tarologo');
  });
  await passo('flag de consultas desligada (modo primeiro): nada é escrito no legado e nada é marcado', async () => {
    process.env.GF_LEGADO_CONSULTAS = 'false'; const flagAntes = legado.espelhoLigado; legado.espelhoLigado = (env, ent) => (ent === 'consultas' ? false : ligado);
    try { const item = novo(); const n0 = fc.estado.linhas.length; await lancar(item); assert.equal(fc.estado.linhas.length, n0); assert.equal((await linhaK(item.id)).e, 'nao_espelhada'); } finally { legado.espelhoLigado = flagAntes; process.env.GF_LEGADO_CONSULTAS = 'true'; }
  });

  await passo('doc 47: forma de consulta fora do catálogo do legado: recusa (a linha sumiria no ASP) e a consulta NÃO é salva', async () => {
    const item = novo(); fc.estado.catalogoAusente = 4; const n0 = fc.estado.linhas.length;
    try { await assert.rejects(() => lancar(item), (e) => e.statusCode === 422 && /tbl_formaconsulta|tbl_opcaopagto/.test(e.message)); } finally { fc.estado.catalogoAusente = null; }
    assert.equal(await existeK(item.id), false); assert.equal(fc.estado.linhas.length, n0);
  });

  console.log('Allowlist');
  await passo('toda escrita no legado falso passou pela allowlist (nenhum DELETE, DDL ou outra coluna)', () => {
    assert.ok(falso.estado.escritasPorTexto.length > 5); assert.ok(falso.estado.escritasPorTexto.every((s) => legado.sqlEntidades.PERMITIDAS.has(s)));
  });

  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nLegado como fonte (Postgres + legado falso): ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
