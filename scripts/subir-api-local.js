'use strict';

/**
 * Sobe a API A LOCAL: carrega `.local-dev/api.env` (banco e Redis locais) e liga o legado de DEV só para leitura
 * (credenciais lidas do .cnf na hora, nunca gravadas em arquivo). Com `--migrar` roda migrações e o seed antes.
 *   node scripts/subir-api-local.js --cnf=<arquivo.cnf> [--secao=client-dev] [--migrar]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const raiz = path.join(__dirname, '..');
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

const env = { ...process.env };
for (const l of fs.readFileSync(path.join(raiz, '.local-dev', 'api.env'), 'utf8').split('\n')) {
  const m = l.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/); if (m && !l.trim().startsWith('#')) env[m[1]] = m[2];
}
if (arg('cnf')) {
  let sec; const c = {};
  for (const l of fs.readFileSync(arg('cnf'), 'utf8').split('\n')) {
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; }
    const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  const d = c[arg('secao') || 'client-dev'];
  if (!d || !/(01|dev|teste)$/i.test(d.database) || /^fadasdobem$/i.test(d.database)) { console.error('Recusado: o legado precisa ser o de DEV.'); process.exit(2); }
  Object.assign(env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password });
}
const rodar = (args) => { const r = spawnSync(process.execPath, args, { cwd: raiz, env, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status || 1); };
if (process.argv.includes('--migrar')) { rodar(['scripts/run-migrations.js']); rodar(['scripts/seed-gestao-fadas-local.js']); }
console.log(`API A local em http://127.0.0.1:${env.PORT} (banco ${env.DB_NAME}). Ctrl+C encerra.`);
spawn(process.execPath, ['app.js'], { cwd: raiz, env, stdio: 'inherit' }).on('exit', (c) => process.exit(c || 0));
