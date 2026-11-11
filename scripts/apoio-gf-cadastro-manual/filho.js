'use strict';

/** HTTP real do gate + transações reais no Postgres descartável. Nenhuma conexão MySQL. */
const assert = require('assert');
const { abrir, dados } = require('./ambiente');
const { passo, resumo } = require('../apoio-gf-banco-novo/comum');

function status(resposta, codigo, erro) {
  assert.equal(resposta.status, codigo, resposta.t);
  if (erro) assert.equal(resposta.j?.error?.code, erro, resposta.t);
}

(async () => {
  const a = await abrir();
  try {
    await passo('cadastros desligado: POST não existe e não grava', async () => {
      process.env.GF_FATIA_CADASTROS = 'false';
      try { status(await a.criar(dados()), 404, 'NOT_FOUND'); } finally { process.env.GF_FATIA_CADASTROS = 'true'; }
      assert.equal(await a.contagem(), 0);
    });
    await passo('sessão ausente, inválida e conta indisponível são recusadas sem gravação', async () => {
      for (const [sessao, codigo, erro] of [['absent', 401, 'SESSION_REQUIRED'], ['invalid', 401, 'SESSION_INVALID'], ['access-unavailable', 403, 'ACCOUNT_ACCESS_UNAVAILABLE']]) {
        a.sessao(sessao); status(await a.criar(dados()), codigo, erro);
      }
      a.como(); assert.equal(await a.contagem(), 0);
    });
    await passo('taróloga não pode criar cliente', async () => {
      a.como('tarologa');
      try { status(await a.criar(dados()), 403, 'ACCESS_DENIED'); } finally { a.como(); }
      assert.equal(await a.contagem(), 0);
    });
    await passo('origem ausente, diferente ou cross-site é recusada; origem configurada é respeitada', async () => {
      for (const headers of [{ origin: null }, { origin: 'https://outro.invalid' }, { 'sec-fetch-site': 'cross-site' }]) status(await a.criar(dados(), a.chave(), headers), 403, 'ORIGIN_NOT_ALLOWED');
      process.env.FADAS_ORIGIN = 'https://painel.invalid';
      try { status(await a.criar(dados()), 403, 'ORIGIN_NOT_ALLOWED'); } finally { delete process.env.FADAS_ORIGIN; }
      assert.equal(await a.contagem(), 0);
    });
    await passo('escrita desligada não produz cliente, extensão nem operação', async () => {
      process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'false';
      try { status(await a.criar(dados()), 503, 'WRITE_DISABLED'); } finally { process.env.GESTAO_FADAS_ESCRITA_ENABLED = 'true'; }
      assert.equal(await a.contagem(), 0);
      assert.equal(Number((await a.sql('SELECT COUNT(*) AS n FROM gf_clientes_ext'))[0].n), 0);
    });
    await passo('corpo e chave inválidos são recusados antes da persistência', async () => {
      for (const corpo of [null, [], {}, { operationKey: 'curta', changes: dados() }]) status(await a.chamar('POST', '/catalog/clients', corpo), 400, 'INVALID_INPUT');
      assert.equal(await a.contagem(), 0);
    });
    await passo('nome completo e pelo menos um telefone válido são obrigatórios', async () => {
      for (const changes of [{ phones: ['+55 11 98888-1111'] }, { fullName: 'Cliente' }, dados({ fullName: '' }), dados({ fullName: 123 }), dados({ phones: [] }), dados({ phones: ['123'] })]) status(await a.criar(changes), 422, 'RULE_VIOLATION');
      assert.equal(await a.contagem(), 0);
    });
    await passo('campos opcionais informados são validados sem truncamento nem correção silenciosa', async () => {
      for (const extra of [{ name: 'n'.repeat(51) }, { birthDate: '31/02/1990' }, { birthDate: '1990-01-01' }, { email: 'email-invalido' }, { cpf: '11111111111' }, { consultationPhoneIndex: 2 }, { whatsappPhoneIndex: -1 }, { noEmail: 'true' }, { address: { country: 'Brasil', zip: '123' } }]) status(await a.criar(dados(extra)), 422, 'RULE_VIOLATION');
      assert.equal(await a.contagem(), 0);
    });
    await passo('cadastro novo não aceita Pós-pago', async () => {
      status(await a.criar(dados({ paymentProfile: 'Pós-pago' })), 422, 'RULE_VIOLATION');
      assert.equal(await a.contagem(), 0);
    });

    let id;
    const completa = dados({ name: 'Ana Manual', fullName: 'Ana Silva Manual', treatAs: 'Ana', birthDate: '17/05/1990', email: 'ana.manual@example.invalid', cpf: '529.982.247-25',
      phones: ['+55 11 98888-1212', '+55 21 97777-3434'], consultationPhoneIndex: 0, whatsappPhoneIndex: 1,
      address: { street: 'Rua de Teste', number: '12', complement: 'Fundos', district: 'Centro', city: 'São Paulo', state: 'SP', zip: '01001-000', country: 'Brasil' } });
    const k = a.chave();
    let primeira;
    await passo('POST confirma ID novo, extensão revision 1 e dados persistidos exclusivamente no banco novo', async () => {
      primeira = await a.criar(completa, k); status(primeira, 200);
      id = primeira.j.clientId;
      assert.match(id, /^\d{10}$/); assert.ok(Number(id) >= 1000000000 && Number(id) <= 2147483647);
      assert.ok(Number.isFinite(Date.parse(primeira.j.readAt))); assert.equal(primeira.j.extension.revision, 1);
      assert.equal(primeira.j.extension.paymentProfile, 'Pré-pago'); assert.equal(primeira.j.extension.fullName, completa.fullName);
      assert.equal(primeira.j.extension.name, completa.name); assert.equal(primeira.j.extension.whatsapp, completa.phones[1]);
      assert.deepEqual(primeira.j.extension.phones, completa.phones); assert.equal(primeira.j.extension.whatsappPhoneIndex, 1);
      assert.equal(primeira.j.extension.consultationPhoneIndex, 0); assert.equal(primeira.j.extension.situacao_cadastral, 'completo');
      assert.equal(primeira.headers.get('cache-control'), 'no-store');
      const [nova] = await a.sql('SELECT * FROM gf_clientes_novos WHERE id_cliente = ?', [id]);
      const [ext] = await a.sql('SELECT * FROM gf_clientes_ext WHERE id_cliente = ?', [id]);
      assert.equal(nova.origem, 'manual'); assert.equal(nova.nome, completa.fullName); assert.equal(nova.nome_id, completa.name);
      assert.equal(nova.telefone, completa.phones[1]); assert.equal(ext.revisao, 1); assert.equal(ext.legado_estado, 'sem_registro');
      assert.equal(await a.contagem(), 1); assert.equal(a.chamadas.escritas, 0);
    });
    await passo('repetir mesma chave repete resposta; trocar dados conflita sem nova cliente', async () => {
      assert.ok(id, 'pré-condição: cadastro criado');
      const repetida = await a.criar(completa, k); status(repetida, 200); assert.deepEqual(repetida.j, primeira.j);
      status(await a.criar({ ...completa, treatAs: 'Outra' }, k), 409, 'OPERATION_KEY_CONFLICT');
      assert.equal(await a.contagem(), 1);
      assert.equal(Number((await a.sql('SELECT COUNT(*) AS n FROM gf_operacoes WHERE chave = ?', [k]))[0].n), 1);
    });
    await passo('duas solicitações simultâneas com a mesma chave confirmam a mesma cliente uma única vez', async () => {
      const antes = await a.contagem(); const chave = a.chave(); const changes = dados({ name: 'Concorrência' });
      const respostas = await Promise.all([a.criar(changes, chave), a.criar(changes, chave)]);
      respostas.forEach((r) => status(r, 200)); assert.deepEqual(respostas[0].j, respostas[1].j);
      assert.equal(await a.contagem(), antes + 1);
      assert.equal(Number((await a.sql('SELECT COUNT(*) AS n FROM gf_operacoes WHERE chave = ?', [chave]))[0].n), 1);
    });
    await passo('nome omitido usa sugestão existente do cadastro; nascimento ausente continua desconhecido', async () => {
      const x = await a.criar(dados({ fullName: 'Maria Clara Souza' })); status(x, 200);
      assert.equal(x.j.extension.name, 'Maria Clara Souza');
      assert.ok(!x.j.extension.birthDate); assert.equal(x.j.extension.situacao_cadastral, 'dados_pendentes');
      const ficha = await a.chamar('GET', `/operations/clients/${x.j.clientId}`); status(ficha, 200);
      assert.equal(ficha.j.client.name, 'Maria Clara Souza'); assert.equal(ficha.j.client.birthDate, null);
      assert.equal(ficha.j.client.nameMissing, false); assert.equal(ficha.j.client.origin, 'manual');
    });
    await passo('limites do contrato comportam nome completo acima de 191 caracteres e nascimento no ano 1000', async () => {
      const fullName = `Aurora ${'Sobrenome '.repeat(23).trim()}`;
      assert.ok(fullName.length > 191 && fullName.length <= 255);
      const x = await a.criar(dados({ name: 'Aurora Limite', fullName, birthDate: '01/01/1000' })); status(x, 200);
      assert.equal(x.j.extension.fullName, fullName); assert.equal(x.j.extension.birthDate, '01/01/1000');
      const [gravada] = await a.sql('SELECT nome, data_nascimento::text AS nascimento FROM gf_clientes_novos WHERE id_cliente = ?', [x.j.clientId]);
      assert.equal(gravada.nome, fullName); assert.equal(gravada.nascimento, '1000-01-01');
    });
    await passo('Não possui e-mail explícito completa cadastro; um e-mail informado prevalece sobre a declaração', async () => {
      const sem = await a.criar(dados({ name: 'Sem Email', birthDate: '04/03/1992', noEmail: true })); status(sem, 200);
      assert.equal(sem.j.extension.noEmail, true); assert.equal(sem.j.extension.situacao_cadastral, 'completo');
      const com = await a.criar(dados({ name: 'Com Email', birthDate: '04/03/1992', email: 'com.email@example.invalid', noEmail: true })); status(com, 200);
      assert.equal(com.j.extension.noEmail, false); assert.equal(com.j.extension.email, 'com.email@example.invalid');
    });
    await passo('administradora, assistente, supervisora e atendente criam; resposta respeita recorte do perfil', async () => {
      for (const role of ['administradora', 'assistente', 'supervisora', 'atendente']) {
        a.como(role);
        const x = await a.criar(dados({ name: `Cadastro ${role}`, email2: 'outro@example.invalid', address: { country: 'Brasil', city: 'Cidade Teste' } })); status(x, 200);
        assert.equal(x.j.extension.revision, 1);
        if (role === 'atendente') { assert.equal(x.j.extension.address, undefined); assert.equal(x.j.extension.email2, undefined); }
      }
      a.como();
    });
    await passo('criação aparece na lista, ficha e catálogo com origem manual; GET existente continua disponível', async () => {
      assert.ok(id, 'pré-condição: cadastro criado');
      const lista = await a.chamar('GET', `/operations/clients?q=${id}`); status(lista, 200);
      assert.deepEqual(lista.j.clients.map((c) => c.id), [id]); assert.equal(lista.j.clients[0].origin, 'manual');
      const ficha = await a.chamar('GET', `/operations/clients/${id}`); status(ficha, 200);
      assert.equal(ficha.j.client.fullName, completa.fullName); assert.equal(ficha.j.client.whatsapp, completa.phones[1]);
      const catalogo = await a.chamar('GET', `/catalog/clients?ids=${id}`); status(catalogo, 200);
      assert.equal(catalogo.j.extensions[id].revision, 1); assert.deepEqual(catalogo.j.extensions[id].phones, completa.phones);
      const proibido = await a.chamar('DELETE', '/catalog/clients'); status(proibido, 405, 'METHOD_NOT_ALLOWED');
      assert.ok(proibido.headers.get('allow')?.includes('GET') && proibido.headers.get('allow')?.includes('POST'));
    });
    await passo('busca pelo telefone adicional de consulta também acha a nova cliente', async () => {
      assert.ok(id, 'pré-condição: cadastro criado');
      for (const parametro of ['q', 'phone']) {
        const lista = await a.chamar('GET', `/operations/clients?${new URLSearchParams({ [parametro]: completa.phones[0] })}`);
        status(lista, 200); assert.deepEqual(lista.j.clients.map((c) => c.id), [id]);
      }
      const lista = await a.chamar('GET', `/operations/clients?${new URLSearchParams({ phone: completa.phones[1] })}`);
      status(lista, 200); assert.deepEqual(lista.j.clients.map((c) => c.id), [id]);
    });
    await passo('PATCH posterior mantém ID e campos omitidos, incrementa revisão e recusa revisão antiga', async () => {
      assert.ok(id, 'pré-condição: cadastro criado');
      const editada = await a.chamar('PATCH', `/catalog/clients/${id}`, { operationKey: a.chave(), expectedRevision: 1, changes: { treatAs: 'Aninha' } }); status(editada, 200);
      assert.equal(editada.j.clientId, id); assert.equal(editada.j.extension.revision, 2); assert.equal(editada.j.extension.treatAs, 'Aninha');
      assert.equal(editada.j.extension.fullName, completa.fullName); assert.deepEqual(editada.j.extension.phones, completa.phones);
      status(await a.chamar('PATCH', `/catalog/clients/${id}`, { operationKey: a.chave(), expectedRevision: 1, changes: { treatAs: 'Desatualizada' } }), 409, 'VERSION_CHANGED');
      const ficha = await a.chamar('GET', `/operations/clients/${id}`); status(ficha, 200); assert.equal(ficha.j.client.treatAs, 'Aninha');
    });
    await passo('PATCH de telefones e depois só WhatsApp mantém salvamento, catálogo, ficha e busca coerentes', async () => {
      assert.ok(id, 'pré-condição: cadastro criado');
      const phones = ['+55 31 96666-9876', '+55 21 96666-5555'];
      const editada = await a.chamar('PATCH', `/catalog/clients/${id}`, { operationKey: a.chave(), expectedRevision: 2, changes: { phones, consultationPhoneIndex: 0, whatsappPhoneIndex: 1 } });
      status(editada, 200); assert.equal(editada.j.extension.revision, 3); assert.deepEqual(editada.j.extension.phones, phones);
      assert.equal(editada.j.extension.whatsapp, phones[1]);
      assert.equal(editada.j.extension.whatsapp, editada.j.extension.phones[editada.j.extension.whatsappPhoneIndex]);
      const conferirLeituras = async (esperados, revisao) => {
        const catalogo = await a.chamar('GET', `/catalog/clients?ids=${id}`); status(catalogo, 200);
        const extensao = catalogo.j.extensions[id];
        assert.equal(extensao.revision, revisao); assert.deepEqual(extensao.phones, esperados);
        assert.equal(extensao.whatsappPhoneIndex, 1); assert.equal(extensao.consultationPhoneIndex, 0);
        assert.equal(extensao.whatsapp, esperados[1]); assert.equal(extensao.whatsapp, extensao.phones[extensao.whatsappPhoneIndex]);
        const ficha = await a.chamar('GET', `/operations/clients/${id}`); status(ficha, 200);
        assert.equal(ficha.j.client.whatsapp, esperados[1]);
      };
      await conferirLeituras(phones, 3);
      for (const [numero, esperado] of [[phones[0], [id]], [phones[1], [id]], [completa.phones[0], []], [completa.phones[1], []]]) {
        const lista = await a.chamar('GET', `/operations/clients?${new URLSearchParams({ phone: numero })}`);
        status(lista, 200); assert.deepEqual(lista.j.clients.map((c) => c.id), esperado);
      }
      const whatsapp = '+55 41 95555-7654';
      const avulso = await a.chamar('PATCH', `/catalog/clients/${id}`, { operationKey: a.chave(), expectedRevision: 3, changes: { whatsapp } });
      status(avulso, 200); assert.equal(avulso.j.extension.revision, 4);
      assert.equal(avulso.j.extension.whatsapp, whatsapp); assert.deepEqual(avulso.j.extension.phones, [phones[0], whatsapp]);
      await conferirLeituras([phones[0], whatsapp], 4);
      for (const [numero, esperado] of [[whatsapp, [id]], [phones[0], [id]], [phones[1], []]]) {
        const lista = await a.chamar('GET', `/operations/clients?${new URLSearchParams({ phone: numero })}`);
        status(lista, 200); assert.deepEqual(lista.j.clients.map((c) => c.id), esperado);
      }
    });
    await require('./duplicidade-nota')(a, { passo, status });
    await require('./conta-financeira')(a, { passo, status });
    await require('./retorno-tarologos')(a, { passo, status });
    await passo('todo o roteiro mantém o legado sem gravação', async () => { assert.equal(a.chamadas.escritas, 0); });
  } finally { await a.fechar(); }
  const { ok, falhas } = resumo();
  console.log(`\nCadastro manual: ${ok} ok, ${falhas.length} falhas`);
  process.exitCode = falhas.length ? 1 : 0;
})().catch((e) => { console.error(e); process.exitCode = 2; });
