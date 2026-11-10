'use strict';

/**
 * Verificação do `scripts/importar-equipe.js` (dados FICTÍCIOS).
 *   1) OFFLINE: cargos mapeados, e-mail com espaço/inválido/duplicado, telefones normalizados e duplicados, máscaras, nome aparado, simular sem banco.
 *   2) POSTGRES DESCARTÁVEL (sem --offline): cria `fdb_ieq_<aleatório>`, migra, roda apoio-importar-equipe/filho.js e apaga o banco.
 *   npm run verificar:gf-importar-equipe     node scripts/verificar-gf-importar-equipe.js --offline
 */

const path = require('path');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const { execFileSync, spawnSync } = require('child_process');
const pg = require('./apoio-esquema/pg');

let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 240)}`); }
}
const P = (o) => ({ nome: 'Pessoa Teste', nomeFada: 'Fada Teste', cargo: 'atendente', email: 'pessoa@exemplo.test', whatsapp: '11 98888-7766', ...o });

async function offline() {
  const ent = require('./apoio-importar-equipe/entrada');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ieq-off-'));
  try {
    await passo('cargos: administrador/supervisor/atendente/assistente viram os papéis do sistema (ignora caixa e espaços)', () => {
      const r = ent.validarPessoas(['administrador', ' Supervisor ', 'ATENDENTE', 'assistente'].map((cargo, i) => P({ cargo, email: `p${i}@exemplo.test`, whatsapp: `1198888770${i}` })));
      assert.deepEqual(r.map((p) => p.papel), ['administradora', 'supervisora', 'atendente', 'assistente']);
      assert.ok(r.every((p) => !p.problemas.length));
      assert.ok(ent.validarPessoas([P({ cargo: 'gerente' })])[0].problemas[0].includes('cargo'));
    });
    await passo('e-mail com espaço no meio vira problema e NÃO é corrigido; e-mail sem @ também', () => {
      const r = ent.validarPessoas([P({ email: 'a b@exemplo.test' }), P({ email: 'semarroba', whatsapp: '11 97777-6655' })]);
      assert.ok(r[0].problemas.some((m) => /espaço/.test(m)));
      assert.ok(r[1].problemas.some((m) => /e-mail/.test(m)));
    });
    await passo('e-mail e WhatsApp duplicados na planilha viram problema nas DUAS linhas (e-mail sem diferenciar maiúsculas)', () => {
      const r = ent.validarPessoas([P({ email: 'Dup@exemplo.test' }), P({ email: 'dup@exemplo.test', whatsapp: '(11) 97777-6655' }), P({ email: 'x@exemplo.test', whatsapp: '+55 11 97777-6655' })]);
      assert.ok(r[0].problemas.some((m) => /e-mail repetido/.test(m)) && r[1].problemas.some((m) => /e-mail repetido/.test(m)));
      assert.ok(r[1].problemas.some((m) => /WhatsApp repetido/.test(m)) && r[2].problemas.some((m) => /WhatsApp repetido/.test(m)));
    });
    await passo('telefones em formatos diferentes normalizam igual à ficha; incompleto é problema', () => {
      const f = ['11988887766', '(11) 98888-7766', '+55 11 98888-7766', '55 11 98888 7766', '11 98888-7766'].map((v) => ent.normalizarFone(v).texto);
      assert.ok(f.every((t) => t === '+55 11 98888-7766'), f.join('|'));
      assert.ok(ent.normalizarFone('12345').motivo && ent.normalizarFone('').motivo);
    });
    await passo('nome com espaços sobrando é aparado; nome de fada vazio é problema', () => {
      const r = ent.validarPessoas([P({ nome: '  Maria   da  Silva ' }), P({ nomeFada: ' ', email: 'o@exemplo.test', whatsapp: '11 97777-1111' })]);
      assert.equal(r[0].nome, 'Maria da Silva'); assert.ok(r[1].problemas.some((m) => /fada/.test(m)));
    });
    await passo('máscaras escondem e-mail e telefone', () => {
      assert.equal(ent.mascararEmail('ana.souza@gmail.com'), 'a***@gmail.com');
      assert.ok(!ent.mascararFone('11988887766').includes('9888'));
    });
    await passo('chave de operação é estável por e-mail', () => assert.equal(ent.chaveOperacao('a@b.test'), ent.chaveOperacao('a@b.test')));
    await passo('simular sem banco: não abre conexão, mascara a saída e sai 1 com problema', () => {
      const f = path.join(tmp, 'p.json');
      fs.writeFileSync(f, JSON.stringify([P({ email: 'secreto@exemplo.test', whatsapp: '11 98888-7766' }), P({ email: 'a b@exemplo.test', whatsapp: '11 97777-1111' })]));
      const x = spawnSync(process.execPath, [path.join(__dirname, 'importar-equipe.js'), '--arquivo', f], { encoding: 'utf8', env: { ...process.env, DB_NAME: '', DATABASE_URL: '' } });
      const t = x.stdout + x.stderr;
      assert.equal(x.status, 1, t); assert.match(t, /SIMULAR/); assert.match(t, /ok 1, problemas 1/);
      assert.ok(!t.includes('secreto@') && !t.includes('7766') && !t.includes('7777-1111'), 'dado pessoal na saída');
    });
    await passo('arquivo dentro do repositório é recusado (exit 2)', () => {
      const x = spawnSync(process.execPath, [path.join(__dirname, 'importar-equipe.js'), '--arquivo', path.join(__dirname, '..', 'package.json')], { encoding: 'utf8' });
      assert.equal(x.status, 2);
    });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

async function comBanco() {
  const banco = pg.nomeBanco('ieq');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const f = pg.rodarNode(banco, [path.join('scripts', 'apoio-importar-equipe', 'filho.js')], extra);
    process.stdout.write(f.stdout);
    if (f.status !== 0) process.stderr.write(f.stderr);
    codigo = f.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_ieq_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_ieq_* restante).');
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
