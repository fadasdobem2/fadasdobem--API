'use strict';

/**
 * Compara a ESTRUTURA REAL do banco (information_schema) com os models gerados do módulo gestao-fadas.
 * Somente leitura e só metadados (nenhuma linha de dado). Use em DEV; em produção só com decisão registrada.
 *   node scripts/comparar-esquema-banco.js --cnf=<arquivo.cnf> [--secao=client-dev]
 *   (ou LEGADO_DB_HOST/NAME/USER/PASSWORD no ambiente)
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

const { iniciarLegado, encerrarLegado } = require(path.join(raiz, 'src/models/legado'));
const catalogo = require(path.join(raiz, 'src/gestao-fadas/fontes/schema-catalog.json')).tables;
(async () => {
  const { sequelize, models } = iniciarLegado();
  const [cols] = await sequelize.query("SELECT TABLE_NAME t, COLUMN_NAME c, COLUMN_TYPE ty, IS_NULLABLE n, COLUMN_KEY k FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION");
  const real = {};
  for (const r of cols) (real[r.t] = real[r.t] || {})[r.c] = { ty: r.ty, n: r.n === 'YES', k: r.k };
  const porTabela = Object.fromEntries(Object.values(models).map((m) => [m.tableName, m]));
  const norm = (t) => String(t).toLowerCase().replace(/\s+unsigned/, '').replace(/\(\d+\)$/, '').replace(/\(\d+,\d+\)/, (x) => x);
  console.log('Tabelas no dev:', Object.keys(real).length, '| com model:', Object.keys(real).filter((t) => porTabela[t]).length);
  console.log('Tabelas do dev SEM model:', Object.keys(real).filter((t) => !porTabela[t]).join(', ') || '(nenhuma)');
  console.log('Models sem tabela no dev:', Object.keys(porTabela).filter((t) => !real[t]).join(', '));
  for (const [t, M] of Object.entries(porTabela)) {
    if (!real[t]) continue;
    const doModel = Object.keys(M.rawAttributes);
    const doBanco = Object.keys(real[t]);
    const faltamNoBanco = doModel.filter((x) => !real[t][x]);
    const extrasNoBanco = doBanco.filter((x) => !M.rawAttributes[x]);
    const difTipo = [];
    for (const x of doModel) if (real[t][x]) {
      const cat = (catalogo[t] && catalogo[t].columns[x] && catalogo[t].columns[x].type) || null;
      if (cat && norm(cat) !== norm(real[t][x].ty)) difTipo.push(`${x}: catálogo ${cat} x dev ${real[t][x].ty}`);
      const mnull = M.rawAttributes[x].allowNull;
      if (mnull !== real[t][x].n) difTipo.push(`${x}: nulo model=${mnull} dev=${real[t][x].n}`);
    }
    const pkModel = Object.keys(M.primaryKeys).sort().join(',');
    const pkBanco = Object.entries(real[t]).filter(([, v]) => v.k === 'PRI').map(([k]) => k).sort().join(',');
    const linhas = [];
    if (faltamNoBanco.length) linhas.push(`   model tem e o dev NÃO tem (${faltamNoBanco.length}): ${faltamNoBanco.slice(0, 14).join(', ')}${faltamNoBanco.length > 14 ? '…' : ''}`);
    if (extrasNoBanco.length) linhas.push(`   dev tem e o model NÃO tem (${extrasNoBanco.length}): ${extrasNoBanco.join(', ')}`);
    if (difTipo.length) linhas.push(`   diferenças de tipo/nulo (${difTipo.length}): ${difTipo.slice(0, 8).join(' | ')}`);
    if (pkModel !== pkBanco) linhas.push(`   PK model=${pkModel} dev=${pkBanco}`);
    console.log(`\n${t.padEnd(32)} colunas model=${doModel.length} dev=${doBanco.length} ${linhas.length ? '' : '=> idêntico'}`);
    for (const l of linhas) console.log(l);
  }
  console.log('\nTabelas do dev sem model (colunas):');
  for (const t of Object.keys(real).filter((x) => !porTabela[x])) console.log(' ', t, Object.keys(real[t]).length, 'colunas');
  await encerrarLegado();
})().catch((e) => { console.log('ERRO:', e.name, String(e.message).slice(0, 160)); process.exit(1); });
