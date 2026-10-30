'use strict';

/**
 * ORÁCULO: compara a saída dos serviços do módulo gestao-fadas (API A) com a da API B publicada (app do suspiro), para os
 * MESMOS dados do banco de DEV. Só leitura. Inclui um CONTROLE (o comparador precisa detectar uma alteração proposital)
 * e a comparação por perfil (administradora, supervisora, atendente) pelo controller de clientes.
 *   B_ORIGEM=https://gestao-dev.fadasdobem.com.br \
 *   B_ADMIN_USER=... B_ADMIN_PASS=... B_SUP_USER=... B_SUP_PASS=... B_ATD_USER=... B_ATD_PASS=... \
 *   node scripts/oraculo-api-b.js --cnf=<arquivo.cnf> [--secao=client-dev]
 * Nunca use contra produção. Credenciais só por ambiente.
 */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');

/** Acesso ao banco: variáveis LEGADO_DB_* OU --cnf=<arquivo .cnf> [--secao=client-dev]. Nada de senha neste arquivo. */
function configurarBanco() {
  const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
  if (arg('cnf')) {
    const txt = fs.readFileSync(arg('cnf'), 'utf8');
    let sec; const c = {};
    for (const l of txt.split('\n')) { const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; } const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim(); }
    const d = c[arg('secao') || 'client-dev'];
    if (!d) { console.error('Seção não encontrada no .cnf'); process.exit(2); }
    Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password });
  }
  const falta = ['LEGADO_DB_HOST', 'LEGADO_DB_NAME', 'LEGADO_DB_USER', 'LEGADO_DB_PASSWORD'].filter((k) => !process.env[k]);
  if (falta.length) { console.error('Faltam variáveis:', falta.join(', '), '(ou use --cnf=<arquivo>)'); process.exit(2); }
}
configurarBanco();

const faltaB = ['B_ORIGEM', 'B_ADMIN_USER', 'B_ADMIN_PASS', 'B_SUP_USER', 'B_SUP_PASS', 'B_ATD_USER', 'B_ATD_PASS', 'B_AST_USER', 'B_AST_PASS'].filter((k) => !process.env[k]);
if (faltaB.length) { console.error('Faltam variáveis:', faltaB.join(', ')); process.exit(2); }
if (!/gestao-dev\./.test(process.env.B_ORIGEM)) { console.error('Recusado: B_ORIGEM precisa ser o ambiente de DEV.'); process.exit(2); }
const ORIGEM = process.env.B_ORIGEM.replace(/\/+$/, '');
const F = path.join(raiz, 'src/gestao-fadas/features');
const { iniciarLegado, encerrarLegado } = require(path.join(raiz, 'src/models/legado'));
let cookie = '';
async function login() {
  const r = await fetch(`${ORIGEM}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM }, body: JSON.stringify({ identifier: process.env.B_ADMIN_USER, password: process.env.B_ADMIN_PASS }) });
  if (r.status !== 200) throw new Error('login B falhou ' + r.status);
  cookie = (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((x) => x.split(';')[0]).join('; ');
}
async function logout() { await fetch(`${ORIGEM}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM, cookie }, body: '{}' }).catch(() => {}); }
async function b(path) { const r = await fetch(ORIGEM + path, { headers: { cookie } }); const j = await r.json().catch(() => null); return { status: r.status, corpo: j }; }
const IGNORAR = new Set(['readAt', 'elapsedMinutes']); // tempo corrente: muda a cada chamada
function diff(a, bb, caminho, out) {
  if (out.length >= 12) return;
  if (a === bb) return;
  if (a === null || bb === null || typeof a !== 'object' || typeof bb !== 'object') { out.push(`${caminho}: A=${JSON.stringify(a)?.slice(0, 60)} B=${JSON.stringify(bb)?.slice(0, 60)}`); return; }
  if (Array.isArray(a) !== Array.isArray(bb)) { out.push(`${caminho}: tipo diferente`); return; }
  if (Array.isArray(a)) { if (a.length !== bb.length) out.push(`${caminho}: tamanho A=${a.length} B=${bb.length}`); for (let i = 0; i < Math.min(a.length, bb.length, 3000); i++) diff(a[i], bb[i], `${caminho}[${i}]`, out); return; }
  const ks = new Set([...Object.keys(a), ...Object.keys(bb)]);
  for (const k of ks) { if (IGNORAR.has(k)) continue; if (!(k in a)) { out.push(`${caminho}.${k}: só na B`); continue; } if (!(k in bb)) { out.push(`${caminho}.${k}: só na A`); continue; } diff(a[k], bb[k], `${caminho}.${k}`, out); }
}
async function comparar(rotulo, ruaB, fnA) {
  try {
    const rb = await b(ruaB); const ra = await fnA();
    if (rb.status !== 200) { console.log(`  ?? ${rotulo}: B respondeu HTTP ${rb.status} ${JSON.stringify(rb.corpo).slice(0, 100)}`); return; }
    const out = []; diff(JSON.parse(JSON.stringify(ra)), rb.corpo, '', out);
    console.log(`  ${out.length ? 'DIFERE' : 'IGUAL '} ${rotulo}${out.length ? '\n         ' + out.join('\n         ') : ''}`);
  } catch (e) { console.log(`  ERRO   ${rotulo}: ${e.name} ${String(e.message).slice(0, 140)}`); }
}
async function parte1() {
  iniciarLegado(); await login();
  const per = { start: '2026-10-20', end: '2026-10-29' };
  const agora = new Date();
  await comparar('consultas', '/api/operations/consultations?start=2026-10-20&end=2026-10-29', () => require(F + '/consultas/consultas.service').listar(per, agora));
  await comparar('recebimentos by=paid', '/api/operations/receipts?start=2026-10-20&end=2026-10-29&by=paid', () => require(F + '/pagamentos/pagamentos.service').listar({ ...per, by: 'paid' }));
  await comparar('recebimentos by=launched', '/api/operations/receipts?start=2026-10-20&end=2026-10-29&by=launched', () => require(F + '/pagamentos/pagamentos.service').listar({ ...per, by: 'launched' }));
  await comparar('recebimentos sem data', '/api/operations/receipts/undated', () => require(F + '/pagamentos/pagamentos.service').listarSemDataPaga({}));
  await comparar('tarólogos', '/api/operations/tarologists', () => require(F + '/tarologos/tarologos.service').listar({}));
  const model = require(F + '/clientes/clientes.model'); const cs = require(F + '/clientes/clientes.service');
  const agoraSP = (() => { const p = Object.fromEntries(new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(agora).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; })();
  await comparar('clientes período (admin)', '/api/operations/clients?mode=periodo&start=2026-10-20&end=2026-10-29', async () => cs.listar(model.planRealClientList('administradora', { mode: 'periodo', start: '2026-10-20', end: '2026-10-29' }, agoraSP).plan));
  await comparar('clientes busca nome=a', '/api/operations/clients?name=a', async () => cs.listar(model.planRealClientList('administradora', { name: 'a' }, agoraSP).plan));
  await comparar('cliente 900001 (ficha)', '/api/operations/clients/900001', () => cs.obter({ role: 'administradora', clientId: '900001', nowLocal: agoraSP }));
  await comparar('repasse acordo 9001', '/api/payouts/agreements/9001', () => require(F + '/repasse/repasse.service').acordo('9001'));
  await comparar('repasse aberturas 9001', '/api/payouts/openings/9001', () => require(F + '/repasse/repasse.service').aberturas('9001'));
  await logout();
}

const contas = { administradora: [process.env.B_ADMIN_USER, process.env.B_ADMIN_PASS, ['admin']], supervisora: [process.env.B_SUP_USER, process.env.B_SUP_PASS, ['supervisora']], atendente: [process.env.B_ATD_USER, process.env.B_ATD_PASS, ['atendente']], assistente: [process.env.B_AST_USER, process.env.B_AST_PASS, ['assistente']] };
function diff2(a, bb, caminho, out) {
  if (out.length >= 8 || a === bb) return;
  if (a === null || bb === null || typeof a !== 'object' || typeof bb !== 'object') { out.push(`${caminho}: A=${JSON.stringify(a)?.slice(0, 50)} B=${JSON.stringify(bb)?.slice(0, 50)}`); return; }
  if (Array.isArray(a) !== Array.isArray(bb)) { out.push(`${caminho}: tipo`); return; }
  if (Array.isArray(a)) { if (a.length !== bb.length) out.push(`${caminho}: tamanho A=${a.length} B=${bb.length}`); for (let i = 0; i < Math.min(a.length, bb.length); i++) diff2(a[i], bb[i], `${caminho}[${i}]`, out); return; }
  for (const k of new Set([...Object.keys(a), ...Object.keys(bb)])) { if (IGNORAR.has(k)) continue; if (!(k in a)) { out.push(`${caminho}.${k}: só na B`); continue; } if (!(k in bb)) { out.push(`${caminho}.${k}: só na A`); continue; } diff2(a[k], bb[k], `${caminho}.${k}`, out); }
}
const contar = (o) => { let n = 0; (function w(x) { if (x && typeof x === 'object') { n += 1; Object.values(x).forEach(w); } else n += 1; })(o); return n; };
async function loginB(id, pw) { const r = await fetch(`${ORIGEM}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM }, body: JSON.stringify({ identifier: id, password: pw }) }); if (r.status !== 200) throw new Error('login ' + id + ' ' + r.status); return (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((x) => x.split(';')[0]).join('; '); }
function rodar(handler, req) { return new Promise((resolve) => { const res = { status() { return this; }, json(j) { resolve({ ok: true, j }); } }; handler(req, res, (e) => resolve({ ok: false, e })); }); }
async function parte2() {
  const ctrl = require(F + '/clientes/clientes.controller');
  // 0) CONTROLE: o comparador precisa DETECTAR uma alteração proposital
  const sa = require(F + '/consultas/consultas.service');
  const ck = await loginB(...contas.administradora.slice(0, 2));
  const rb = await (await fetch(`${ORIGEM}/api/operations/consultations?start=2026-10-20&end=2026-10-29`, { headers: { cookie: ck } })).json();
  const ra = JSON.parse(JSON.stringify(await sa.listar({ start: '2026-10-20', end: '2026-10-29' }, new Date())));
  console.log(`CONTROLE: itens comparados na tabela de consultas = ${rb.finished.length + rb.inProgress.length} (nós de JSON: ${contar(rb)})`);
  const o1 = []; diff2(ra, rb, '', o1); console.log('  sem alteração   ->', o1.length ? 'DIFERE (inesperado)' : 'igual (esperado)');
  ra.finished[0].recordedAmount = '0.01'; const o2 = []; diff2(ra, rb, '', o2); console.log('  com 1 valor alterado ->', o2.length ? `detectou: ${o2[0]}` : 'NÃO detectou (comparador quebrado!)');
  await fetch(`${ORIGEM}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM, cookie: ck }, body: '{}' });

  // 1) Por perfil, via CONTROLLER (RBAC/perfil) x endpoints da B
  const rotas = [
    ['lista (padrão do perfil)', '/api/operations/clients', 'listar', {}, {}],
    ['ficha 900001', '/api/operations/clients/900001', 'obter', {}, { id: '900001' }],
    ['histórico consultas 900001', '/api/operations/clients/900001/consultations', 'consultas', {}, { id: '900001' }],
    ['histórico recebimentos 900001', '/api/operations/clients/900001/receipts', 'recebimentos', {}, { id: '900001' }],
  ];
  for (const [perfil, [id, pw, roleIds]] of Object.entries(contas)) {
    console.log(`\n== perfil ${perfil}`);
    const cookie = await loginB(id, pw);
    for (const [rot, caminhoB, fn, query, params] of rotas) {
      const r = await fetch(ORIGEM + caminhoB, { headers: { cookie } }); const jb = await r.json().catch(() => null);
      const sai = await rodar(ctrl[fn], { query, params, accessContext: { roleIds }, user: { id: 'teste' } });
      if (r.status !== 200) { console.log(`  B negou (${r.status} ${jb && jb.error && jb.error.code}) | A ${sai.ok ? 'respondeu (!)' : 'negou também (' + (sai.e && sai.e.statusCode) + ')'}  - ${rot}`); continue; }
      if (!sai.ok) { console.log(`  DIFERE ${rot}: A falhou ${sai.e && sai.e.statusCode} ${sai.e && String(sai.e.message).slice(0, 70)}`); continue; }
      const out = []; diff2(JSON.parse(JSON.stringify(sai.j.dados)), jb, '', out);
      console.log(`  ${out.length ? 'DIFERE' : 'IGUAL '} ${rot}${out.length ? '\n         ' + out.join('\n         ') : ''}`);
    }
    await fetch(`${ORIGEM}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGEM, cookie }, body: '{}' }).catch(() => {});
  }
}

(async () => {
  let falhou = 0;
  const orig = console.log;
  console.log = (...a) => { const t = a.join(' '); if (/DIFERE|ERRO|detectou/.test(t) === false && /NÃO detectou|\?\?/.test(t)) falhou += 1; if (/DIFERE|ERRO/.test(t)) falhou += 1; orig(...a); };
  await parte1();
  await parte2();
  await encerrarLegado();
  console.log = orig;
  console.log(falhou ? `\nRESULTADO: ${falhou} ocorrência(s) de diferença ou erro.` : '\nRESULTADO: tudo igual à API B.');
  process.exit(falhou ? 1 : 0);
})().catch((e) => { console.log('ERRO GERAL:', e.message); process.exit(1); });
