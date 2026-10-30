'use strict';

/**
 * Gera as fixtures de ouro do teste diferencial (scripts/verificar-gf-diferencial-b.js) A PARTIR DO CÓDIGO REAL DA B.
 * Só precisa rodar de novo quando a B mudar. Uso (o FRONT tem de ter node_modules instalado; nada nele é alterado):
 *   node scripts/gerar-ouro-gf-diferencial-b.js --front=<pasta do FRONT da B com node_modules>
 * Monta num diretório temporário cópias de real-payouts-http.server.ts e real-clients-http.server.ts com os imports
 * absolutos e UMA linha a mais de export (para alcançar os esquemas zod e as funções de view, que não são exportados), e
 * roda o gerador TypeScript (scripts/apoio-gf-diferencial/gerador/*.ts) com tsx. Escreve em fontes/ouro-validacao/.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const arg = (nome) => (process.argv.find((a) => a.startsWith(`--${nome}=`)) || '').slice(nome.length + 3);
const front = path.resolve(arg('front') || '');
if (!arg('front') || !fs.existsSync(path.join(front, 'node_modules', 'zod'))) {
  console.error('Informe --front=<pasta do FRONT da B com node_modules>.');
  process.exit(2);
}
const raiz = path.join(__dirname, '..');
const gerador = path.join(__dirname, 'apoio-gf-diferencial', 'gerador');
const saida = path.join(raiz, 'src', 'gestao-fadas', 'fontes', 'ouro-validacao');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ouro-b-'));
fs.symlinkSync(path.join(front, 'node_modules'), path.join(tmp, 'node_modules'));

/** Cópia do arquivo da B com os imports relativos em absolutos e o export extra no fim. */
function copiar(relativo, destino, exportar) {
  const origem = path.join(front, relativo);
  const texto = fs.readFileSync(origem, 'utf8').replace(/from "(\.{1,2}\/[^"]+)"/g, (_m, rel) => `from "${path.resolve(path.dirname(origem), rel)}"`);
  fs.writeFileSync(path.join(tmp, destino), `${texto}\n${exportar}\n`);
  return crypto.createHash('sha256').update(fs.readFileSync(origem)).digest('hex');
}
const hashes = {
  'features/finance/real-payouts-http.server.ts': copiar('features/finance/real-payouts-http.server.ts', 'b-http.ts',
    'export const __B = { TAROT_ID, OPENING_ID, commissionBody, scheduleBody, openingBody, correctionBody, confirmBody, openingInput, openingView, agreementOf, currentOf, namesIn };'),
  'features/clientes/real-clients-http.server.ts': copiar('features/clientes/real-clients-http.server.ts', 'b-clients.ts', 'export const __C = { LEGACY_ID, GRANT_BODY };'),
};
for (const arquivo of ['db/finance-store.ts', 'features/clientes/real-clients-model.ts', 'features/integrations/payout-audit.ts', 'features/integration/legacy-values.ts', 'features/shared/real-period.ts']) {
  hashes[arquivo] = crypto.createHash('sha256').update(fs.readFileSync(path.join(front, arquivo))).digest('hex');
}
for (const nome of fs.readdirSync(gerador).filter((n) => n.endsWith('.ts'))) {
  fs.writeFileSync(path.join(tmp, nome), fs.readFileSync(path.join(gerador, nome), 'utf8').replaceAll('"/FRONT/', `"${front}/`));
}
const r = spawnSync(path.join(front, 'node_modules', '.bin', 'tsx'), [path.join(tmp, 'index.ts')], {
  cwd: tmp, stdio: 'inherit',
  env: { ...process.env, TSX_TSCONFIG_PATH: path.join(front, 'tsconfig.json'), GF_A_RAIZ: raiz, GF_OURO_SAIDA: saida },
});
fs.rmSync(tmp, { recursive: true, force: true });
if (r.status !== 0) process.exit(r.status || 1);
const origem = ['Fixtures geradas pelo código REAL da API B (zod de real-payouts-http.server.ts e db/finance-store.ts, view e store) por',
  'scripts/gerar-ouro-gf-diferencial-b.js, nos cenários e casos de scripts/apoio-gf-diferencial/. Conferidas offline por',
  'scripts/verificar-gf-diferencial-b.js. SHA-256 dos arquivos da B usados:', ...Object.entries(hashes).map(([a, h]) => `  ${h}  ${a}`), ''].join('\n');
fs.writeFileSync(path.join(saida, 'ORIGEM.txt'), origem);
console.log(`ouro escrito em ${saida}`);
