'use strict';

/**
 * FILHO de scripts/verificar-gf-espelho-legado.js: Postgres DESCARTÁVEL (fdb_leg_*) já migrado + legado FALSO em memória (`legado-falso.js`),
 * pelo HTTP do gate com os services REAIS (clientes, catálogo de tarólogos, cadastro de tarólogo). O MySQL de verdade nunca é tocado.
 * Prova: intenção na transação, escrita só dos campos mexidos, ASP mudando outro campo não é desfeito, falha do legado e reconciliação,
 * recusa permanente, cliente/funcionária inexistente, idempotência, fusão na leitura (legado é a fonte) e espelho desligado (hoje) igual a antes.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');
const { criar } = require('./legado-falso');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_FICHA: 'true' });
delete process.env.FADAS_ORIGIN; delete process.env.GF_LEGADO_ESCRITA_ENABLED;
const r = (p) => path.join(raiz, p);

const LEGADO = [{ idTarologo: 9001, nmuTarologo: 'Tarólogo Fictício A', ativo: 1 }, { idTarologo: 9002, nmuTarologo: 'Tarólogo Fictício B', ativo: 1 }];

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const legado = require(r('src/gestao-fadas/legado-escrita'));
  const entidades = legado.entidades;
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const clientes = require(r('src/gestao-fadas/features/cadastros/clientes.service'));
  const cadastro = require(r('src/gestao-fadas/features/cadastros/cadastro-tarologo.service'));
  const extensao = require(r('src/gestao-fadas/features/clientes/helpers/extensao'));
  const falso = criar();
  const U = falso.estado.usuarios; const TAR = falso.estado.tarologos;
  // O fonte do catálogo lê o nome/ativo do legado FALSO (assim a fusão enxerga o que o espelho escreveu e o que o ASP mudou).
  const lerLegadoTar = () => [...TAR.values()].map((t) => ({ idTarologo: t.idTarologo, nmuTarologo: t.nmuTarologo, ativo: t.ativo }));
  tarologos.definirFonteLegado({ listar: async () => lerLegadoTar(), obter: async (id) => lerLegadoTar().find((l) => l.idTarologo === id) || null });
  cadastro.definirVerificadorLegado(async (id) => LEGADO.some((l) => l.idTarologo === id));
  clientes.definirVerificadorDeCliente(async (id) => ['900013', '900014', '900099', '990002'].includes(id));

  const uAdmin = await criarUsuario('Administradora Espelho');
  const sessao = { userId: uAdmin, role: 'administradora', displayName: 'Administradora Espelho' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-leg' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 240) };
  };
  let k = 0; const n = () => `op-leg-${Date.now()}-${(k += 1)}`;
  const ligar = (v) => { Object.assign(legado, { espelhoLigado: () => v, emTransacao: falso.emTransacao }); };
  const linhaC = async (id) => (await sequelize.query('SELECT legado_estado AS e, legado_detalhe AS d, legado_pendentes AS p, revisao FROM gf_clientes_ext WHERE id_cliente = :id', { replacements: { id } }))[0][0];
  const linhaT = async (id) => (await sequelize.query('SELECT legado_estado AS e, legado_detalhe AS d, legado_pendentes AS p, id_legado FROM gf_tarologos_perfil WHERE tarot_id = :id', { replacements: { id } }))[0][0];
  const velha = (tabela, col, id) => sequelize.query(`UPDATE ${tabela} SET legado_atualizado_em = now() - interval '1 hour' WHERE ${col} = :id`, { replacements: { id } });
  const editar = (id, changes, rev) => chamar('PATCH', `/catalog/clients/${id}`, { operationKey: n(), expectedRevision: rev, changes });
  const nenhuma = { consultasRec: async () => ({ desligado: false, examinadas: 0 }) };
  const antes13 = JSON.stringify(U.get(900013));

  console.log('Esquema');
  await passo('migração: colunas de vínculo nas 2 tabelas, CHECKs, roda de novo sem erro; linhas antigas ficam com os campos pendentes (leitura igual à de antes)', async () => {
    const [c] = await sequelize.query("SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('gf_clientes_ext','gf_tarologos_perfil') AND column_name LIKE 'legado_%' ORDER BY 1,2");
    assert.equal(c.length, 8);
    const [ck] = await sequelize.query("SELECT conname FROM pg_constraint WHERE conname IN ('chk_clientes_ext_legado_estado','chk_clientes_ext_legado_pendentes','chk_tarologos_perfil_espelho_estado','chk_tarologos_perfil_espelho_pendentes')"); assert.equal(ck.length, 4);
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, dados, revisao, atualizado_por, operation_key) VALUES ('900777', '{\"name\":\"Antiga\",\"whatsapp\":\"1\",\"x\":1}', 1, 'T', 'op-antiga-1')");
    await sequelize.query("INSERT INTO gf_tarologos_perfil (tarot_id, id_legado, nome, cadastro_ativo, perfil, revisao, atualizado_por) VALUES ('9099', NULL, 'Antigo', false, '{}', 1, 'T')");
    await require(r('migrations/20261128000000-gestao-fadas-espelho-legado')).up({ sequelize });
    assert.deepEqual((await linhaC('900777')).p, ['name', 'whatsapp']); assert.deepEqual((await linhaT('9099')).p.sort(), ['cadastro_ativo', 'nome']);
    await require(r('migrations/20261128000000-gestao-fadas-espelho-legado')).up({ sequelize });
    await assert.rejects(() => sequelize.query("UPDATE gf_clientes_ext SET legado_estado = 'qualquer' WHERE id_cliente = '900777'"));
  });

  console.log('Cliente: espelho DESLIGADO (o que vale hoje)');
  ligar(false);
  let rev = 0;
  await passo('edição com o espelho desligado: 200, legado intocado, estado nao_espelhada, campos anotados em legado_pendentes, extensão igual à de antes', async () => {
    const e = await editar('900013', { name: 'Nome Novo', whatsapp: '11 99999-0000', paymentProfile: 'Pré-pago' }, 0);
    assert.equal(e.status, 200, e.t); rev = e.j.extension.revision;
    assert.equal(JSON.stringify(U.get(900013)), antes13); assert.equal(falso.estado.updates, 0);
    const l = await linhaC('900013'); assert.equal(l.e, 'nao_espelhada'); assert.deepEqual(l.p.sort(), ['name', 'whatsapp']);
    const g = await chamar('GET', '/catalog/clients?ids=900013'); assert.equal(g.j.extensions['900013'].name, 'Nome Novo'); assert.equal(g.j.extensions['900013'].paymentProfile, 'Pré-pago');
    const ov = extensao.sobrepor({ id: 900013, nome_id: 'Do legado', whats: null }, (await extensao.extensoesPorId(['900013'])).get('900013')); assert.equal(ov.nome_id, 'Nome Novo'); assert.equal(ov.whats, '11 99999-0000');
  });
  await passo('a carga inicial NÃO é automática: a reconciliação normal ignora nao_espelhada; só o comando (incluirNaoEspelhadas) as vê', async () => {
    ligar(true); await velha('gf_clientes_ext', 'id_cliente', '900013');
    try {
      assert.ok(!(await entidades.clientes.candidatas(new Date().toISOString(), 100)).includes('900013'));
      assert.ok((await entidades.clientes.candidatas(new Date().toISOString(), 100, true)).includes('900013'));
    } finally { ligar(false); }
    assert.equal(falso.estado.updates, 0);
  });

  console.log('Cliente: espelho LIGADO');
  ligar(true);
  await passo('lançar o que ficou anotado: escreve nome_id e whats (só esses), mantém nome2/nascimento/horanascimento/cpf/saldo, estado espelhada e pendentes vazio', async () => {
    const x = await entidades.clientes.reconciliar({ idadeMinutos: 10, incluirNaoEspelhadas: true });
    assert.equal(x.espelhadas, 1, JSON.stringify(x));
    const u = U.get(900013); assert.equal(u.nome_id, 'Nome Novo'); assert.equal(u.whats, '11 99999-0000'); assert.equal(u.nome2, ''); assert.equal(u.datanascimento, '1972-01-13 00:00:00'); assert.equal(u.cpf, '000'); assert.equal(u.saldo, '0.00');
    const l = await linhaC('900013'); assert.equal(l.e, 'espelhada'); assert.deepEqual(l.p, []);
  });
  await passo('nova edição: PATCH 200, escrita depois do commit só dos campos mexidos; o que o ASP mudou em OUTRO campo NÃO é desfeito', async () => {
    U.get(900013).nome2 = 'Mudou no ASP'; const n0 = falso.estado.updates;
    const e = await editar('900013', { birthDate: '05/03/1980' }, rev); assert.equal(e.status, 200, e.t); rev = e.j.extension.revision;
    assert.equal(falso.estado.updates, n0 + 1); assert.equal(U.get(900013).datanascimento, '1980-03-05 00:00:00'); assert.equal(U.get(900013).nome2, 'Mudou no ASP'); assert.equal(U.get(900013).horanascimento, '1972-01-13 12:24:00');
    const l = await linhaC('900013'); assert.equal(l.e, 'espelhada'); assert.match(l.d, /^atualizada \(edicao\)/);
    assert.match(falso.estado.escritasPorTexto.at(-1), /^UPDATE usuarios SET datanascimento = \? WHERE id = \? AND nivel = 0$/);
  });
  await passo('Pré/Pós sozinho não toca o legado; repetir a MESMA operationKey não escreve de novo (idempotente); outra chave com os mesmos valores só repete o UPDATE (nunca duplica)', async () => {
    const n0 = falso.estado.updates; const t0 = U.size;
    const p = await editar('900013', { paymentProfile: 'Pós-pago' }, rev); assert.equal(p.status, 200); rev = p.j.extension.revision; assert.equal(falso.estado.updates, n0);
    const chave = n(); const corpo = { operationKey: chave, expectedRevision: rev, changes: { name: 'Nome Final' } };
    const a = await chamar('PATCH', '/catalog/clients/900013', corpo); assert.equal(a.status, 200); rev = a.j.extension.revision; assert.equal(falso.estado.updates, n0 + 1);
    const b = await chamar('PATCH', '/catalog/clients/900013', corpo); assert.equal(b.status, 200); assert.equal(falso.estado.updates, n0 + 1, 'repetição com a mesma chave não escreve');
    const c = await editar('900013', { name: 'Nome Final' }, rev); assert.equal(c.status, 200); rev = c.j.extension.revision; assert.equal(falso.estado.updates, n0 + 2); assert.equal(U.size, t0); assert.equal(U.get(900013).nome_id, 'Nome Final');
  });
  await passo('fusão na leitura: campo espelhado vem do LEGADO (mudança do ASP aparece; a cópia velha do Postgres não cobre); Pré/Pós segue da extensão', async () => {
    U.get(900013).nome_id = 'Mudou no ASP de novo';
    const g = await chamar('GET', '/catalog/clients?ids=900013'); const ext = g.j.extensions['900013'];
    assert.ok(!('name' in ext) && !('whatsapp' in ext) && !('birthDate' in ext)); assert.equal(ext.paymentProfile, 'Pós-pago'); assert.equal(ext.revision, rev);
    const m = await extensao.extensoesPorId(['900013']); const efetivos = m.get('900013') || {}; assert.ok(!('name' in efetivos));
    assert.equal(extensao.sobrepor({ id: 900013, nome_id: U.get(900013).nome_id }, efetivos).nome_id, 'Mudou no ASP de novo');
  });
  await passo('legado cai: PATCH continua 200 (já gravado no Postgres), estado erro com o motivo, campos seguem pendentes, legado intacto', async () => {
    falso.estado.falhar = true; const foto = JSON.stringify(U.get(900014)); const n0 = falso.estado.updates;
    const e = await editar('900014', { name: 'Quedas' }, 0); assert.equal(e.status, 200, e.t); falso.estado.falhar = null;
    const l = await linhaC('900014'); assert.equal(l.e, 'erro'); assert.match(l.d, /ECONN/); assert.deepEqual(l.p, ['name']); assert.equal(JSON.stringify(U.get(900014)), foto); assert.equal(falso.estado.updates, n0);
    const g = await chamar('GET', '/catalog/clients?ids=900014'); assert.equal(g.j.extensions['900014'].name, 'Quedas', 'enquanto pendente, a edição segue visível');
  });
  await passo('a segunda edição soma os pendentes: ao funcionar, escreve os DOIS campos em um UPDATE; antes disso a reconciliação recente é adiada', async () => {
    falso.estado.falhar = true; const e1 = await editar('900014', { whatsapp: '11 98888-7777' }, 1); assert.equal(e1.status, 200); falso.estado.falhar = null;
    assert.deepEqual((await linhaC('900014')).p.sort(), ['name', 'whatsapp']);
    assert.equal((await entidades.clientes.reconciliar({ idadeMinutos: 10 })).examinadas, 0, 'recente: pode estar em andamento');
    await velha('gf_clientes_ext', 'id_cliente', '900014'); const x = await legado.reconciliacao.reconciliarTudo({ idadeMinutos: 10, env: { GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_CLIENTES: 'true' }, ...nenhuma });
    assert.equal(x.clientes.examinadas, 1); assert.equal(x.clientes.espelhadas, 1);
    assert.equal(U.get(900014).nome_id, 'Quedas'); assert.equal(U.get(900014).whats, '11 98888-7777'); assert.equal(U.get(900014).nome2, 'Dona'); assert.deepEqual((await linhaC('900014')).p, []); assert.equal((await linhaC('900014')).e, 'espelhada');
  });
  await passo('reexecutar a reconciliação é inofensivo (nada pendente, nada escrito)', async () => {
    const n0 = falso.estado.updates; const x = await legado.reconciliacao.reconciliarTudo({ idadeMinutos: 0, env: { GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_CLIENTES: 'true' }, ...nenhuma });
    assert.equal(x.clientes.examinadas, 0); assert.equal(falso.estado.updates, n0);
  });
  await passo('cliente que não existe no legado: sem_registro, nada escrito, não é repetida; id de FUNCIONÁRIA (nivel 2) nunca é tocado', async () => {
    const n0 = falso.estado.updates; const func = JSON.stringify(U.get(990002));
    for (const id of ['900099', '990002']) { const e = await editar(id, { name: 'Intruso' }, 0); assert.equal(e.status, 200, e.t); const l = await linhaC(id); assert.equal(l.e, 'sem_registro', id); assert.deepEqual(l.p, ['name']); await velha('gf_clientes_ext', 'id_cliente', id); }
    assert.equal(falso.estado.updates, n0); assert.equal(JSON.stringify(U.get(990002)), func);
    assert.equal((await entidades.clientes.reconciliar({ idadeMinutos: 10 })).examinadas, 0);
  });
  await passo('valor que não cabe na coluna (extensão corrompida): erro "recusada", legado intocado, NÃO é repetida pela reconciliação até nova edição', async () => {
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, dados, revisao, atualizado_por, operation_key) VALUES ('900014x', '{}', 1, 'T', 'op-x') ON CONFLICT DO NOTHING").catch(() => {});
    await sequelize.query("UPDATE gf_clientes_ext SET dados = jsonb_set(dados, '{name}', to_jsonb(repeat('z', 60))), legado_estado = 'pendente', legado_pendentes = '[\"name\"]', legado_atualizado_em = now() - interval '1 hour' WHERE id_cliente = '900014'");
    const n0 = falso.estado.updates; const x = await entidades.clientes.reconciliar({ idadeMinutos: 10 });
    assert.equal(x.recusadas, 1, JSON.stringify(x)); assert.equal(falso.estado.updates, n0); const l = await linhaC('900014'); assert.equal(l.e, 'erro'); assert.match(l.d, /^recusada: name: acima de 50/);
    await velha('gf_clientes_ext', 'id_cliente', '900014'); assert.equal((await entidades.clientes.reconciliar({ idadeMinutos: 10 })).examinadas, 0);
    const e = await editar('900014', { name: 'Corrigido' }, Number(l.revisao)); assert.equal(e.status, 200, e.t); assert.equal((await linhaC('900014')).e, 'espelhada'); assert.equal(U.get(900014).nome_id, 'Corrigido');
  });

  console.log('Tarólogo');
  const idsTar = async () => (await chamar('GET', '/catalog/tarologists')).j.tarologists;
  const perfil = (id, corpo) => chamar('PUT', `/catalog/tarologists/${id}/profile`, { operationKey: n(), ...corpo });
  await passo('espelho desligado: edição do perfil só no Postgres (legado intocado, estado nao_espelhada), catálogo igual ao de antes', async () => {
    ligar(false); const foto = JSON.stringify(TAR.get(9001));
    const e = await perfil('9001', { expectedRevision: 0, name: 'Osíris Novo', directory: { biography: 'Oi' } }); assert.equal(e.status, 200, e.t);
    assert.equal(JSON.stringify(TAR.get(9001)), foto); const l = await linhaT('9001'); assert.equal(l.e, 'nao_espelhada'); assert.deepEqual(l.p, ['nome']);
    assert.equal((await idsTar()).find((t) => t.id === '9001').name, 'Osíris Novo'); ligar(true);
  });
  let revT = 1;
  await passo('ligado: nome e situação vão para nmuTarologo e ativo (e só eles); nmcTarologo/status/valores intactos; biografia sozinha não escreve', async () => {
    ligar(true); const n0 = falso.estado.updates;
    const e = await perfil('9001', { expectedRevision: revT, name: 'Osíris Espelhado', registrationActive: false }); assert.equal(e.status, 200, e.t); revT = e.j.revision;
    const t = TAR.get(9001); assert.equal(t.nmuTarologo, 'Osíris Espelhado'); assert.equal(t.ativo, 0); assert.equal(t.nmcTarologo, 'osiris'); assert.equal(t.vlCartao, '0.60'); assert.equal(t.status, 1);
    assert.equal(falso.estado.updates, n0 + 1); assert.equal((await linhaT('9001')).e, 'espelhada');
    const b = await perfil('9001', { expectedRevision: revT, directory: { biography: 'Só biografia' } }); assert.equal(b.status, 200); revT = b.j.revision; assert.equal(falso.estado.updates, n0 + 1);
  });
  await passo('fusão: o ASP renomeia depois e o catálogo mostra o nome do LEGADO (cópia do Postgres não cobre); perfil (biografia) segue do Postgres', async () => {
    TAR.get(9001).nmuTarologo = 'Renomeado no ASP';
    const t = (await idsTar()).find((x) => x.id === '9001'); assert.equal(t.name, 'Renomeado no ASP'); assert.equal(t.registrationActive, false); assert.equal(t.directory.biography, 'Só biografia');
  });
  await passo('nome acima de 35 caracteres: Postgres grava (a rota aceita até 120), legado não recebe, estado erro "recusada", catálogo mostra o nome editado e a reconciliação não repete', async () => {
    const longo = 'N'.repeat(36); const n0 = falso.estado.updates; const e = await perfil('9002', { expectedRevision: 0, name: longo }); assert.equal(e.status, 200, e.t);
    assert.equal(TAR.get(9002).nmuTarologo, 'Tarólogo Fictício B'); assert.equal(falso.estado.updates, n0); const l = await linhaT('9002'); assert.equal(l.e, 'erro'); assert.match(l.d, /^recusada: nome: acima de 35/);
    assert.equal((await idsTar()).find((x) => x.id === '9002').name, longo); await velha('gf_tarologos_perfil', 'tarot_id', '9002'); assert.equal((await entidades.tarologos.reconciliar({ idadeMinutos: 10 })).examinadas, 0);
  });
  await passo('aprovação de cadastro para tarólogo que existe no legado também é espelhada (nome); aprovado SEM legado não cria nada no legado', async () => {
    ligar(true); const ficha = (extra = {}) => ({ professionalName: 'Nome Aprovado', fullName: 'Nome Completo', birthDate: '1991-03-04', cpf: '529.982.247-25', phone: '(11) 91234-5678', email: 'novo@exemplo.com', bank: { pix: 'novo@exemplo.com' }, paymentMethods: ['pix'], biography: 'Apresentação', oracles: ['Tarot'], weeklySchedule: { segunda: '9 às 12' }, ...extra });
    for (const [tarotId, esperado] of [['9002', true], ['tarot-sem-legado', false]]) {
      const env = await chamar('POST', '/tarologos-cadastro', { data: ficha({ professionalName: `Aprovado ${tarotId}`.slice(0, 35) }), idempotencyKey: `${tarotId}${Date.now()}`.padEnd(20, 'x').slice(0, 40) }); assert.equal(env.status, 200, env.t);
      const n0 = falso.estado.updates; const ap = await chamar('PUT', '/tarologos-cadastro', { id: env.j.id, revision: 1, status: 'approved', tarotId, data: ficha({ professionalName: `Aprovado ${tarotId}`.slice(0, 35) }) }); assert.equal(ap.status, 200, ap.t);
      assert.equal(falso.estado.updates, n0 + (esperado ? 1 : 0), tarotId); if (esperado) assert.equal(TAR.get(9002).nmuTarologo, 'Aprovado 9002'); else assert.equal((await linhaT(tarotId)).e, 'nao_espelhada');
    }
    assert.equal(TAR.size, 2, 'nenhum tarólogo foi criado no legado');
  });
  await passo('a escrita no legado só acontece pela allowlist: nenhuma instrução fora das 20 passou (o legado falso recusa qualquer outra)', () => {
    assert.ok(falso.estado.escritasPorTexto.length > 4); assert.ok(falso.estado.escritasPorTexto.every((q) => legado.sqlEntidades.PERMITIDAS.has(q)));
    assert.ok(falso.estado.escritasPorTexto.every((q) => !/^(INSERT|DELETE)/i.test(q)));
  });

  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nEspelho das entidades (Postgres + legado falso): ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
