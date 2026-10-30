'use strict';

/**
 * ENSAIO HTTP do gate no banco de DEV: sobe o gate num Express efêmero com sessão FALSA (por perfil) e chama as rotas
 * de gravação como o front chama, tudo dentro de UMA transação que nunca confirma (ROLLBACK no fim; ver `emEnsaio`).
 * Recusa banco que não seja de desenvolvimento.
 *   node scripts/ensaiar-gestao-fadas-http.js --cnf=<arquivo.cnf> --secao=client-dev
 */
const fs = require('fs');
const path = require('path');
const raiz = path.join(__dirname, '..');
const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);

(function configurar() {
  let sec; const c = {};
  for (const l of fs.readFileSync(arg('cnf'), 'utf8').split('\n')) {
    const m = l.match(/^\[(.+)\]$/); if (m) { sec = m[1]; c[sec] = {}; continue; }
    const k = l.match(/^\s*(\w+)\s*=\s*(.*)$/); if (k && sec) c[sec][k[1]] = k[2].trim().replace(/^["']|["']$/g, '');
  }
  const d = c[arg('secao') || 'client-dev'];
  if (!d || !/(01|dev|teste)$/i.test(d.database) || /^fadasdobem$/i.test(d.database)) { console.error('Recusado: não é banco de desenvolvimento.'); process.exit(2); }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password,
    GESTAO_FADAS_ENABLED: 'true', GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test' });
})();

const express = require('express');
const esc = require(path.join(raiz, 'src/models/legado/escrita'));
const { iniciarLegado, encerrarLegado } = require(path.join(raiz, 'src/models/legado'));
const { getLegadoSequelize } = require(path.join(raiz, 'src/models/legado/connection'));
const { criarGate } = require(path.join(raiz, 'src/gestao-fadas/gate'));

const TABELAS = ['gf_auditoria', 'gf_repasse_percentuais', 'gf_repasse_calendarios', 'gf_repasse_aberturas', 'gf_repasse_dividas', 'gf_repasse_divida_parcelas'];
async function contagens(s) { const o = {}; for (const t of TABELAS) { const [[l]] = await s.query(`SELECT COUNT(*) AS n FROM ${t}`); o[t] = Number(l.n); } return o; }

let ok = 0; const falhas = [];
function conferir(nome, cond, detalhe) { if (cond) { ok += 1; console.log(`  ok  ${nome}`); } else { falhas.push(nome); console.log(`  FALHOU  ${nome}  ${detalhe || ''}`); } }

(async () => {
  await iniciarLegado();
  const s = getLegadoSequelize();
  const [[tar]] = await s.query('SELECT MIN(idTarologo) AS id FROM tbl_tarologos');
  const [[conta]] = await s.query('SELECT id FROM gf_auth_accounts LIMIT 1');
  const tarotId = String(tar.id);
  const antes = await contagens(s);
  let perfil = 'administradora';
  const provedor = { validar: async () => ({ status: 'identity', identity: { userId: 'u-ensaio', role: perfil, displayName: 'ensaio', gfContaId: conta.id }, sessionId: 'sessao-ensaio' }) };
  const app = express();
  app.use('/api', criarGate({ provedorDeSessao: provedor, verificarLegado: async () => true }));
  const srv = app.listen(0, '127.0.0.1'); await new Promise((ok2) => srv.once('listening', ok2));
  const base = `http://127.0.0.1:${srv.address().port}/api`;
  const post = async (p, corpo) => { const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost' }, body: JSON.stringify(corpo) }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ } return { status: r.status, j, t: t.slice(0, 140) }; };
  const k = (x) => `http-${Date.now()}-${x}`;
  let dentro = null;
  try {
    await esc.emEnsaio(async (ex) => {
      let r = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: k('c'), rate: '35.00', reason: 'ensaio http' });
      conferir('POST commission (administradora) responde 201', r.status === 201, `${r.status} ${r.t}`);
      // O acordo vale a partir do segundo atual: duas chaves diferentes no mesmo segundo batem na chave única (como na B).
      await new Promise((r2) => setTimeout(r2, 1100));
      const chaveDup = k('dup');
      const a = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: chaveDup, rate: '36.00', reason: 'x' });
      const b = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: chaveDup, rate: '36.00', reason: 'x' });
      conferir('commission repetido com a mesma chave: mesmo status e corpo', a.status === b.status && JSON.stringify(a.j) === JSON.stringify(b.j), `${a.status}/${b.status}`);
      r = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: chaveDup, rate: '40.00', reason: 'x' });
      conferir('mesma chave com corpo diferente: 409', r.status === 409, `${r.status} ${r.t}`);
      r = await post(`/payouts/agreements/${tarotId}/schedule`, { operationKey: k('s'), schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' }, reason: null });
      conferir('POST schedule responde 201', r.status === 201, `${r.status} ${r.t}`);
      r = await post('/payouts/openings', { operationKey: k('o'), tarotId, lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00', remainingBalance: '50.00', migrationCut: '2026-10-05T06:00:00', rate: '30', openAdjustments: [], debts: [], differences: [] });
      conferir('POST openings responde 201 com a abertura', r.status === 201 && r.j && (r.j.id || r.j.opening || r.j.openingId), `${r.status} ${r.t}`);
      const aberturaId = r.j && (r.j.id || (r.j.opening && r.j.opening.id));
      if (aberturaId) {
        r = await post(`/payouts/openings/${aberturaId}/confirm`, { operationKey: k('cf') });
        conferir('POST confirm responde 200', r.status === 200, `${r.status} ${r.t}`);
      }
      r = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: k('bad'), rate: 'abc' });
      conferir('corpo inválido: 400', r.status === 400, `${r.status} ${r.t}`);
      perfil = 'assistente';
      r = await post(`/payouts/agreements/${tarotId}/commission`, { operationKey: k('ast'), rate: '35.00', reason: 'x' });
      conferir('assistente não altera acordo: 403', r.status === 403, `${r.status} ${r.t}`);
      perfil = 'supervisora';
      r = await post('/operations/clients/900013/history-access', { operationKey: k('h'), reason: 'ensaio http' });
      conferir('history-access (supervisora) responde 201 com grant', r.status === 201 && r.j && r.j.grant, `${r.status} ${r.t}`);
      perfil = 'atendente';
      r = await post('/operations/clients/900013/history-access', { operationKey: k('h2'), reason: 'ensaio http' });
      conferir('history-access (atendente): 403', r.status === 403, `${r.status} ${r.t}`);
      perfil = 'administradora';
      for (const [nome, rota] of [['consultas', '/operations/consultations/export'], ['recebimentos', '/operations/receipts/export']]) {
        const antesAud = (await ex.query('SELECT COUNT(*) AS n FROM gf_auditoria'))[0][0].n;
        const resp = await fetch(base + rota, { headers: { origin: 'http://localhost' } });
        const bytes = Buffer.from(await resp.arrayBuffer());
        const tipo = resp.headers.get('content-type') || '';
        const depoisAud = (await ex.query('SELECT COUNT(*) AS n FROM gf_auditoria'))[0][0].n;
        conferir(`export ${nome}: 200, xlsx válido (zip), auditoria gravada antes de enviar`,
          resp.status === 200 && /spreadsheetml/.test(tipo) && bytes.slice(0, 2).toString() === 'PK' && Number(depoisAud) === Number(antesAud) + 1,
          `${resp.status} ${tipo} ${bytes.length}b aud ${antesAud}->${depoisAud}`);
      }
      const [[l]] = await ex.query('SELECT (SELECT COUNT(*) FROM gf_auditoria) AS aud, (SELECT COUNT(*) FROM gf_repasse_aberturas) AS ab, (SELECT COUNT(*) FROM gf_repasse_percentuais) AS pc');
      dentro = l;
    });
  } catch (e) { falhas.push('ensaio'); console.log('ERRO no ensaio:', e.codigo || e.name, String(e.message).slice(0, 200)); }
  srv.close();
  const depois = await contagens(s);
  const intacto = JSON.stringify(antes) === JSON.stringify(depois);
  console.log('Dentro da transação:', JSON.stringify(dentro), '| antes:', JSON.stringify(antes));
  console.log('Depois:', JSON.stringify(depois));
  console.log(intacto ? 'ROLLBACK confirmado: o banco ficou exatamente como estava.' : 'ATENÇÃO: as contagens mudaram!');
  console.log(`\n${ok} conferências ok, ${falhas.length} falhas.`);
  await esc.fecharEscrita(); await encerrarLegado();
  process.exit(falhas.length || !intacto ? 1 : 0);
})().catch((e) => { console.error('ERRO', e.message); process.exit(2); });
