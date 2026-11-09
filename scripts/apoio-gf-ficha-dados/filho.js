'use strict';

/**
 * FILHO de scripts/verificar-gf-ficha-dados.js: roda contra o Postgres DESCARTÁVEL (fdb_ficha_*) já migrado. Prova pelo HTTP do gate (sessão de mentira,
 * clientes do legado SUBSTITUÍDOS por uma lista fixa: o MySQL legado nem é configurado): migração idempotente e CHECKs, gravação da ficha pelo PATCH
 * (nome completo, CPF, e-mail, telefones, endereço), leitura por perfil, idempotência, atomicidade, corrida, Pré/Pós só Pós -> Pré, auditoria sem CPF,
 * leitura combinada com o legado (somente leitura) e a Lilly que não apaga a ficha.
 */

const path = require('path');
const assert = require('assert');
const express = require('express');
const { raiz, passo, resumo, criarUsuario } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, { GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GESTAO_FADAS_ENABLED: 'true', GF_FATIA_CADASTROS: 'true', GF_FATIA_FICHA: 'true' });
delete process.env.FADAS_ORIGIN;
const r = (p) => path.join(raiz, p);
const CLIENTES = ['900021', '900022', '900023', '900024', '900025'];
const FONES = ['+55 11 98888-7777', '+55 21 93333-4444'];
const ENDERECO = { street: 'Rua B', number: '2', complement: '', district: 'Centro', zip: '50000-000', city: 'Olinda', state: 'PE', country: '' };

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarGate } = require(r('src/gestao-fadas/gate'));
  const clientes = require(r('src/gestao-fadas/features/cadastros/clientes.service'));
  clientes.definirVerificadorDeCliente(async (id) => CLIENTES.includes(id));
  const uAdmin = await criarUsuario('Administradora Ficha');
  const uStaff = await criarUsuario('Atendente Ficha');
  let sessao = { userId: uAdmin, role: 'administradora', displayName: 'Administradora Ficha' };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: { validar: async () => ({ status: 'identity', identity: sessao, sessionId: 'sessao-ficha' }) }, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((f) => srv.once('listening', f));
  const origem = `http://127.0.0.1:${srv.address().port}`;
  const chamar = async (metodo, p, corpo) => {
    const resp = await fetch(`${origem}/api${p}`, { method: metodo, headers: { 'content-type': 'application/json', ...(metodo === 'GET' ? {} : { origin: origem }) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text();
    let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, t: t.slice(0, 300) };
  };
  const como = (perfil) => { sessao = { userId: perfil === 'administradora' ? uAdmin : uStaff, role: perfil, displayName: `Teste ${perfil}` }; };
  const n = () => { n.i = (n.i || 0) + 1; return `op-ficha-${Date.now()}-${n.i}`; };
  const patch = (id, expectedRevision, changes, operationKey = n()) => chamar('PATCH', `/catalog/clients/${id}`, { operationKey, expectedRevision, changes });
  const lerExt = async (id) => (await chamar('GET', `/catalog/clients?ids=${id}`)).j.extensions[id];
  const linha = async (id) => (await sequelize.query('SELECT * FROM gf_clientes_ext WHERE id_cliente = :id', { replacements: { id } }))[0][0];
  const contar = async (sql) => Number((await sequelize.query(sql))[0][0].n);

  console.log('Esquema');
  await passo('16 colunas da ficha em gf_clientes_ext (as 2 de contato da migração 20261216) e as migrações rodam de novo sem erro', async () => {
    const colunas = ['nome_completo', 'cpf', 'email', 'email2', 'telefone_comercial', 'telefones', 'telefone_consulta_idx', 'telefone_whatsapp_idx', 'end_rua', 'end_numero', 'end_complemento', 'end_bairro', 'end_cep', 'end_cidade', 'end_uf', 'end_pais'];
    const [t] = await sequelize.query("SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'gf_clientes_ext'");
    for (const c of colunas) assert.ok(t.some((x) => x.c === c), c);
    for (const m of ['20261213000000-gestao-fadas-ficha-dados', '20261216000000-gestao-fadas-ficha-contatos']) { await require(r(`migrations/${m}`)).up({ sequelize }); await require(r(`migrations/${m}`)).up({ sequelize }); }
  });
  await passo('os CHECKs do banco recusam o que a API nunca grava (CPF, e-mail, vazio, espaço nas pontas, telefones, índices, tamanho)', async () => {
    const ruins = [["cpf = '123'"], ["cpf = '111.111.111-1x'"], ["email = 'sem-arroba'"], ["email = ' a@b.com'"], ["email = ''"], ["nome_completo = ''"], ["nome_completo = ' Ana'"], [`nome_completo = '${'A'.repeat(256)}'`],
      ["telefones = '{\"a\":1}'::jsonb"], ["telefones = '[]'::jsonb, telefone_consulta_idx = 0, telefone_whatsapp_idx = 0"], ["telefones = '[\"1\"]'::jsonb"], ["telefones = '[\"1\"]'::jsonb, telefone_consulta_idx = 1, telefone_whatsapp_idx = 0"],
      ["telefone_consulta_idx = 0"], ["email2 = 'sem-arroba'"], ["email2 = ' a@b.com'"], ["email2 = ''"], [`email2 = '${'x'.repeat(95)}@b.com'`], ["telefone_comercial = ''"], ["telefone_comercial = ' 3333-4444'"], [`telefone_comercial = '${'1'.repeat(51)}'`], ["end_uf = ''"], [`end_numero = '${'1'.repeat(21)}'`], ["end_cep = ' 5'"]];
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, atualizado_por, operation_key) VALUES ('800001', 'teste', 'op-base-ficha')");
    for (const [set] of ruins) {
      await assert.rejects(() => sequelize.query(`UPDATE gf_clientes_ext SET ${set} WHERE id_cliente = '800001'`), (e) => /check constraint|too long/i.test(String(e.message)), set);
    }
    await sequelize.query("UPDATE gf_clientes_ext SET cpf = '529.982.247-25', email = 'a@b.com', telefones = '[\"+55 11 98888-7777\"]'::jsonb, telefone_consulta_idx = 0, telefone_whatsapp_idx = 0, end_rua = 'Rua A' WHERE id_cliente = '800001'");
  });

  console.log('Gravação pelo PATCH da ficha (o mesmo caminho do editor)');
  como('administradora');
  const [A, B, C, D, E] = CLIENTES;
  const tudo = { fullName: 'Ana Souza Lima', cpf: '529.982.247-25', email: 'ana@exemplo.com', phones: FONES, consultationPhoneIndex: 1, whatsappPhoneIndex: 0, address: ENDERECO };
  let rev;
  await passo('administradora grava nome completo, CPF, e-mail, telefones e endereço; a resposta e o GET trazem tudo, com a revisão +1', async () => {
    const a = await patch(A, 0, tudo);
    assert.equal(a.status, 200, a.t);
    assert.deepEqual([a.j.extension.fullName, a.j.extension.cpf, a.j.extension.email, a.j.extension.phones, a.j.extension.consultationPhoneIndex, a.j.extension.address.city, a.j.extension.revision], ['Ana Souza Lima', '529.982.247-25', 'ana@exemplo.com', FONES, 1, 'Olinda', 1]);
    const g = await lerExt(A);
    assert.deepEqual(g, a.j.extension);
    rev = g.revision;
    const l = await linha(A);
    assert.deepEqual([l.nome_completo, l.cpf, l.email, l.telefone_consulta_idx, l.telefone_whatsapp_idx, l.end_rua, l.end_complemento, l.end_pais], ['Ana Souza Lima', '529.982.247-25', 'ana@exemplo.com', 1, 0, 'Rua B', null, null]);
  });
  await passo('campo omitido é preservado (só o e-mail muda); identidade e ficha no mesmo pedido gravam juntas', async () => {
    const a = await patch(A, rev, { email: 'nova@exemplo.com', treatAs: 'Aninha' });
    assert.equal(a.status, 200, a.t);
    assert.deepEqual([a.j.extension.email, a.j.extension.cpf, a.j.extension.fullName, a.j.extension.treatAs, a.j.extension.phones, a.j.extension.revision], ['nova@exemplo.com', '529.982.247-25', 'Ana Souza Lima', 'Aninha', FONES, rev + 1]);
    rev += 1;
  });
  await passo('atendente lê nome completo, CPF e e-mail, mas não telefones nem endereço (igual à ficha do legado); supervisão e atendente gravam', async () => {
    como('atendente');
    const g = await lerExt(A);
    assert.deepEqual(Object.keys(g).filter((k) => ['fullName', 'cpf', 'email', 'phones', 'address', 'consultationPhoneIndex', 'whatsappPhoneIndex'].includes(k)).sort(), ['cpf', 'email', 'fullName']);
    const b = await patch(B, 0, { cpf: '111.444.777-35', email: 'bia@exemplo.com' });
    assert.equal(b.status, 200, b.t);
    assert.deepEqual([b.j.extension.cpf, b.j.extension.phones], ['111.444.777-35', undefined]);
    como('administradora');
    assert.deepEqual((await lerExt(B)).cpf, '111.444.777-35');
  });
  await passo('idempotente: a mesma chave repete a resposta sem gravar de novo; a mesma chave com outro corpo é 409; revisão velha é 409', async () => {
    const k = n();
    const um = await patch(C, 0, { email: 'c@exemplo.com' }, k);
    const dois = await patch(C, 0, { email: 'c@exemplo.com' }, k);
    assert.equal(um.status, 200); assert.deepEqual(dois.j, um.j);
    assert.equal((await linha(C)).revisao, 1);
    assert.equal((await patch(C, 0, { email: 'outro@exemplo.com' }, k)).j.error.code, 'OPERATION_KEY_CONFLICT');
    const velha = await patch(C, 0, { email: 'velho@exemplo.com' });
    assert.equal(velha.status, 409); assert.equal(velha.j.error.code, 'VERSION_CHANGED');
    assert.equal((await linha(C)).email, 'c@exemplo.com');
  });
  await passo('transacional: pedido com um campo ruim não grava NENHUM (nem a identidade nem a ficha); revisão e linha ficam como estavam', async () => {
    const antes = await linha(A);
    for (const ruim of [{ treatAs: 'Boa', cpf: '111.111.111-11' }, { email: 'x@y.com', phones: ['abc'] }, { fullName: 'Nome', address: { ...ENDERECO, zip: '123' } }, { email: 'x@y.com', paymentProfile: 'Pós-pago', cpf: '' }]) {
      const x = await patch(A, rev, ruim);
      assert.equal(x.status, 422, JSON.stringify(ruim)); assert.equal(x.j.error.code, 'RULE_VIOLATION');
    }
    const depois = await linha(A);
    assert.deepEqual(depois, antes);
  });
  await passo('o vazio nunca apaga: limpar CPF, e-mail, nome completo ou endereço é 422 e o valor gravado fica', async () => {
    for (const ruim of [{ cpf: '' }, { email: '' }, { fullName: '  ' }, { address: { street: '', number: '', complement: '', district: '', zip: '', city: '', state: '', country: '' } }]) {
      const x = await patch(A, rev, ruim);
      assert.equal(x.status, 422, JSON.stringify(ruim));
    }
    const g = await lerExt(A);
    assert.deepEqual([g.cpf, g.email, g.fullName, g.address.city, g.revision], ['529.982.247-25', 'nova@exemplo.com', 'Ana Souza Lima', 'Olinda', rev]);
  });
  await passo('e-mail 2 e telefone comercial: gravam pelo mesmo PATCH, voltam no GET, o resto fica; vazio é 422 e não apaga; atendente não lê', async () => {
    const a = await patch(A, rev, { email2: ' outro@exemplo.com ', workPhone: '+55 11 3333-4444' });
    assert.equal(a.status, 200, a.t);
    assert.deepEqual([a.j.extension.email2, a.j.extension.workPhone, a.j.extension.email, a.j.extension.cpf, a.j.extension.revision], ['outro@exemplo.com', '+55 11 3333-4444', 'nova@exemplo.com', '529.982.247-25', rev + 1]);
    rev += 1;
    assert.deepEqual(await lerExt(A), a.j.extension);
    const l = await linha(A);
    assert.deepEqual([l.email2, l.telefone_comercial, l.sem_email], ['outro@exemplo.com', '+55 11 3333-4444', null]);
    for (const ruim of [{ email2: '' }, { workPhone: '  ' }, { email2: 'a@b' }, { workPhone: 'x'.repeat(51) }]) assert.equal((await patch(A, rev, ruim)).status, 422, JSON.stringify(ruim));
    assert.deepEqual([(await lerExt(A)).email2, (await lerExt(A)).workPhone, (await lerExt(A)).revision], ['outro@exemplo.com', '+55 11 3333-4444', rev]);
    como('atendente');
    const g = await lerExt(A);
    assert.deepEqual([g.email2, g.workPhone], [undefined, undefined]);
    como('administradora');
  });
  await passo('corrida: dois pedidos com a mesma revisão: um grava, o outro recebe 409 e a linha tem uma só das duas mudanças', async () => {
    const [x, y] = await Promise.all([patch(D, 0, { email: 'x@exemplo.com' }), patch(D, 0, { email: 'y@exemplo.com' })]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    const l = await linha(D);
    assert.equal(l.revisao, 1); assert.ok(['x@exemplo.com', 'y@exemplo.com'].includes(l.email));
  });
  await passo('telefones: a lista inteira é trocada de uma vez, os índices acompanham, e o endereço é gravado como unidade (parte vazia vira NULL)', async () => {
    const a = await patch(A, rev, { phones: ['+55 85 91111-2222'], consultationPhoneIndex: 0, whatsappPhoneIndex: 0, address: { ...ENDERECO, district: '', city: 'Recife' } });
    assert.equal(a.status, 200, a.t); rev += 1;
    const l = await linha(A);
    assert.deepEqual([l.telefones, l.telefone_consulta_idx, l.end_bairro, l.end_cidade], [['+55 85 91111-2222'], 0, null, 'Recife']);
  });

  console.log('Pré/Pós: só Pós -> Pré, definitivo');
  await passo('sem regime NÃO vai para Pós (v711); Pós antigo -> Pré vale e carimba; repetir Pré é sem efeito', async () => {
    const a = await patch(E, 0, { paymentProfile: 'Pós-pago' });
    assert.equal(a.status, 422, a.t); assert.equal(a.j.error.message, 'A cliente pode passar para Pré. Depois disso, não volta para Pós.');
    // O Pós de verdade vem da planilha de saldos (migração), nunca do editor: aqui ele é semeado como a carga o deixaria.
    await sequelize.query("INSERT INTO gf_clientes_ext (id_cliente, perfil_pagamento, dados, revisao, atualizado_por, operation_key) VALUES (:id, 'Pós-pago', '{}', 1, 'semente', 'semente-pos-ficha-dados')", { replacements: { id: E } });
    const b = await patch(E, 1, { paymentProfile: 'Pré-pago' });
    assert.equal(b.status, 200, b.t); assert.equal(b.j.extension.paymentProfile, 'Pré-pago');
    const em = b.j.extension.paymentProfileUpdatedAt;
    const c = await patch(E, 2, { paymentProfile: 'Pré-pago', treatAs: 'Eva' });
    assert.equal(c.status, 200); assert.equal(c.j.extension.paymentProfileUpdatedAt, em, 'repetir o Pré não muda o carimbo');
  });
  await passo('Pré -> Pós e Pré -> "não informado" são 422 com o texto da regra, sem gravar nada (nem os outros campos do pedido)', async () => {
    const antes = await linha(E);
    for (const mud of [{ paymentProfile: 'Pós-pago' }, { paymentProfile: '' }, { paymentProfile: 'Pós-pago', email: 'eva@exemplo.com' }]) {
      const x = await patch(E, 3, mud);
      assert.equal(x.status, 422, JSON.stringify(mud)); assert.equal(x.j.error.code, 'RULE_VIOLATION'); assert.match(x.j.error.message, /não volta para Pós/);
    }
    assert.deepEqual(await linha(E), antes);
  });
  await passo('o histórico não muda com a troca: a linha de auditoria da troca fica e a ordem das revisões segue', async () => {
    assert.ok(await contar("SELECT COUNT(*) AS n FROM gf_auditoria WHERE entidade_id = '900025' AND acao = 'cadastros.cliente.editar'") >= 2);
  });

  console.log('Auditoria e legado');
  await passo('a auditoria guarda os NOMES dos campos da ficha mexidos, nunca CPF, endereço, telefone nem e-mail novos', async () => {
    const [l] = await sequelize.query("SELECT depois::text AS d FROM gf_auditoria WHERE entidade_id = '900021' AND acao = 'cadastros.cliente.editar' ORDER BY ocorrido_em");
    const todo = l.map((x) => x.d).join('\n');
    assert.match(todo, /"ficha"/);
    for (const segredo of ['529.982.247-25', 'Rua B', '98888-7777', 'nova@exemplo.com', 'ana@exemplo.com', 'Olinda']) assert.ok(!todo.includes(segredo), `vazou ${segredo}`);
  });
  await passo('leitura combinada com o legado (somente leitura): complemento vence quando preenchido, ficha vazia não apaga o legado', async () => {
    const extensao = require(r('src/gestao-fadas/features/clientes/helpers/extensao'));
    const legado = (id) => ({ id: Number(id), nivel: 0, nome: 'Nome Antigo', nome_id: 'Ant', email: 'antigo@exemplo.com', cpf: '11144477735', endereco: 'Rua Velha', numero: '9', cidade: 'Natal', estado: 'RN', whats: '11 90000-0000' });
    const mapa = await extensao.extensoesPorId(CLIENTES);
    const a = extensao.sobrepor(legado(A), mapa.get(A));
    assert.deepEqual([a.nome, a.email, a.cpf, a.endereco, a.cidade, a.whats], ['Ana Souza Lima', 'nova@exemplo.com', '529.982.247-25', 'Rua B', 'Recife', '11 90000-0000']);
    const vazio = extensao.sobrepor(legado('900099'), mapa.get('900099'));
    assert.deepEqual(vazio, legado('900099'));
    // Cliente que só teve a identidade editada: o e-mail, o CPF e o endereço do legado ficam.
    await patch('900024', 1, { treatAs: 'Dani' });
    const d = extensao.sobrepor(legado(D), (await extensao.extensoesPorId([D])).get(D));
    assert.deepEqual([d.email, d.cpf, d.endereco, d.nome, d.nome2], [(await linha(D)).email, '11144477735', 'Rua Velha', 'Nome Antigo', 'Dani']);
  });
  await passo('a Lilly (gravarExtensao) mexe nos dados e na situação sem apagar a ficha; o e-mail dela fica sob o da ficha', async () => {
    const { emTransacao } = require(r('src/gestao-fadas/novo/escritor'));
    const { gravarExtensao } = require(r('src/gestao-fadas/features/lilly/executores/cliente.extensao'));
    await emTransacao((ex) => gravarExtensao(ex, A, { situacao: 'completo', dados: { email: 'lilly@exemplo.com', fullName: 'Nome da Lilly' } }, { quem: 'Lilly', operationKey: n() }));
    const l = await linha(A);
    assert.deepEqual([l.email, l.nome_completo, l.cpf, l.end_cidade, l.situacao_cadastral], ['nova@exemplo.com', 'Ana Souza Lima', '529.982.247-25', 'Recife', 'completo']);
    const g = await lerExt(A);
    assert.deepEqual([g.email, g.fullName], ['nova@exemplo.com', 'Ana Souza Lima']);
    const sem = await lerExt(C);
    assert.equal(sem.email, 'c@exemplo.com');
  });
  await passo('tarólogo: 403 ao gravar e ao ler; fatia desligada: 404; nada foi pedido ao MySQL (legado não configurado)', async () => {
    sessao = { userId: uStaff, role: 'tarologa', displayName: 'T', tarotId: '9001' };
    assert.equal((await patch(A, rev, { email: 'z@exemplo.com' })).status, 403);
    assert.equal((await chamar('GET', `/catalog/clients?ids=${A}`)).status, 403);
    como('administradora');
    process.env.GF_FATIA_CADASTROS = 'false';
    try { assert.equal((await chamar('GET', `/catalog/clients?ids=${A}`)).status, 404); } finally { process.env.GF_FATIA_CADASTROS = 'true'; }
    assert.equal(`${process.env.LEGADO_DB_HOST || ''}`, ''); assert.notEqual(process.env.GF_LEGADO_ESCRITA_ENABLED, 'true');
  });

  srv.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\nPostgres: ${ok} ok, ${falhas.length} falhas`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
