'use strict';

/**
 * Gera o OURO da tradução front -> colunas de `usuarios` (Maturacao/45) a partir do CÓDIGO do front:
 *   `features/integration/legacy-client-write.ts` (`legacyIdentityChanges`): o front já diz quais colunas legadas cada edição de cliente vira
 *   (`nome_id`, `nome2`, `whats`, `datanascimento`) e com quais limites. A função da API (`legado-escrita/clientes.js` `linhaDoCliente`) tem de dar
 *   o MESMO resultado onde o front aceita e RECUSAR onde o front recusa. Grava entradas e saídas em scripts/apoio-gf-espelho-legado/ouro-cliente-front.json.
 *   node scripts/gerar-ouro-gf-espelho-legado.js --front=<pasta do front>
 * Usa o vite do próprio front (ssrLoadModule) com o calendário real. Nenhum SQL é executado. Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

const NOMES = ['Ana Souza', '  Ana  ', '', '   ', 'x'.repeat(50), 'x'.repeat(51), 'João Ação', 'a😀b', 'a\u0001b', 'a\nb', 'a\tb', '\ud800', 'x'.repeat(49) + '😀', 'Zé'];
const TRATAR = ['Aninha', '', '  ', 'y'.repeat(50), 'y'.repeat(51), 'oi 🔮', 'li\nnha', 'ç'];
const WHATS = ['+55 11 98888-0000', '', '  ', '5'.repeat(45), '5'.repeat(46), '11 9 9999 🙂', 'a\u0007b'];
const NASC = ['05/03/1980', ' 05/03/1980 ', '29/02/2000', '29/02/1999', '31/04/1990', '00/01/1990', '01/13/1990', '01/01/0999', '01/01/1000', '01/01/9999', '1980-03-05', '5/3/1980', '', '  ', '32/01/1990', '15/08/2026'];
const PERFIL = ['', 'Pré-pago', 'Pós-pago', 'Pré-paga', 'lixo'];

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-espelho-legado', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'error' });
  try {
    const m = await vite.ssrLoadModule('/features/integration/legacy-client-write.ts');
    const casos = [];
    const um = (mudancas) => { const r = tentar(() => m.legacyIdentityChanges('900013', mudancas)); casos.push({ mudancas, legacy: r.ok ? r.ok.legacy : null, extension: r.ok ? r.ok.extension : null, erro: r.erro || null }); };
    for (const v of NOMES) um({ name: v });
    for (const v of TRATAR) um({ treatAs: v });
    for (const v of WHATS) um({ whatsapp: v });
    for (const v of NASC) um({ birthDate: v });
    for (const v of PERFIL) um({ paymentProfile: v });
    // Combinações: tudo junto e subconjuntos (o UPDATE leva só o que mudou).
    um({ name: 'Ana', treatAs: 'Aninha', whatsapp: '+55 11 90000-0000', birthDate: '05/03/1980', paymentProfile: 'Pré-pago' });
    um({ name: 'Ana', whatsapp: '' });
    um({ treatAs: '', birthDate: '29/02/2000' });
    um({ name: '', treatAs: 'ok' });
    um({});
    // Ids: o front valida o id do cliente.
    const ids = ['1', '900013', '2147483647', '2147483648', '0', '-1', 'abc', '', '01'].map((id) => { const r = tentar(() => m.legacyIdentityChanges(id, { name: 'Ana' })); return { id, ok: Boolean(r.ok), erro: r.erro || null }; });
    const saida = path.join(__dirname, 'apoio-gf-espelho-legado', 'ouro-cliente-front.json');
    fs.writeFileSync(saida, `${JSON.stringify({ geradoDe: 'features/integration/legacy-client-write.ts (legacyIdentityChanges)', casos, ids }, null, 1)}\n`);
    console.log(`Ouro gravado: ${casos.length} casos de edição, ${ids.length} ids.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
