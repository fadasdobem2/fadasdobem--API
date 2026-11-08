'use strict';

/**
 * Verificação de scripts/mapear-tarologas-umbler.js (OFFLINE, sem token real, sem chamar a Umbler):
 *   - telefone: variantes do nono dígito e máscara (nunca o número completo);
 *   - leitura da resposta da Umbler em vários formatos;
 *   - mapeamento com PROVIDER FALSO (encontrada, ambígua, não encontrada, sem telefone, telefone inválido, erro, já vinculada, nono dígito) e relatório/tabela/log
 *     sem telefone completo; só a leitura por telefone chega ao mapeamento;
 *   - o provider REAL (src/providers/umbler) com o adaptador do axios trocado por um falso: URL, parâmetros, Bearer falso, nada sai pela rede;
 *   - `--aplicar`: só `aprovar: true`, revisão conferida, vínculo diferente só com `sobrescrever`, simulação não grava, ator obrigatório;
 *   - com `--banco`: Postgres descartável e o serviço REAL do perfil gravando `directory.umblerContact` (filho-banco.js).
 *   npm run verificar:gf-mapeamento-umbler     node scripts/verificar-gf-mapeamento-umbler.js
 */

const path = require('path');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const apoio = (p) => require(path.join(__dirname, 'apoio-mapear-tarologas-umbler', p));
const tel = apoio('telefone');
const umbler = apoio('umbler');
const { mapear, tabela } = apoio('mapeamento');
const { aplicar, lerAprovados } = apoio('aplicar');
const cli = require('./mapear-tarologas-umbler');

let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}
const refuta = (nome, fn) => passo(`mutante refutado: ${nome}`, async () => { let passou = false; try { await fn(); passou = true; } catch (_) { /* esperado */ } assert.ok(!passou, 'o mutante passou despercebido'); });
/** Qualquer sequência de 10+ dígitos (telefone completo) no texto. */
const temTelefone = (t) => /\d{2}[\s().-]*\d{4,5}[\s.-]*\d{4}/.test(t.replace(/ct-[\w-]+|chat-[\w-]+/g, ''));

/** Provider falso: só `buscarContatoPorTelefone`; qualquer outra propriedade quebra (a escrita nem existe aqui). */
function providerFalso(tabelaDeRespostas) {
  const chamadas = [];
  const base = { buscarContatoPorTelefone: async (t) => { chamadas.push(t); const r = tabelaDeRespostas[t]; if (r instanceof Error) throw r; if (r === undefined) { const e = new Error('nao'); e.status = 404; e.codigo = 'UMBLER_HTTP'; throw e; } return r; } };
  return { chamadas, provider: new Proxy(base, { get: (o, k) => { if (!(k in o)) throw new Error(`o mapeamento tocou em provider.${String(k)}`); return o[k]; } }) };
}
const erroUmbler = (status) => Object.assign(new Error('Falha na Umbler'), { status, codigo: 'UMBLER_HTTP' });

const T = (id, nome, telefones, extra = {}) => ({ tarotId: id, nome, revisao: 3, telefones: telefones.map(([origem, telefone]) => ({ origem, telefone })), ...extra });
const TAROLOGAS = [
  T('10', 'Selene', [['personalWhatsapp', '(11) 98888-1111']]),
  T('11', 'Aurora', [['personalWhatsapp', '+55 21 97777-2222'], ['avatarWhatsapp', '+55 21 96666-3333']]),
  T('12', 'Lua', [['cadastro.phone', '31 95555-4444']]),
  T('13', 'Sol', []),
  T('14', 'Vesta', [['cadastro.phone', '12345']]),
  T('15', 'Íris', [['personalWhatsapp', '41 94444-5555']]),
  T('16', 'Maia', [['personalWhatsapp', '+55 51 93333-6666'], ['avatarWhatsapp', '(51) 93333-6666']], { umblerContact: { contactId: 'ct-maia' } }),
  T('17', 'Nuvem', [['personalWhatsapp', '61 8888-7777']]),
  T('18', 'Brisa', [['personalWhatsapp', '71 92222-1010']], { umblerContact: { contactId: 'ct-velho' } }),
];
const RESPOSTAS = {
  '+5511988881111': { id: 'ct-selene', name: 'Selene Umbler', phone: '5511988881111', lastChat: { id: 'chat-selene' } },
  '+5521977772222': { items: [{ id: 'ct-aurora-a', name: 'Aurora A', chatId: 'chat-aurora' }] },
  '+5521966663333': { contact: { id: 'ct-aurora-b', name: 'Aurora B' } },
  '+5515': undefined,
  '+5541944445555': erroUmbler(500),
  '+5551933336666': { id: 'ct-maia', name: 'Maia', chat: { id: 'chat-maia' } },
  '+556188887777': undefined, // sem o 9: não existe
  '+5561988887777': { id: 'ct-nuvem', name: 'Nuvem', chatId: 'chat-nuvem' }, // com o 9: existe
  '+5571922221010': { id: 'ct-novo', name: 'Brisa', chatId: 'chat-brisa' },
};

async function offline() {
  console.log('Telefone');
  await passo('variantes: a informada e a do nono dígito (nunca para fixo, nunca sem DDD)', () => {
    assert.deepEqual(tel.variantes('(11) 98888-1111'), ['+5511988881111', '+551188881111']);
    assert.deepEqual(tel.variantes('11 8888-1111'), ['+551188881111', '+5511988881111']);
    assert.deepEqual(tel.variantes('+55 11 3333-4444'), ['+551133334444']);
    assert.deepEqual(tel.variantes('98888-1111'), []); assert.deepEqual(tel.variantes('12345'), []);
  });
  await passo('máscara: DDI, DDD e os 4 últimos dígitos; nunca o número', () => {
    for (const t of ['(11) 98888-1111', '+55 11 98888-1111', '1188881111', '12345', '']) assert.ok(!temTelefone(tel.mascarar(t)) && !tel.mascarar(t).includes('8888'), tel.mascarar(t));
    assert.equal(tel.mascarar('(11) 98888-1111'), '+55 11 *****-1111'); assert.equal(tel.mascarar('+55 11 98888-1111'), tel.mascarar('11988881111'));
  });
  await passo('a resposta da Umbler é lida em objeto, { contact }, { items } e lista; sem id não conta; chat em nomes comuns', () => {
    assert.deepEqual(umbler.contatosDe({ id: 'a', name: 'X', lastChat: { id: 'c1' } }), [{ contactId: 'a', nome: 'X', chatId: 'c1' }]);
    assert.deepEqual(umbler.contatosDe({ contact: { id: 7 } }), [{ contactId: '7', nome: null, chatId: null }]);
    assert.equal(umbler.contatosDe({ items: [{ id: 'a' }, { id: 'b' }, { nome: 'sem id' }] }).length, 2);
    assert.equal(umbler.contatosDe([{ id: 'a', chats: [{ id: 'z' }] }])[0].chatId, 'z');
    assert.deepEqual(umbler.contatosDe(null), []); assert.deepEqual(umbler.contatosDe({}), []);
  });

  console.log('Mapeamento com provider falso');
  const { chamadas, provider } = providerFalso(RESPOSTAS);
  const registrado = []; const original = console.log; console.log = (...a) => { registrado.push(a.join(' ')); };
  let relatorio;
  try { relatorio = await mapear({ tarologas: TAROLOGAS, provider, agora: () => new Date('2026-11-08T12:00:00Z') }); console.log(tabela(relatorio)); } finally { console.log = original; }
  const por = Object.fromEntries(relatorio.itens.map((i) => [i.tarotId, i]));
  await passo('encontrada: contato, nome e chat, com proposta e sem aprovação automática', () => {
    assert.equal(por['10'].status, 'encontrado'); assert.deepEqual(por['10'].proposta, { contactId: 'ct-selene', conversationId: 'chat-selene' });
    assert.equal(por['10'].candidatos[0].nome, 'Selene Umbler'); assert.equal(por['10'].aprovar, false);
    assert.ok(relatorio.itens.every((i) => i.aprovar === false));
  });
  await passo('ambígua: dois telefones, dois contatos; sem proposta (a pessoa escolhe)', () => {
    assert.equal(por['11'].status, 'ambiguo'); assert.equal(por['11'].proposta, null); assert.equal(por['11'].candidatos.length, 2);
  });
  await passo('não encontrada, sem telefone, telefone inválido e erro da Umbler (só código e status)', () => {
    assert.equal(por['12'].status, 'nao_encontrado'); assert.equal(por['13'].status, 'sem_telefone'); assert.equal(por['14'].status, 'telefone_invalido');
    assert.equal(por['15'].status, 'erro'); assert.deepEqual(por['15'].falhas, [{ origem: 'personalWhatsapp', codigo: 'UMBLER_HTTP', status: 500 }]);
  });
  await passo('o mesmo número em duas origens vira uma consulta; já vinculada a mesmo contato = ja_vinculado', () => {
    assert.equal(por['16'].status, 'ja_vinculado'); assert.equal(chamadas.filter((c) => c === '+5551933336666').length, 1);
  });
  await passo('nono dígito: sem o 9 a Umbler responde 404 e a forma com 9 acha; o vínculo diferente do cadastro é avisado', () => {
    assert.equal(por['17'].status, 'encontrado'); assert.equal(por['17'].proposta.contactId, 'ct-nuvem'); assert.equal(por['17'].candidatos[0].via[0].variante, '+55 61 *****-7777');
    assert.equal(por['18'].status, 'encontrado'); assert.match(por['18'].observacao, /sobrescrever/);
  });
  await passo('resumo e tabela batem; nenhum telefone completo no relatório, na tabela nem no log', () => {
    assert.deepEqual(relatorio.resumo, { total: 9, encontrado: 3, ja_vinculado: 1, ambiguo: 1, nao_encontrado: 1, sem_telefone: 1, telefone_invalido: 1, erro: 1 });
    assert.equal(relatorio.somenteLeitura, true);
    const json = JSON.stringify(relatorio); const mesa = tabela(relatorio);
    for (const texto of [json, mesa, registrado.join('\n')]) assert.ok(!temTelefone(texto), 'telefone completo vazou');
    assert.ok(mesa.includes('Selene') && mesa.includes('ct-selene') && mesa.includes('chat-selene') && mesa.includes('ambíguo'));
    assert.ok(!cli.mascararMensagem('falha no +55 11 98888-1111 agora').includes('98888'));
  });
  await passo('só a leitura por telefone chega ao mapeamento (qualquer outra função do provider quebraria)', async () => {
    const { provider: p2 } = providerFalso({});
    assert.throws(() => p2.criarNota, /tocou em provider\.criarNota/);
    await mapear({ tarologas: [TAROLOGAS[0]], provider: p2 });
  });

  console.log('Provider real com adaptador falso (sem rede, sem token real)');
  await passo('GET /v1/contacts/phone/ com organização e telefone em E.164; Bearer falso; nada sai pela rede', async () => {
    const guardado = { token: process.env.UMBLER_API_TOKEN, org: process.env.UMBLER_ORGANIZATION_ID, adaptador: axios.defaults.adapter };
    const vistos = [];
    process.env.UMBLER_API_TOKEN = 'token-falso-de-teste'; process.env.UMBLER_ORGANIZATION_ID = 'ORG-FALSA';
    axios.defaults.adapter = async (cfg) => { vistos.push({ method: cfg.method, url: cfg.url, params: cfg.params, auth: cfg.headers.Authorization }); if (cfg.params.phone === '+5511988881111') return { status: 200, data: { id: 'ct-real-falso', name: 'X' }, headers: {}, config: cfg }; const e = new Error('x'); e.response = { status: 404, data: { dado: 'cliente' } }; throw e; };
    try {
      const real = require('../src/providers/umbler/umbler.client');
      const r = await mapear({ tarologas: [TAROLOGAS[0], TAROLOGAS[11 - 11 + 1]], provider: { buscarContatoPorTelefone: real.buscarContatoPorTelefone } });
      assert.equal(r.itens[0].proposta.contactId, 'ct-real-falso'); assert.equal(r.itens[1].status, 'nao_encontrado');
      assert.ok(vistos.every((v) => v.method === 'get' && v.url === '/v1/contacts/phone/' && v.params.organizationId === 'ORG-FALSA' && v.auth === 'Bearer token-falso-de-teste'));
      assert.ok(!JSON.stringify(r).includes('token-falso') && !JSON.stringify(r).includes('dado'));
    } finally {
      for (const [k, v] of [['UMBLER_API_TOKEN', guardado.token], ['UMBLER_ORGANIZATION_ID', guardado.org]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      axios.defaults.adapter = guardado.adaptador;
    }
  });

  console.log('--aplicar');
  const catalogo = [
    { id: '10', revision: 3, registrationActive: true, directory: {} },
    { id: '11', revision: 3, registrationActive: true, directory: {} },
    { id: '12', revision: 4, registrationActive: true, directory: {} },
    { id: '16', revision: 3, registrationActive: true, directory: { umblerContact: { contactId: 'ct-maia', conversationId: 'chat-maia' } } },
    { id: '18', revision: 3, registrationActive: true, directory: { umblerContact: { contactId: 'ct-velho' } } },
    { id: '19', revision: 3, registrationActive: false, directory: {} },
  ];
  const ATOR = '11111111-2222-3333-4444-555555555555';
  const pedidos = [];
  const gravarPerfil = async (req) => { pedidos.push(req); return { ok: true }; };
  const exec = (itens, extra = {}) => aplicar({ itens, ator: ATOR, catalogo: async () => catalogo, gravarPerfil, ...extra });
  await passo('só grava o que tem "aprovar": true; o resto nem é lido; o pedido leva só directory.umblerContact, a revisão e uma chave estável', async () => {
    const arquivo = path.join(os.tmpdir(), `mapear-aprovado-${process.pid}.json`);
    const aprovado = { ...relatorio, itens: relatorio.itens.map((i) => (i.tarotId === '10' ? { ...i, aprovar: true } : i)) };
    fs.writeFileSync(arquivo, JSON.stringify(aprovado));
    try {
      pedidos.length = 0;
      const r = await exec(lerAprovados(arquivo));
      assert.deepEqual(r, { gravados: ['10'], jaIguais: [], ignorados: [], simulados: [] });
      assert.equal(pedidos.length, 1); const [q] = pedidos;
      assert.deepEqual(q.body.directory, { umblerContact: { contactId: 'ct-selene', conversationId: 'chat-selene' } }); assert.equal(q.body.expectedRevision, 3);
      assert.deepEqual(Object.keys(q.body).sort(), ['directory', 'expectedRevision', 'operationKey']); assert.equal(q.params.tarotId, '10'); assert.equal(q.user.id, ATOR);
      assert.equal(q.body.operationKey, 'mapear-umbler:10:ct-selene:3');
    } finally { fs.unlinkSync(arquivo); }
  });
  await passo('ambígua aprovada com contato escolhido grava; sem escolha, ignora; revisão que mudou, ignora; cadastro inativo, ignora', async () => {
    pedidos.length = 0;
    const base = { aprovar: true, status: 'ambiguo' };
    const r = await exec([{ ...base, tarotId: '11', revisao: 3, proposta: { contactId: 'ct-aurora-b' } }, { ...base, tarotId: '10', revisao: 3, proposta: null }, { ...base, tarotId: '12', revisao: 3, proposta: { contactId: 'ct-x' } },
      { ...base, tarotId: '19', revisao: 3, proposta: { contactId: 'ct-y' } }, { ...base, tarotId: '999', revisao: 1, proposta: { contactId: 'ct-z' } }, { ...base, tarotId: '10', revisao: 3, proposta: { contactId: 'com espaço' } }]);
    assert.deepEqual(r.gravados, ['11']); assert.equal(r.ignorados.length, 5); assert.match(r.ignorados.find((i) => i.tarotId === '12').motivo, /mudou depois do relatório/);
    assert.equal(pedidos.length, 1);
  });
  await passo('vínculo igual não regrava; vínculo diferente só com "sobrescrever": true', async () => {
    pedidos.length = 0;
    const r = await exec([{ aprovar: true, tarotId: '16', revisao: 3, proposta: { contactId: 'ct-maia', conversationId: 'chat-maia' } }, { aprovar: true, tarotId: '18', revisao: 3, proposta: { contactId: 'ct-novo' } }]);
    assert.deepEqual(r.jaIguais, ['16']); assert.equal(r.gravados.length, 0); assert.match(r.ignorados[0].motivo, /sobrescrever/);
    const s = await exec([{ aprovar: true, sobrescrever: true, tarotId: '18', revisao: 3, proposta: { contactId: 'ct-novo' } }]);
    assert.deepEqual(s.gravados, ['18']);
  });
  await passo('simulação não grava; ator inválido recusa tudo; erro do serviço de uma taróloga não impede as outras', async () => {
    pedidos.length = 0;
    const sim = await exec([{ aprovar: true, tarotId: '10', revisao: 3, proposta: { contactId: 'ct-a' } }], { simular: true });
    assert.deepEqual(sim.simulados, ['10']); assert.equal(pedidos.length, 0);
    await assert.rejects(() => aplicar({ itens: [], ator: 'qualquer', catalogo: async () => catalogo, gravarPerfil }), /ator/);
    const r = await exec([{ aprovar: true, tarotId: '10', revisao: 3, proposta: { contactId: 'ct-a' } }, { aprovar: true, tarotId: '11', revisao: 3, proposta: { contactId: 'ct-b' } }],
      { gravarPerfil: async (req) => { if (req.params.tarotId === '10') throw Object.assign(new Error('conflito'), { codigo: 'VERSION_CHANGED' }); return {}; } });
    assert.deepEqual(r.gravados, ['11']); assert.match(r.ignorados[0].motivo, /VERSION_CHANGED/);
  });
  await passo('argumentos do CLI: desconhecido recusa; --simular e --pausa-ms lidos', () => {
    assert.throws(() => cli.argumentos(['--gravar']), /desconhecido/);
    assert.deepEqual(cli.argumentos(['--aplicar', 'a.json', '--ator', ATOR, '--simular', '--pausa-ms', '5']), { simular: true, aplicar: 'a.json', ator: ATOR, pausaMs: '5' });
  });

  console.log('Contraprovas');
  await refuta('o detector de telefone completo pega um número sem máscara (garante que as conferências acima valem)', () => { assert.ok(!temTelefone('Selene (11) 98888-1111')); });
  await refuta('duas pessoas diferentes na Umbler nunca viram "encontrada"', async () => { const r = await mapear({ tarologas: [T('11', 'Aurora', [['a', '+55 21 97777-2222'], ['b', '+55 21 96666-3333']])], provider: providerFalso(RESPOSTAS).provider }); assert.equal(r.itens[0].status, 'encontrado'); });
}

async function comBanco() {
  const banco = pg.nomeBanco('mup');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-mapear-tarologas-umbler', 'filho-banco.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_mup_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_mup_* restante).');
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
