'use strict';

/**
 * Verificação da LEITURA COMBINADA das clientes criadas pela Lilly (`gf_clientes_novos`, IDs >= 1.000.000.000) em Clientes: lista, busca, ficha, histórico,
 * edição pela ficha (só no complemento) e vínculo lead -> cliente.
 *   1) OFFLINE (sempre): faixa de IDs, linha no formato de `usuarios` lida pela MESMA regra da v608 (busca por ID/telefone/nome/e-mail, recorte por perfil),
 *      situação cadastral recalculada pela API, fusão que não descarta a edição da cliente nova, marcação de origem/estado; mutantes refutados.
 *   2) POSTGRES DESCARTÁVEL (sem `--offline`): fdb_cln_<aleatório>, migra por run-migrations e roda scripts/apoio-gf-clientes-novos/filho.js (HTTP do gate,
 *      legado de mentira só de leitura). Apaga o banco no fim. O MySQL legado nem é configurado.
 *   npm run verificar:gf-clientes-novos     node scripts/verificar-gf-clientes-novos.js --offline
 */

const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0;
const falhas = [];
function passo(nome, fn) {
  try { fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 300)}`); }
}
const refuta = (nome, mutante) => passo(`mutante refutado: ${nome}`, () => assert.throws(mutante, undefined, 'o mutante passou despercebido'));

function offline() {
  const faixa = r('src/gestao-fadas/_comum/dominio/cliente-faixa-nova');
  const leitura = r('src/gestao-fadas/features/clientes/cliente-novo.leitura');
  const model = r('src/gestao-fadas/features/clientes/clientes.model');
  const { situacaoDaNova } = r('src/gestao-fadas/features/clientes/cliente-novo.situacao');
  const fusao = r('src/gestao-fadas/legado-escrita/fusao');
  const { dataCivil } = r('src/gestao-fadas/features/clientes/cliente-novo');
  const busca = r('src/gestao-fadas/features/clientes/helpers/busca');

  const novaB = { id_cliente: '1000000002', nome: 'Bianca Souza Lima', nome_id: 'Bianca', nome2: 'Bia', data_nascimento: '1992-03-04', telefone: '+55 21 96666-2222', email: 'bianca@exemplo.com', criado_em: new Date('2026-11-08T15:30:00Z') };
  const novaA = { id_cliente: '1000000001', nome: '', nome_id: '', nome2: '', data_nascimento: null, telefone: '+55 11 97777-1111', email: null, criado_em: new Date('2026-11-08T15:30:00Z') };
  const procura = (campos) => ({ ...busca.emptyClientSearch(), ...campos });

  passo('faixa nova: >= 1.000.000.000 e <= 2.147.483.647, só texto de 10 dígitos', () => {
    assert.ok(faixa.ehIdDaFaixaNova('1000000001') && faixa.ehIdDaFaixaNova('2147483647'));
    for (const v of ['999999999', '2147483648', '0100000000', 1000000001, '10000000a1', '']) assert.ok(!faixa.ehIdDaFaixaNova(v), String(v));
  });
  passo('a linha da cliente nova vira cadastro de cliente (nivel 0) lido pela regra de Clientes: pendente sem nome, completa com tudo', () => {
    const a = model.readRealClientRow(leitura.linhaDeCadastro(novaA));
    assert.ok(a && a.id === '1000000001' && a.name === null && a.fullName === null && a.birthDate === null && a.whatsapp === '+55 11 97777-1111');
    const b = model.readRealClientRow(leitura.linhaDeCadastro(novaB));
    assert.ok(b.name === 'Bianca' && b.treatAs === 'Bia' && b.fullName === 'Bianca Souza Lima' && b.birthDate === '1992-03-04' && b.email === 'bianca@exemplo.com');
    assert.equal(b.createdAtLocal.slice(0, 19).replace('T', ' '), '2026-11-08 12:30:00'); // UTC -> São Paulo
    assert.equal(b.balanceCents, null); // sem saldo do sistema antigo: nunca zero inventado
  });
  passo('a MESMA regra de busca da v608 acha por ID, telefone (com máscara), nome (sem acento/caixa), e-mail e nascimento; e não acha o que não casa', () => {
    const l = leitura.linhaDeCadastro(novaB);
    const acha = (campos, role = 'administradora') => model.realClientMatches(l, procura(campos), role);
    assert.ok(acha({ query: '1000000002' }) && acha({ id: '1000000002' }) && acha({ query: '(21) 96666-2222' }) && acha({ phone: '966662222' }));
    assert.ok(acha({ query: 'BIANCA' }) && acha({ name: 'bia souza' }) && acha({ query: 'bianca@exemplo.com' }) && acha({ email: 'exemplo.com' }) && acha({ birthDate: '04/03/1992' }));
    assert.ok(!acha({ query: '1000000003' }) && !acha({ query: 'Carlos' }) && !acha({ phone: '911112222' }));
    assert.ok(acha({ query: '1000000002' }, 'assistente') && !acha({ query: 'Bianca' }, 'assistente'), 'a assistente busca só pelo ID exato');
  });
  passo('recorte por perfil da ficha: o atendente não recebe os dados adicionais (endereço, saldo antigo, e-mail 2); a administradora recebe', () => {
    const row = leitura.linhaDeCadastro(novaB);
    const adm = model.buildRealClientProfile({ role: 'administradora', nowLocal: '2026-11-08 12:00:00', row, catalogos: model.CATALOGOS_VAZIOS, consultations: [], receipts: { informed: [], confirmed: [], notFound: [] } });
    assert.equal(adm.client.fullName, 'Bianca Souza Lima'); assert.equal(adm.client.birthDate, '1992-03-04'); assert.ok('address' in adm.client && 'oldBalance' in adm.client);
    const at = model.buildRealClientProfile({ role: 'atendente', nowLocal: '2026-11-08 12:00:00', row, catalogos: model.CATALOGOS_VAZIOS, consultations: [], receipts: { informed: [], confirmed: [], notFound: [] } });
    assert.ok(at && at.client.address === undefined && at.client.oldBalance === undefined && at.client.email2 === undefined && at.client.fullName === 'Bianca Souza Lima');
    assert.equal(model.buildRealClientProfile({ role: 'tarologa', nowLocal: '2026-11-08 12:00:00', row, catalogos: model.CATALOGOS_VAZIOS, consultations: [], receipts: { informed: [], confirmed: [], notFound: [] } }), null);
  });
  passo('marcação: só a cliente nova ganha origin e o estado (e noEmail quando declarado); a do legado passa intacta', () => {
    const nova = { ...leitura.linhaDeCadastro(novaA), _situacao: 'dados_pendentes', _semEmail: true };
    assert.deepEqual(leitura.marcar({ id: '1' }, nova), { id: '1', origin: 'lilly', situacao_cadastral: 'dados_pendentes', noEmail: true });
    const item = { id: '900014' };
    assert.strictEqual(leitura.marcar(item, { id: 900014 }), item);
    assert.deepEqual(leitura.marcar({ id: '2' }, { ...leitura.linhaDeCadastro(novaB), _situacao: null, _semEmail: null }), { id: '2', origin: 'lilly' });
  });
  passo('a situação cadastral é recalculada pela API: nome, telefone, nascimento e e-mail (ou "não possui e-mail") completam; faltando um, pendente', () => {
    const col = { nome_completo: null, email: null, telefones: null, telefone_whatsapp_idx: null, sem_email: null };
    assert.equal(situacaoDaNova(novaA, {}, col), 'dados_pendentes');
    assert.equal(situacaoDaNova(novaA, { name: 'Lúcia', birthDate: '05/06/1990' }, { ...col, email: 'a@b.com' }), 'completo');
    assert.equal(situacaoDaNova(novaA, { name: 'Lúcia', birthDate: '05/06/1990' }, { ...col, sem_email: true }), 'completo');
    assert.equal(situacaoDaNova(novaA, { name: 'Lúcia', birthDate: '05/06/1990' }, col), 'dados_pendentes', 'sem e-mail e sem declaração');
    assert.equal(situacaoDaNova(novaB, {}, col), 'completo');
    assert.equal(situacaoDaNova({ ...novaB, telefone: '' }, {}, col), 'dados_pendentes');
    assert.equal(situacaoDaNova(novaB, { name: 'ID 95000' }, { ...col, nome_completo: 'ID 95000' }), 'dados_pendentes', 'placeholder não é nome');
  });
  passo('fusão: na cliente nova, o que a equipe editou vale todo (sem legado a espelhar); na do legado, o espelhado segue sendo do legado', () => {
    const dados = { name: 'Lúcia', treatAs: 'Lu', whatsapp: '1', birthDate: '05/06/1990', registrationSource: 'umbler' };
    const nova = { id_cliente: '1000000001', dados, legado_estado: 'sem_registro', legado_pendentes: [] };
    assert.deepEqual(fusao.dadosEfetivosDoCliente(nova), dados);
    const legado = { id_cliente: '900014', dados, legado_estado: 'espelhada', legado_pendentes: [] };
    assert.deepEqual(fusao.dadosEfetivosDoCliente(legado), { registrationSource: 'umbler' });
  });
  passo('dataCivil: coluna DATE (texto ou Date) vira AAAA-MM-DD', () => { assert.equal(dataCivil('1992-03-04'), '1992-03-04'); assert.equal(dataCivil(new Date('1992-03-04T00:00:00Z')), '1992-03-04'); assert.equal(dataCivil(null), null); });

  // Mutantes: cada defeito plausível tem de ser pego pelas conferências acima.
  refuta('linha sem nivel 0 deixaria de ser cliente', () => { const l = leitura.linhaDeCadastro(novaB); delete l.nivel; assert.ok(model.readRealClientRow(l)); });
  refuta('telefone fora do WhatsApp não seria achado pela busca', () => { const l = { ...leitura.linhaDeCadastro(novaB), whats: '' }; assert.ok(model.realClientMatches(l, procura({ phone: '966662222' }), 'administradora')); });
  refuta('fusão que descarta a edição da cliente nova', () => { assert.deepEqual(fusao.dadosEfetivosDoCliente({ id_cliente: '900014', dados: { name: 'X' }, legado_estado: 'sem_registro', legado_pendentes: [] }), { name: 'X' }); });
  refuta('situação que ignora o e-mail/declaração', () => { assert.equal(situacaoDaNova(novaB, {}, { email: null, sem_email: null }) === 'completo' && situacaoDaNova({ ...novaB, email: null }, {}, { email: null, sem_email: null }), 'completo'); });
  refuta('cliente do legado marcada como da Lilly', () => { assert.notEqual(leitura.marcar({ id: '9' }, { id: 9, _novo: true }).origin, 'lilly'); });
}

async function comBanco() {
  const banco = pg.nomeBanco('cln');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-clientes-novos', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_cln_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_cln_* restante).');
  }
  return codigo;
}

(async () => {
  offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
