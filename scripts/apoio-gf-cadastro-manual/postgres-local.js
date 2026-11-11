'use strict';

/** Alternativa quando há somente postgres/initdb/pg_ctl: cluster NOVO, temporário e sem credenciais reais.
 * Servidor, migrações e testes permanecem filhos deste processo. Só a base fdb_cmn_* é criada.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { Client } = require('pg');
const pg = require('../apoio-esquema/pg');

function executar(programa, args, env, mostrar = false) {
  return new Promise((resolve, reject) => {
    const p = spawn(programa, args, { cwd: pg.RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    p.stdout.on('data', (v) => { stdout += v; if (mostrar) process.stdout.write(v); });
    p.stderr.on('data', (v) => { stderr += v; if (mostrar) process.stderr.write(v); });
    p.once('error', reject);
    p.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function rodar(banco, extra) {
  if (!/^fdb_cmn_[a-f0-9]{8}$/.test(banco)) throw new Error('Banco descartável inválido.');
  const bin = process.env.PG_EMBEDDED_BIN_DIR;
  const cluster = fs.mkdtempSync(path.join(os.tmpdir(), 'fdb-cmn-pg-'));
  let servidor; let cliente; let criada = false; let propria = false; let codigo = 2;
  let log = ''; let encerrado = false;
  try {
    const init = await executar(path.join(bin, 'initdb'), ['-D', cluster, '--auth=trust', '--username=agent', '--no-locale', '--encoding=UTF8'], process.env);
    if (init.status !== 0) throw new Error(`initdb falhou: ${init.stderr || init.stdout}`);
    servidor = spawn(path.join(bin, 'postgres'), ['-D', cluster, '-h', 'localhost', '-p', '5432', '-c', 'unix_socket_directories=', '-c', 'max_connections=40'], { stdio: ['ignore', 'pipe', 'pipe'] });
    servidor.stdout.on('data', (v) => { log += v; });
    servidor.stderr.on('data', (v) => { log += v; });
    servidor.on('error', (e) => { log += e.message; encerrado = true; });
    servidor.on('close', () => { encerrado = true; });
    for (let i = 0; i < 100; i += 1) {
      if (encerrado) throw new Error(`Postgres descartável encerrou: ${log}`);
      if (log.includes('database system is ready to accept connections')) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (encerrado || !log.includes('database system is ready to accept connections')) throw new Error(`Postgres não iniciou: ${log}`);
    cliente = new Client({ host: 'localhost', port: 5432, database: 'postgres', user: 'agent', password: '', connectionTimeoutMillis: 3000 });
    await cliente.connect();
    const configuracao = await cliente.query("SELECT current_setting('data_directory') AS caminho");
    if (configuracao.rows[0].caminho !== cluster) throw new Error('Recusado: o servidor local não pertence ao cluster descartável deste teste.');
    propria = true;
    await cliente.query(`CREATE DATABASE "${banco}"`); criada = true;
    const env = { ...pg.envDoBanco(banco), ...extra, DB_USER: 'agent' };
    const migracao = await executar(process.execPath, ['scripts/run-migrations.js'], env);
    if (migracao.status !== 0) throw new Error(`Migração descartável falhou:\n${migracao.stderr || migracao.stdout}`);
    console.log(`Postgres local isolado e banco ${banco} criados e migrados.`);
    const testes = await executar(process.execPath, ['scripts/apoio-gf-cadastro-manual/filho.js'], env, true);
    codigo = testes.status === 0 ? 0 : 1;
  } catch (e) {
    console.error(e.message || e);
    codigo = 2;
  } finally {
    if (cliente && propria && criada) {
      try {
        await cliente.query(`DROP DATABASE "${banco}" WITH (FORCE)`);
        const sobrou = await cliente.query('SELECT datname FROM pg_database WHERE datname = $1', [banco]);
        if (sobrou.rows.length) throw new Error('Banco descartável não foi apagado.');
        console.log('Banco descartável apagado e ausência conferida.');
      } catch (e) { console.error(e.message || e); codigo = 2; }
    }
    await cliente?.end().catch(() => {});
    if (servidor && !encerrado) {
      const parar = await executar(path.join(bin, 'pg_ctl'), ['-D', cluster, '-m', 'immediate', '-w', 'stop'], process.env);
      if (parar.status !== 0) { servidor.kill('SIGKILL'); console.error('Postgres descartável exigiu interrupção forçada.'); codigo = 2; }
      if (!encerrado) await new Promise((resolve) => servidor.once('close', resolve));
    }
    fs.rmSync(cluster, { recursive: true, force: true });
    console.log('Cluster temporário encerrado e removido.');
  }
  return codigo;
}

module.exports = { rodar };
