'use strict';

/**
 * Verificação do `npm run contas:equipe` (scripts/criar-contas-equipe.js).
 *   1) OFFLINE: leitura/validação de JSON e CSV, senha temporária sempre forte, recusas de segurança.
 *   2) POSTGRES DESCARTÁVEL (sem --offline): cria `fdb_ceq_<aleatório>`, migra, roda scripts/apoio-gf-contas-equipe/filho.js
 *      (ensaio, execução, repetição, redefinição, papel inválido, e-mail repetido, arquivo 600, nenhum segredo em log/auditoria) e apaga o banco.
 *   npm run verificar:gf-contas-equipe        node scripts/verificar-gf-contas-equipe.js --offline
 */

const path = require('path');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}

async function offline() {
  const entrada = require('./apoio-gf-contas-equipe/entrada');
  const guardas = require('./apoio-gf-contas-equipe/guardas');
  const dom = require('../src/gestao-fadas/_comum/dominio/contas');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ceq-off-'));
  try {
    console.log('Entrada');
    await passo('JSON (lista e { contas }) e CSV (vírgula e ponto e vírgula, BOM, aspas) viram a mesma lista', () => {
      const lista = [{ nome: 'Ana Paula', email: 'ANA@fadas.test', papel: 'Atendente' }, { nome: 'Bia', email: 'bia@fadas.test', papel: 'assistente', legacyId: '77' }];
      fs.writeFileSync(path.join(tmp, 'a.json'), JSON.stringify(lista));
      fs.writeFileSync(path.join(tmp, 'b.json'), JSON.stringify({ contas: lista }));
      fs.writeFileSync(path.join(tmp, 'c.csv'), '﻿nome;email;papel;legacyId\n"Ana Paula";ANA@fadas.test;Atendente;\nBia;bia@fadas.test;assistente;77\n');
      fs.writeFileSync(path.join(tmp, 'd.csv'), 'Nome,E-mail,Papel\n"Souza, Ana",ana@fadas.test,atendente\n');
      const a = entrada.validar(entrada.lerArquivo(path.join(tmp, 'a.json')));
      assert.deepEqual(a.erros, []); assert.equal(a.contas[0].email, 'ana@fadas.test'); assert.equal(a.contas[0].papel, 'atendente'); assert.equal(a.contas[1].legacyId, '77');
      assert.deepEqual(entrada.validar(entrada.lerArquivo(path.join(tmp, 'b.json'))).contas, a.contas);
      assert.deepEqual(entrada.validar(entrada.lerArquivo(path.join(tmp, 'c.csv'))).contas.map((c) => [c.nome, c.email, c.papel, c.legacyId]), a.contas.map((c) => [c.nome, c.email, c.papel, c.legacyId]));
      assert.equal(entrada.validar(entrada.lerArquivo(path.join(tmp, 'd.csv'))).contas[0].nome, 'Souza, Ana');
    });
    await passo('recusa: papel inválido, e-mail inválido e repetido, nome vazio, tarologa sem tarotId, tarotId em papel de equipe, lista vazia', () => {
      const r = entrada.validar([
        { nome: 'A', email: 'a@x.co', papel: 'gestora' }, { nome: 'B', email: 'b', papel: 'atendente' },
        { nome: 'C', email: 'c@x.co', papel: 'atendente' }, { nome: 'C2', email: 'C@x.co', papel: 'atendente' },
        { nome: ' ', email: 'd@x.co', papel: 'atendente' }, { nome: 'E', email: 'e@x.co', papel: 'tarologa' }, { nome: 'F', email: 'f@x.co', papel: 'atendente', tarotId: '9001' },
      ]);
      assert.equal(r.erros.length, 6); assert.equal(r.contas.length, 1);
      assert.equal(entrada.validar([]).erros.length, 1);
    });
    await passo('arquivo de tipo desconhecido é recusado', () => assert.throws(() => entrada.lerArquivo(path.join(tmp, 'x.txt').replace('x.txt', 'a.json').replace('.json', '.txt')), /ENOENT|use um arquivo/));
    await passo('senha temporária: 2000 amostras, todas fortes pela regra do front, 16 caracteres, sem ; , " e todas diferentes', () => {
      const vistas = new Set();
      for (let i = 0; i < 2000; i += 1) { const s = entrada.senhaTemporaria(); assert.equal(dom.senhaForte(s), true); assert.equal(s.length, 16); assert.ok(!/[;,"\s]/.test(s)); vistas.add(s); }
      assert.equal(vistas.size, 2000);
    });
    console.log('Guardas');
    const base = { NODE_ENV: 'development', DB_NAME: 'fdb_x', DB_PORT: '5432' };
    await passo('produção sem --confirmo-producao recusa; com a confirmação passa', () => {
      assert.equal(guardas.recusas({}, { ...base, NODE_ENV: 'production' }).length, 1);
      assert.equal(guardas.recusas({ 'confirmo-producao': true }, { ...base, NODE_ENV: 'production' }).length, 0);
    });
    await passo('recusa DADOS_TESTE_ENABLED=true, banco legado (nome, porta 3306, URL mysql, igual a LEGADO_DB_NAME) e GF_NOVOS_DADOS=mysql', () => {
      assert.equal(guardas.recusas({}, { ...base, DADOS_TESTE_ENABLED: 'true' }).length, 1);
      for (const nome of ['fadasdobem', 'fadasdobem01', 'fadasdobem02']) assert.equal(guardas.recusas({}, { ...base, DB_NAME: nome }).length, 1, nome);
      assert.equal(guardas.recusas({}, { ...base, DB_PORT: '3306' }).length, 1);
      assert.equal(guardas.recusas({}, { DATABASE_URL: 'mysql://u@h/fadasdobem02' }).length >= 1, true);
      assert.equal(guardas.recusas({}, { ...base, DB_NAME: 'meu_banco', LEGADO_DB_NAME: 'Meu_Banco' }).length, 1);
      assert.equal(guardas.recusas({}, { ...base, GF_NOVOS_DADOS: 'mysql' }).length, 1);
      assert.equal(guardas.recusas({}, {}).length, 1);
    });
    await passo('caminhos: arquivo e saída dentro do repositório, saída já existente e pasta inexistente são recusados', () => {
      const ex = path.join(tmp, 'a.json');
      assert.equal(guardas.conferirCaminhos({ _: [ex], saida: path.join(tmp, 'novo.csv') }).length, 0);
      assert.ok(guardas.conferirCaminhos({ _: [path.join(guardas.RAIZ, 'package.json')], saida: path.join(tmp, 'n.csv') }).some((m) => /DENTRO/.test(m)));
      assert.ok(guardas.conferirCaminhos({ _: [ex], saida: path.join(guardas.RAIZ, 's.csv') }).some((m) => /DENTRO/.test(m)));
      assert.ok(guardas.conferirCaminhos({ _: [ex], saida: ex }).some((m) => /já existe/.test(m)));
      assert.ok(guardas.conferirCaminhos({ _: [ex], saida: path.join(tmp, 'nao', 'n.csv') }).some((m) => /pasta/.test(m)));
      assert.ok(guardas.conferirCaminhos({ _: [ex] }).some((m) => /--saida/.test(m)));
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function comBanco() {
  const banco = pg.nomeBanco('ceq');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-contas-equipe', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_ceq_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_ceq_* restante).');
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
