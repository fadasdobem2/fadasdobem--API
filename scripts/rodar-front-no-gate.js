'use strict';

/**
 * Sobe o FRONT do suspiro (build Node, modo real) falando com a API A, só com leitura e no banco de DEV.
 * Nada do front é alterado: o navegador abre http://127.0.0.1:<porta> (padrão 5180); `/api/*` vai à API/gate,
 * o resto ao front (porta + 1).
 *   node scripts/rodar-front-no-gate.js --api=http://127.0.0.1:4010 --front=<pasta do front com dist-node>   (usa a API local já rodando: npm run api:local)
 *   node scripts/rodar-front-no-gate.js --cnf=<arquivo.cnf> --secao=client-dev --front=<pasta>              (gate embutido, login pela API B de DEV)
 * Recusa banco que não seja de desenvolvimento.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

const PORTA = Number(arg('porta') || 5180); const PORTA_FRONT = PORTA + 1;
const ORIGEM_PUBLICA = `http://127.0.0.1:${PORTA}`;
const ORIGEM_B = process.env.B_ORIGEM || 'https://gestao-dev.fadasdobem.com.br';
const API = arg('api');
if (API && !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(API)) { console.error('Recusado: --api precisa ser local.'); process.exit(2); }
if (!API && !/gestao-dev\./.test(ORIGEM_B)) { console.error('Recusado: a API B precisa ser a de DEV.'); process.exit(2); }

(function banco() {
  if (API) return;
  let sec; const c = {};
  for (const l of fs.readFileSync(arg('cnf'), 'utf8').split('\n')) {
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; }
    const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  const d = c[arg('secao') || 'client-dev'];
  if (!d || !/(01|dev|teste)$/i.test(d.database) || /^fadasdobem$/i.test(d.database)) { console.error('Recusado: não é banco de desenvolvimento.'); process.exit(2); }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password,
    GESTAO_FADAS_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GATE_SESSAO: 'proxy-b', GATE_B_ORIGEM: ORIGEM_B });
  delete process.env.GESTAO_FADAS_ESCRITA_ENABLED; // escrita desligada
})();

const express = require('express');
const { iniciarLegado, encerrarLegado } = API ? { iniciarLegado: async () => {}, encerrarLegado: async () => {} } : require(path.join(__dirname, '..', 'src/models/legado'));
const { criarGate } = API ? {} : require(path.join(__dirname, '..', 'src/gestao-fadas/gate'));

const pastaFront = path.resolve(arg('front'));
const front = spawn(process.execPath, ['dist-node/server.js'], {
  cwd: pastaFront, stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, PORT: String(PORTA_FRONT), HOST: '127.0.0.1', FADAS_MODE: 'real', FADAS_ENVIRONMENT: 'test', FADAS_ORIGIN: ORIGEM_PUBLICA,
    FADAS_AUTH_AUDIENCE: 'gestao-fadas-local', FADAS_DB_HOST: '127.0.0.1', FADAS_DB_PORT: '1', FADAS_DB_NAME: 'nada', FADAS_DB_USER: 'nada', FADAS_DB_PASSWORD: 'nada', FADAS_DB_TLS: 'off' },
});

/** Encaminha a requisição ao destino e devolve a resposta tal como veio. */
function encaminhar(req, res, host, porta, falha) {
  const p = http.request({ host, port: porta, path: req.originalUrl, method: req.method, headers: { ...req.headers, host: `${host}:${porta}` } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  p.on('error', () => { if (!res.headersSent) res.status(502).end(falha); });
  req.pipe(p);
}

(async () => {
  await iniciarLegado();
  const app = express();
  if (API) {
    const alvo = new URL(API);
    app.use('/api', (req, res) => encaminhar(req, res, alvo.hostname, Number(alvo.port), 'API indisponível'));
  } else {
    // Só do harness: a API B de DEV confere a Origin contra a dela, então o login leva a Origin dela.
    app.use('/api/auth', (req, _res, next) => { if (req.headers.origin) req.headers.origin = ORIGEM_B; next(); });
    app.use(express.json({ limit: '1mb' }));
    app.use('/api', criarGate());
  }
  app.use((req, res) => encaminhar(req, res, '127.0.0.1', PORTA_FRONT, 'front indisponível'));
  app.listen(PORTA, '127.0.0.1', () => console.log(`Pronto: ${ORIGEM_PUBLICA} (front real + API A, DEV, só leitura). Ctrl+C encerra.`));
  const sair = async () => { front.kill(); await encerrarLegado().catch(() => {}); process.exit(0); };
  process.on('SIGINT', sair); process.on('SIGTERM', sair);
})().catch((e) => { console.error('ERRO', e.message); front.kill(); process.exit(1); });
