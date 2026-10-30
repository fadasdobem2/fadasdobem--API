'use strict';

/**
 * ORÁCULO DE BYTES: compara, para os MESMOS dados do banco de DEV, a resposta HTTP crua da API B publicada com a do
 * GATE da API A (status, cabeçalhos do contrato e corpo byte a byte). Só leituras (GET) e erros; as exportações
 * ficam de fora porque gravam auditoria na B. Nunca use contra produção.
 *   B_ORIGEM=https://gestao-dev... B_{ADMIN,SUP,ATD,AST}_{USER,PASS}=... node scripts/oraculo-gate-bytes.js --cnf=<.cnf>
 * O gate sobe em memória, com sessão por proxy da B (GATE_B_ORIGEM = B_ORIGEM) e leitura do banco de dev.
 */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

(function configurarBanco() {
  const txt = fs.readFileSync(arg('cnf'), 'utf8');
  let sec; const c = {};
  for (const l of txt.split('\n')) {
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; }
    const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  const d = c[arg('secao') || 'client-dev'];
  if (!d) { console.error('Seção não encontrada'); process.exit(2); }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password });
})();
if (!/gestao-dev\./.test(process.env.B_ORIGEM || '')) { console.error('Recusado: B_ORIGEM precisa ser DEV.'); process.exit(2); }
const ORIGEM = process.env.B_ORIGEM.replace(/\/+$/, '');
process.env.GATE_B_ORIGEM = ORIGEM;
process.env.GESTAO_FADAS_ENABLED = 'true';

const express = require('express');
const { criarGate } = require(path.join(raiz, 'src/gestao-fadas/gate'));
const { iniciarLegado, encerrarLegado } = require(path.join(raiz, 'src/models/legado'));

const PERFIS = [
  ['administradora', 'B_ADMIN'], ['assistente', 'B_AST'], ['supervisora', 'B_SUP'], ['atendente', 'B_ATD'],
];
// `vary` fica de fora: é do servidor Next/vinext da B (RSC), não do contrato da API.
const CABECALHOS = ['content-type', 'cache-control', 'allow', 'content-disposition', 'x-content-type-options'];
const VOLATEIS = /("readAt"|"elapsedMinutes"|"nowLocal"|"generatedAt"|"checkedAt"|"expiresAt"):\s*(?:"[^"]*"|-?\d+(?:\.\d+)?)/g;

async function pedir(base, metodo, caminho, cookie, corpo) {
  const h = { origin: ORIGEM };
  if (cookie) h.cookie = cookie;
  if (corpo !== undefined) h['content-type'] = 'application/json';
  const r = await fetch(base + caminho, { method: metodo, headers: h, body: corpo === undefined ? undefined : JSON.stringify(corpo), redirect: 'manual' });
  const bytes = Buffer.from(await r.arrayBuffer());
  const cab = {}; for (const k of CABECALHOS) if (r.headers.get(k) !== null) cab[k] = r.headers.get(k);
  return { status: r.status, cab, bytes, r };
}

async function entrar(base, usuario, senha) {
  const r = await pedir(base, 'POST', '/api/auth/login', '', { identifier: usuario, password: senha });
  if (r.status !== 200) throw new Error(`login ${base === ORIGEM ? 'B' : 'gate'} ${r.status}`);
  return (r.r.headers.getSetCookie() || []).map((x) => x.split(';')[0]).join('; ');
}

const norm = (b) => b.toString('utf8').replace(VOLATEIS, '$1:0');
let total = 0; const falhas = [];
function comparar(rotulo, b, g) {
  total += 1;
  const dif = [];
  if (b.status !== g.status) dif.push(`status B=${b.status} gate=${g.status}`);
  for (const k of CABECALHOS) if (b.cab[k] !== g.cab[k]) dif.push(`cabeçalho ${k}: B=${b.cab[k]} gate=${g.cab[k]}`);
  let nivel = 'bytes idênticos';
  if (!b.bytes.equals(g.bytes)) {
    if (norm(b.bytes) === norm(g.bytes)) nivel = 'idêntico exceto campos de relógio';
    else dif.push(`corpo difere (B ${b.bytes.length} bytes, gate ${g.bytes.length} bytes)\n      B   : ${b.bytes.toString('utf8').slice(0, 160)}\n      gate: ${g.bytes.toString('utf8').slice(0, 160)}`);
  }
  if (dif.length) { falhas.push(rotulo); console.log(`  XX ${rotulo}\n     ${dif.join('\n     ')}`); } else console.log(`  ok ${rotulo} [${b.status}] ${nivel}`);
}

(async () => {
  iniciarLegado && (await iniciarLegado());
  // O health publica a identidade do build; o gate a lê do ambiente. Aqui ela é copiada da B só para comparar o resto.
  const saude = await fetch(`${ORIGEM}/api/ops/health`).then((r) => r.json()).catch(() => ({}));
  Object.assign(process.env, { GATE_RELEASE_ID: saude.releaseId || '', GATE_COMMIT_SHA: saude.commitSha || '', FADAS_ENVIRONMENT: saude.environment === 'dev' ? 'test' : saude.environment === 'prd' ? 'production' : '' });
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use('/api', criarGate());
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const G = `http://127.0.0.1:${srv.address().port}`;
  try {
    for (const [perfil, pref] of PERFIS) {
      if (arg('perfis') && !arg('perfis').split(',').includes(perfil)) continue;
      const user = process.env[`${pref}_USER`]; const pass = process.env[`${pref}_PASS`];
      if (!user || !pass) { console.log(`-- ${perfil}: sem credencial, pulado`); continue; }
      console.log(`-- ${perfil}`);
      const cb = await entrar(ORIGEM, user, pass); const cg = await entrar(G, user, pass);
      const ambos = async (metodo, caminho, corpo) => [await pedir(ORIGEM, metodo, caminho, cb, corpo), await pedir(G, metodo, caminho, cg, corpo)];
      const rota = async (caminho, metodo = 'GET', corpo) => { const [b, g] = await ambos(metodo, caminho, corpo); comparar(`${metodo} ${caminho}`, b, g); return b; };

      await rota('/api/auth/session');
      await rota('/api/operations/consultations');
      await rota('/api/operations/receipts');
      await rota('/api/operations/receipts/undated');
      const tar = await rota('/api/operations/tarologists');
      const cli = await rota('/api/operations/clients');
      await rota('/api/operations/clients?q=maria');
      await rota('/api/operations/consultations?start=2026-01-01&end=2026-01-31');
      await rota('/api/operations/consultations?start=lixo');
      await rota('/api/operations/receipts?page=0');
      await rota('/api/operations/clients/abc');
      await rota('/api/operations/clients/999999999');
      await rota('/api/payouts/agreements/abc');
      await rota('/api/payouts/openings/abc');
      await rota('/api/operations/tarologists', 'POST', {});
      await rota('/api/ops/health');
      await rota('/api/welcome');
      await rota('/api/tarologos-cadastro');
      let idCli = null; let idTar = null;
      try { const j = JSON.parse(cli.bytes.toString('utf8')); idCli = ((j.clients || j.items || j.rows || [])[0] || {}).id || null; } catch (_) { /* sem lista */ }
      try { const j = JSON.parse(tar.bytes.toString('utf8')); idTar = ((j.tarologists || j.items || j.rows || [])[0] || {}).id || null; } catch (_) { /* sem lista */ }
      if (idCli) { for (const s of ['', '/consultations', '/receipts']) await rota(`/api/operations/clients/${idCli}${s}`); }
      if (idTar) { await rota(`/api/payouts/agreements/${idTar}`); await rota(`/api/payouts/openings/${idTar}`); }
      // sem sessão
      const [sb, sg] = [await pedir(ORIGEM, 'GET', '/api/operations/consultations', ''), await pedir(G, 'GET', '/api/operations/consultations', '')];
      comparar('GET /api/operations/consultations (sem sessão)', sb, sg);
      await pedir(ORIGEM, 'POST', '/api/auth/logout', cb, {}); await pedir(G, 'POST', '/api/auth/logout', cg, {});
    }
  } finally { srv.close(); await encerrarLegado(); }
  console.log(`\n${total} comparações, ${falhas.length} com diferença.`);
  process.exit(falhas.length ? 1 : 0);
})().catch((e) => { console.error('ERRO', e.message); process.exit(2); });
