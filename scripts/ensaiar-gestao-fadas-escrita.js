'use strict';

/**
 * ENSAIO das gravações do Gestão Fadas no banco de DEV, numa ÚNICA transação que NUNCA confirma (ROLLBACK no fim).
 * Prova que o SQL grava de verdade (tipos, chaves estrangeiras, modo estrito) e que nada fica no banco.
 * Recusa qualquer banco que não seja de desenvolvimento (o nome precisa terminar em 01/dev/teste e não ser `fadasdobem`).
 *
 *   node scripts/ensaiar-gestao-fadas-escrita.js --cnf=<arquivo.cnf> --secao=client-dev
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
  if (!d) { console.error('Seção não encontrada'); process.exit(2); }
  if (!/(01|dev|teste)$/i.test(d.database) || /^fadasdobem$/i.test(d.database)) { console.error('Recusado: não é banco de desenvolvimento.'); process.exit(2); }
  Object.assign(process.env, { LEGADO_DB_HOST: d.host, LEGADO_DB_PORT: d.port, LEGADO_DB_NAME: d.database, LEGADO_DB_USER: d.user, LEGADO_DB_PASSWORD: d.password, GESTAO_FADAS_ESCRITA_ENABLED: 'true' });
})();

const esc = require(path.join(raiz, 'src/models/legado/escrita'));
const { iniciarLegado, encerrarLegado } = require(path.join(raiz, 'src/models/legado'));
const { getLegadoSequelize } = require(path.join(raiz, 'src/models/legado/connection'));
const { criarRepasseEscrita } = require(path.join(raiz, 'src/gestao-fadas/features/repasse/escrita/fabrica'));
const { entradaDaAbertura } = require(path.join(raiz, 'src/gestao-fadas/features/repasse/escrita/entrada'));
const validacao = require(path.join(raiz, 'src/gestao-fadas/features/repasse/repasse.validacao'));
const { criarAuditoria } = require(path.join(raiz, 'src/gestao-fadas/_comum/auditoria'));

const TABELAS = ['gf_auditoria', 'gf_repasse_percentuais', 'gf_repasse_calendarios', 'gf_repasse_aberturas', 'gf_repasse_abertura_pendencias', 'gf_repasse_dividas', 'gf_repasse_divida_parcelas', 'gf_repasse_ajustes'];
let ok = 0; const falhas = [];
async function passo(nome, fn) {
  try { const r = await fn(); ok += 1; console.log(`  ok  ${nome}${r ? ` (${r})` : ''}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${e.codigo || e.name}: ${String(e.message).slice(0, 160)}`); }
}
async function contagens(sequelize) {
  const out = {};
  for (const t of TABELAS) { const [[l]] = await sequelize.query(`SELECT COUNT(*) AS n FROM ${t}`); out[t] = Number(l.n); }
  return out;
}

(async () => {
  await iniciarLegado();
  const sequelize = getLegadoSequelize();
  const [[tar]] = await sequelize.query('SELECT MIN(idTarologo) AS id FROM tbl_tarologos');
  const [[conta]] = await sequelize.query('SELECT id FROM gf_auth_accounts LIMIT 1');
  const tarotId = String(tar.id); const ator = { accountId: conta.id, role: 'administradora' };
  const antes = await contagens(sequelize);
  console.log(`Banco de dev. Tarólogo ${tarotId}. Contagens antes:`, JSON.stringify(antes));

  let dentro = null;
  try {
    await esc.emEnsaio(async (ex) => {
      const loja = criarRepasseEscrita({
        avulso: esc.executarAvulso, emTransacao: esc.emTransacao,
        legado: { tarologoExiste: async (id) => id === tarotId },
      });
      const chave = (s) => `ensaio-${Date.now()}-${s}`;
      await passo('percentual grava', async () => { const r = await loja.setCommissionRate({ operationKey: chave('com'), actor: ator, tarotId, rate: '35.00', reason: 'ensaio', effectiveFrom: '2026-10-29 10:00:00' }); return r && (r.rate || 'ok'); });
      const k = chave('com2');
      const a = await loja.setCommissionRate({ operationKey: k, actor: ator, tarotId, rate: '36.00', reason: 'ensaio', effectiveFrom: '2026-10-29 11:00:00' }).catch((e) => e);
      const b = await loja.setCommissionRate({ operationKey: k, actor: ator, tarotId, rate: '36.00', reason: 'ensaio', effectiveFrom: '2026-10-29 11:00:00' }).catch((e) => e);
      await passo('percentual idempotente (mesma chave, mesmo resultado)', async () => { if (a instanceof Error || b instanceof Error) throw (a instanceof Error ? a : b); if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error('resultados diferentes'); });
      await passo('calendário grava', () => loja.setPaymentSchedule({ operationKey: chave('cal'), actor: ator, tarotId, schedule: { kind: 'monthdays', days: [5, 20], weekendPolicy: 'next-business-day' }, reason: null, effectiveFrom: '2026-10-29 10:00:00' }).then(() => 'ok'));
      const corpo = validacao.corpoAbertura({
        tarotId, lastPayment: { paidOn: '2026-10-01', amount: '100.00', sheetRef: 'L12' }, settledThrough: '2026-10-02T06:00:00', remainingBalance: '50.00',
        migrationCut: '2026-10-05T06:00:00', rate: '30', openAdjustments: [{ kind: 'bonus', amount: '10.00', description: 'ensaio', date: '2026-10-03' }],
        debts: [{ kind: 'loan', remaining: '100.00', sheetRef: 'E5', installments: [{ date: '2026-10-10', amount: '60.00' }, { date: '2026-11-10', amount: '40.00' }] }],
        differences: [{ description: 'ensaio' }], operationKey: chave('abre'),
      });
      let abertura;
      await passo('abertura em rascunho grava (dívidas, parcelas, ajustes, pendências)', async () => { abertura = await loja.draftOpening(entradaDaAbertura(corpo, ator)); return abertura && abertura.id; });
      if (abertura) {
        await passo('abertura confirma', () => loja.confirmOpening({ operationKey: chave('conf'), actor: ator, openingId: abertura.id }).then(() => 'ok'));
        await passo('abertura corrige (revisão 2)', () => loja.correctOpening({ ...entradaDaAbertura({ ...corpo, operationKey: chave('corr') }, ator), openingId: abertura.id, reason: 'ensaio' }).then(() => 'ok'));
      }
      await passo('history-access grava e é idempotente', async () => {
        const aud = criarAuditoria(ex); const kk = chave('hist');
        const fato = { actorUserId: ator.accountId, actorRole: 'supervisora', action: 'clients.history.expand', entity: 'cliente', entityId: '900013', after: { sessionId: 'ensaio' }, reason: 'ensaio' };
        const x = await aud.adicionarUmaVez(fato, kk); const y = await aud.adicionarUmaVez(fato, kk);
        if (x.id !== y.id) throw new Error('chave repetida gravou outra linha');
      });
      await passo('auditoria de exportação grava', () => criarAuditoria(ex).adicionar({ actorUserId: ator.accountId, actorRole: 'administradora', action: 'operations.export.download', entity: 'consultas', entityId: 'ensaio', after: { rows: 0 } }).then(() => 'ok'));
      const [[l]] = await ex.query('SELECT (SELECT COUNT(*) FROM gf_auditoria) AS aud, (SELECT COUNT(*) FROM gf_repasse_aberturas) AS ab').then((r) => r);
      dentro = l;
    });
  } catch (e) { falhas.push('ensaio'); console.log('ERRO no ensaio:', e.codigo || e.name, String(e.message).slice(0, 200)); }
  const depois = await contagens(sequelize);
  console.log('Dentro da transação (antes do ROLLBACK):', JSON.stringify(dentro));
  const intacto = JSON.stringify(antes) === JSON.stringify(depois);
  console.log('Contagens depois:', JSON.stringify(depois));
  console.log(intacto ? 'ROLLBACK confirmado: o banco ficou exatamente como estava.' : 'ATENÇÃO: as contagens mudaram!');
  console.log(`\n${ok} passos ok, ${falhas.length} falhas.`);
  await esc.fecharEscrita(); await encerrarLegado();
  process.exit(falhas.length || !intacto ? 1 : 0);
})().catch((e) => { console.error('ERRO', e.message); process.exit(2); });
