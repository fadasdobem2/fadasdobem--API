'use strict';

/**
 * Verificação do ESPELHO NO LEGADO das entidades com casa clara (cliente em `usuarios`, tarólogo em `tbl_tarologos`; Maturacao/45). Sem tocar no
 * legado real em nenhum momento.
 *   1) OFFLINE (sempre): tradução front -> colunas contra o OURO do código real do front (`legacyIdentityChanges`), tarólogo por tabela de casos,
 *      allowlist (os únicos UPDATEs possíveis), flags por entidade, regra de fusão, ensaio recusado fora do dev, flags desligadas nos envs locais.
 *   2) POSTGRES DESCARTÁVEL `fdb_leg_*` (sem `--offline`): migra e roda apoio-gf-espelho-legado/filho.js (HTTP do gate + legado FALSO em memória).
 *   A prova contra o MySQL de dev (cópias temporárias InnoDB) é `npm run ensaiar:gf-legado-cadastros`.
 *   npm run verificar:gf-espelho-legado     node scripts/verificar-gf-espelho-legado.js --offline
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

const raiz = path.join(__dirname, '..');
const r = (p) => require(path.join(raiz, p));
let ok = 0; const falhas = [];
async function passo(nome, fn) { try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); } }

const MAPA = { name: 'nome_id', treatAs: 'nome2', whatsapp: 'whats', birthDate: 'datanascimento' };

async function offline() {
  const legado = r('src/gestao-fadas/legado-escrita');
  const { validarMudancas } = r('src/gestao-fadas/features/cadastros/clientes.validacao');
  const ouro = r('scripts/apoio-gf-espelho-legado/ouro-cliente-front.json');

  console.log('Cliente: tradução contra o OURO do front');
  await passo(`${ouro.casos.length} casos: onde o front aceita, a API (validação e mapeamento) aceita e dá as MESMAS colunas; onde recusa, recusa`, () => {
    let aceitos = 0; let recusados = 0;
    for (const c of ouro.casos) {
      if (!Object.keys(c.mudancas).length) continue; // pedido vazio: a ROTA recusa ("Nenhuma alteração", ouro dos Cadastros); não é questão do mapeamento
      const dados = {}; const campos = [];
      for (const [k, v] of Object.entries(c.mudancas)) if (k in MAPA) { dados[k] = v; campos.push(k); }
      let dadosApi = null; let erroApi = null;
      try {
        const m = validarMudancas(c.mudancas); // o que a rota aceita (e normaliza)
        const linha = legado.clientes.linhaDoCliente(Object.fromEntries(Object.entries(m).filter(([k]) => k in MAPA)), campos);
        dadosApi = linha ? linha.colunas : {};
      } catch (e) { erroApi = e.message; }
      const ctx = JSON.stringify(c.mudancas).slice(0, 90);
      if (c.erro) { assert.ok(erroApi, `o front recusa e a API aceitou: ${ctx}`); recusados += 1; } else {
        assert.equal(erroApi, null, `o front aceita e a API recusou (${erroApi}): ${ctx}`); assert.deepEqual(dadosApi, c.legacy, ctx); aceitos += 1;
      }
    }
    assert.ok(aceitos > 25 && recusados > 20, `${aceitos}/${recusados}`);
  });
  await passo('mapeamento direto (sem a rota) também recusa o que não cabe na coluna, nunca corta e nunca limpa em silêncio', () => {
    const l = legado.clientes.linhaDoCliente;
    for (const [campo, ruim] of [['name', 'x'.repeat(51)], ['name', ''], ['name', 'a😀b'], ['treatAs', 'y'.repeat(51)], ['whatsapp', '5'.repeat(46)], ['birthDate', '31/04/1990'], ['birthDate', '01/01/0999'], ['name', 'a\nb'], ['name', 5]]) {
      assert.throws(() => l({ [campo]: ruim }, [campo]), legado.mapeamento.MapeamentoError, `${campo}=${String(ruim).slice(0, 10)}`);
    }
    assert.equal(l({ name: 'Ana' }, ['treatAs']), null, 'campo pendente sem valor na extensão: nada a escrever (nunca apaga por omissão)');
    assert.deepEqual(l({ name: 'Ana', treatAs: 'x', whatsapp: '1' }, ['whatsapp']).colunas, { whats: '1' }, 'só o pendente vai (não sobrescreve o que o ASP mudou nos outros campos)');
    assert.equal(l({ name: 'Ana', paymentProfile: 'Pré-pago' }, ['paymentProfile']), null, 'Pré/Pós não tem coluna');
  });

  console.log('Tarólogo: tradução');
  await passo('nome -> nmuTarologo (até 35, nunca corta), cadastro_ativo -> ativo 1/0; nunca toca nmcTarologo (o login do espelho de consultas)', () => {
    const t = legado.tarologos.linhaDoTarologo;
    assert.deepEqual(t({ nome: '  Osíris  ', cadastro_ativo: false }, ['nome', 'cadastro_ativo']), { colunas: { nmuTarologo: 'Osíris', ativo: 0 }, campos: ['nome', 'cadastro_ativo'] });
    assert.deepEqual(t({ nome: 'x'.repeat(35), cadastro_ativo: true }, ['cadastro_ativo']).colunas, { ativo: 1 });
    assert.equal(t({ nome: 'x'.repeat(35) }, ['nome']).colunas.nmuTarologo.length, 35);
    for (const ruim of ['x'.repeat(36), '', '   ', 'a😀', 'a\u0001b']) assert.throws(() => t({ nome: ruim }, ['nome']), legado.mapeamento.MapeamentoError, ruim);
    assert.equal(t({ nome: null, cadastro_ativo: null }, ['nome', 'cadastro_ativo']), null);
    for (const x of [t({ nome: 'A', cadastro_ativo: true }, ['nome', 'cadastro_ativo'])]) assert.ok(!('nmcTarologo' in x.colunas) && !('status' in x.colunas) && !('exibir' in x.colunas));
  });

  console.log('Allowlist (os únicos SQLs de escrita das entidades)');
  const se = legado.sqlEntidades;
  await passo('15 UPDATEs de cliente + 3 de tarólogo + 2 leituras, nada mais; todos com `?`, coluna explícita, WHERE por id (cliente também nivel = 0); nenhum INSERT/DELETE', () => {
    assert.equal(se.UPDATES_CLIENTE.size, 15); assert.equal(se.UPDATES_TAROLOGO.size, 3); assert.equal(se.PERMITIDAS.size, 20);
    for (const q of [...se.UPDATES_CLIENTE.values()]) { assert.match(q, /^UPDATE usuarios SET [a-z0-9_]+ = \?(, [a-z0-9_]+ = \?)* WHERE id = \? AND nivel = 0$/); assert.equal(legado.sql.motivoDeRecusa(q), null); assert.ok(!/senha|login|cpf|saldo|valorAPagar/i.test(q)); }
    for (const q of [...se.UPDATES_TAROLOGO.values()]) { assert.match(q, /^UPDATE tbl_tarologos SET [a-zA-Z]+ = \?(, [a-zA-Z]+ = \?)* WHERE idTarologo = \?$/); assert.equal(legado.sql.motivoDeRecusa(q), null); assert.ok(!/nmcTarologo|pass|status|exibir/.test(q)); }
    assert.ok([...se.PERMITIDAS].every((q) => !/^(INSERT|DELETE|DROP|ALTER|CREATE|TRUNCATE)/i.test(q)));
  });
  await passo('qualquer variação é recusada: outra coluna, sem WHERE, sem nivel, outra tabela, DDL, DELETE, várias instruções, valor concatenado', () => {
    const base = se.updateCliente(['nome_id']);
    for (const q of ['UPDATE usuarios SET saldo = 1 WHERE id = 1 AND nivel = 0', 'UPDATE usuarios SET senha = ? WHERE id = ? AND nivel = 0', 'UPDATE usuarios SET nome_id = ?', 'UPDATE usuarios SET nome_id = ? WHERE id = ?',
      base.replace('nivel = 0', 'nivel = 2'), `${base}; DELETE FROM usuarios`, base.replace('?', "'x'"), 'UPDATE tbl_tarologos SET nmcTarologo = ? WHERE idTarologo = ?', 'UPDATE tbl_tarologos SET pass = ? WHERE idTarologo = ?',
      'UPDATE tbl_tarologos SET ativo = ?', 'DELETE FROM usuarios WHERE id = 1', 'DELETE FROM tbl_tarologos', 'DROP TABLE usuarios', 'ALTER TABLE usuarios ADD COLUMN x INT', 'INSERT INTO usuarios (nome_id) VALUES (?)',
      'INSERT INTO tbl_tarologos (nmuTarologo) VALUES (?)', 'UPDATE tbl_pagtoinformado SET vlPagtoInformado = ? WHERE idPagtoInformado = ?', 'UPDATE tbl_pagtoconfirmado SET vlPagtoInformado = ? WHERE idPagtoInformado = ?']) {
      assert.ok(legado.sql.motivoDeRecusa(q), q);
    }
    assert.equal(se.updateCliente(['senha']), null); assert.equal(se.updateCliente([]), null); assert.equal(se.updateTarologo(['nmcTarologo']), null);
    assert.equal(se.updateCliente(['whats', 'nome_id']), se.updateCliente(['nome_id', 'whats']), 'ordem das colunas é a da tabela, não a do pedido');
  });
  await passo('o adaptador passa os valores como parâmetros, na ordem das colunas, e não aceita coluna fora da lista', async () => {
    const vistos = []; const ex = { execute: async (q, v) => { vistos.push([q, v]); return [{ affectedRows: 1 }]; } };
    assert.equal(await legado.clientes.atualizar(ex, '900013', { whats: '1', nome_id: 'A' }), 1);
    assert.deepEqual(vistos[0], [se.updateCliente(['nome_id', 'whats']), ['A', '1', 900013]]);
    await assert.rejects(() => legado.clientes.atualizar(ex, '900013', { saldo: '9' }), legado.mapeamento.MapeamentoError);
    await assert.rejects(() => legado.clientes.atualizar(ex, '0', { nome_id: 'A' }), legado.mapeamento.MapeamentoError);
    await assert.rejects(() => legado.tarologos.atualizar(ex, '9001', { nmcTarologo: 'x' }), legado.mapeamento.MapeamentoError);
    assert.equal(vistos.length, 1);
  });

  console.log('Flags: nada liga sozinho');
  await passo('espelho só liga com o geral E a flag da entidade; consulta segue só com o geral; sem as flags, a escrita é recusada ANTES de abrir conexão', async () => {
    const L = legado.espelhoLigado;
    assert.equal(L({}), false); assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'false', GF_LEGADO_CLIENTES: 'true' }, 'clientes'), false);
    assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'true' }), true); assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'true' }, 'clientes'), false);
    assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_CLIENTES: 'true' }, 'clientes'), true); assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_CLIENTES: 'true' }, 'tarologos'), false);
    assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'true', GF_LEGADO_CLIENTES: 'true' }, 'pagamentos'), false); assert.equal(L({ GF_LEGADO_ESCRITA_ENABLED: 'true' }, 'inventada'), false);
    delete process.env.GF_LEGADO_ESCRITA_ENABLED;
    for (const e of ['clientes', 'tarologos']) await assert.rejects(() => legado.emTransacao(async () => 1, { entidade: e }), (x) => x.codigo === 'ESPELHO_DESLIGADO');
    process.env.GF_LEGADO_ESCRITA_ENABLED = 'true';
    try { await assert.rejects(() => legado.emTransacao(async () => 1, { entidade: 'clientes' }), (x) => x.codigo === 'ESPELHO_DESLIGADO'); } finally { delete process.env.GF_LEGADO_ESCRITA_ENABLED; }
  });
  await passo('o ENSAIO só roda em banco de dev (recusa fadasdobem, fadasdobem02) e só troca tabelas da lista fixa', async () => {
    assert.deepEqual([...legado.TABELAS_ENSAIO].sort(), ['tbl_consultas', 'tbl_tarologos', 'usuarios']);
    for (const [nome, dev] of [['fadasdobem', false], ['fadasdobem02', false], ['fadasdobem01', true], ['x_dev', true], ['x_teste', true]]) assert.equal(legado.bancoDeDev(nome), dev, nome);
    const salvo = { ...process.env };
    Object.assign(process.env, { LEGADO_DB_HOST: 'h', LEGADO_DB_NAME: 'fadasdobem', LEGADO_DB_USER: 'u' });
    try { await assert.rejects(() => legado.emEnsaio(async () => 1, { tabelas: ['usuarios'] }), (x) => x.codigo === 'ENSAIO_RECUSADO'); } finally { for (const k of ['LEGADO_DB_HOST', 'LEGADO_DB_NAME', 'LEGADO_DB_USER']) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; } }
  });
  await passo('nenhum env local (.local-dev/api.env, .env.example) liga o espelho no legado, geral ou por entidade', () => {
    for (const rel of ['.local-dev/api.env', '.env', '.env.example', '.env.local']) {
      const f = path.join(raiz, rel); if (!fs.existsSync(f)) continue;
      const ligadas = fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^\s*GF_LEGADO_[A-Z_]*\s*=\s*"?true"?\s*$/i.test(l));
      assert.equal(ligadas.length, 0, `${rel} liga ${ligadas.map((l) => l.split('=')[0].trim()).join(', ')}`);
    }
  });

  console.log('Fusão (legado é a fonte do campo espelhado)');
  const f = legado.fusao;
  await passo('cliente: só o campo pendente da extensão vale; o espelhado vem do legado; sem a coluna, vale por inteiro; Pré/Pós sempre da extensão', () => {
    const dados = { name: 'Ana', treatAs: 'Aninha', whatsapp: '1', birthDate: '05/03/1980', outro: 'x' };
    assert.deepEqual(f.dadosEfetivosDoCliente({ dados, legado_pendentes: [] }), { outro: 'x' });
    assert.deepEqual(f.dadosEfetivosDoCliente({ dados, legado_pendentes: ['whatsapp'] }), { whatsapp: '1', outro: 'x' });
    assert.deepEqual(f.dadosEfetivosDoCliente({ dados: JSON.stringify(dados), legado_pendentes: JSON.stringify(['name', 'birthDate']) }), { name: 'Ana', birthDate: '05/03/1980', outro: 'x' });
    assert.deepEqual(f.dadosEfetivosDoCliente({ dados, legado_estado: 'nao_espelhada', legado_pendentes: [] }), dados, 'nunca passou pelo espelho: vale por inteiro (como era)');
    assert.deepEqual(f.dadosEfetivosDoCliente({ dados, legado_estado: 'espelhada', legado_pendentes: [] }), { outro: 'x' });
    assert.deepEqual(f.dadosEfetivosDoCliente({ dados }), dados); assert.deepEqual(f.dadosEfetivosDoCliente({ dados: null, legado_pendentes: [] }), {}); assert.deepEqual(f.dadosEfetivosDoCliente(null), {});
  });
  await passo('tarólogo: nome e situação do perfil só valem sobre o legado enquanto pendentes; sem legado (cadastro aprovado) valem sempre', () => {
    const { montarItem } = r('src/gestao-fadas/_comum/dominio/catalogo-tarologos');
    const leg = { idTarologo: 9001, nmuTarologo: 'No ASP', ativo: 0 }; const perfil = (p) => ({ tarot_id: '9001', id_legado: 9001, nome: 'No Postgres', cadastro_ativo: true, perfil: {}, revisao: 2, conta_slug: null, ...p });
    assert.equal(montarItem({ legado: leg, perfil: perfil({ legado_pendentes: [] }), ext: null }).name, 'No ASP');
    assert.equal(montarItem({ legado: leg, perfil: perfil({ legado_pendentes: [] }), ext: null }).registrationActive, false);
    assert.equal(montarItem({ legado: leg, perfil: perfil({ legado_pendentes: ['nome'] }), ext: null }).name, 'No Postgres');
    assert.equal(montarItem({ legado: leg, perfil: perfil({ legado_pendentes: ['cadastro_ativo'] }), ext: null }).registrationActive, true);
    assert.equal(montarItem({ legado: leg, perfil: perfil({}), ext: null }).name, 'No Postgres', 'sem a coluna: vale por inteiro (como era)');
    assert.equal(montarItem({ legado: null, perfil: perfil({ id_legado: null, legado_pendentes: [] }), ext: null }).name, 'No Postgres');
  });

  console.log('Reconciliação');
  await passo('desligada não faz nada (nem abre conexão); só o geral ligado chama as de consulta e as entidades desligadas ficam de fora; agendar devolve null', async () => {
    const rec = legado.reconciliacao; let chamadas = 0;
    const consultasRec = async () => { chamadas += 1; return { desligado: false, examinadas: 0 }; };
    const x = await rec.reconciliarTudo({ env: {}, consultasRec }); assert.equal(x.desligado, true); assert.equal(chamadas, 0); assert.equal(rec.agendar({}), null);
    const salvo = process.env.GF_LEGADO_ESCRITA_ENABLED; process.env.GF_LEGADO_ESCRITA_ENABLED = 'true';
    try { const y = await rec.reconciliarTudo({ env: { GF_LEGADO_ESCRITA_ENABLED: 'true' }, consultasRec }); assert.equal(y.desligado, false); assert.equal(chamadas, 1); assert.equal(y.clientes.desligado, true); assert.equal(y.tarologos.desligado, true); assert.equal(y.clientes.examinadas, 0); } finally { if (salvo === undefined) delete process.env.GF_LEGADO_ESCRITA_ENABLED; else process.env.GF_LEGADO_ESCRITA_ENABLED = salvo; }
  });
  await passo('o app.js NÃO liga o job de reconciliação nem importa o espelho', () => {
    const app = fs.readFileSync(path.join(raiz, 'app.js'), 'utf8');
    assert.ok(!/legado-escrita|reconciliacao|reconciliarTudo/.test(app));
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('leg');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const fi = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-espelho-legado', 'filho.js')], extra);
    process.stdout.write(fi.stdout);
    if (fi.status !== 0) process.stderr.write(fi.stderr);
    codigo = fi.status;
    // Comando offline: sem --executar só LÊ (resumo por estado) e não escreve em lugar nenhum; com a flag desligada, `--executar` também não faz nada.
    const c1 = pg.rodarNode(banco, [path.join('scripts', 'reconciliar-gf-espelho-legado.js')], extra);
    const c2 = pg.rodarNode(banco, [path.join('scripts', 'reconciliar-gf-espelho-legado.js'), '--executar'], { ...extra, GF_LEGADO_ESCRITA_ENABLED: 'false' });
    const bom = c1.status === 0 && /Nada foi escrito/.test(c1.stdout) && /"clientes":\{/.test(c1.stdout) && c2.status === 0 && /"desligado":true/.test(c2.stdout);
    console.log(`  ${bom ? 'ok ' : 'FALHOU'}  comando offline reconciliar:gf-espelho-legado: resumo só de leitura e, desligado, nada a fazer`);
    if (!bom) { process.stderr.write(`${c1.stdout}${c1.stderr}${c2.stdout}${c2.stderr}`); codigo = codigo || 1; }
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_leg_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_leg_* restante).');
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
