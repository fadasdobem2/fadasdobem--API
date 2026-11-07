'use strict';

/**
 * Gera os CASOS DE OURO das regras de Clientes da v706 a partir do CÓDIGO do front:
 *   - client-search-model.ts (`clientPhoneMatches`); client-workspace-model.ts (`clientRolePolicy`, `clientListRange`);
 *   - client-whatsapp-format.ts (`clientWhatsAppText`); server/lilly/registration-format.mjs (nomes e `normalizeDuplicatePhone`);
 *   - client-profile-history.tsx: o tamanho da página é a constante `pageSize` do componente (lida do texto, não executável).
 * Grava em scripts/apoio-gf-clientes/ouro-clientes-v706.json.   node scripts/gerar-ouro-gf-clientes-v706.js --front=<pasta do front>
 * Todo valor é fictício.
 */

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const front = path.resolve(arg('front'));
if (!arg('front') || !fs.existsSync(path.join(front, 'package.json'))) { console.error('Informe --front=<pasta do front>'); process.exit(2); }
const req = createRequire(path.join(front, 'package.json'));
const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];
const tentar = (fn) => { try { return { ok: fn() }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

const CONSULTAS = ['88877766', '11 88877766', '99887766', '988877766', '9887766', '1199887766', '11988877766', '11 98887-7766', '+55 11 98887-7766', '+5511988877766', '5511988877766', '21988877766', '2133334444',
  '33334444', '3333-4444', '(11) 3333-4444', '+351 912 345 678', '912345678', '+1 415 555 0100', '8887766', '88877', '', 'abc', '12', '98887766', '+55 11 3333-4444', '0011988877766'];
const GUARDADOS = ['88877766', '11 88877766', '(11) 8887-7766', '11 98887-7766', '(11) 3333-4444', '98887766', '988877766', '3333-4444', '+351 912 345 678', '+55 21 98887-7766', '11988877766', '', '5511988877766', '4155550100', '+14155550100'];
const NOMES = ['Maria Clara Souza Lima', 'ana paula', 'JOÃO PEDRO DA SILVA', 'José Carlos de Oliveira Santos', 'Luiz Carlos', 'Marina', 'Marina Souza', 'Marina Souza Lima Costa', 'Ana Maria de Souza',
  'Maria de Fátima dos Santos Pereira', 'Carlos Eduardo', '', '   ', 'Paulo Henrique de Almeida Prado Neto', 'joão da silva', 'MARIA DA SILVA', 'ANA D\'AVILA', "Ana McDonald", 'maria-clara o\'brien', 'Pedro de Souza e Silva'];
const FONES = ['+55 11 98887-7766', '(11) 98887-7766', '11988877766', '5511988877766', '+5511988877766', '988877766', '98887766', '8887766', '00351912345678', '+351912345678', '+1 415 555 0100', '4155550100',
  '', '  ', 'abc', '+55 98887-7766', '+55 (11) 3333-4444', '(11) 3333-4444', '555511988877766', '+55 11 98887 7766'];

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-clientes-v706', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const busca = await vite.ssrLoadModule('/features/clientes/client-search-model.ts');
    const area = await vite.ssrLoadModule('/features/clientes/client-workspace-model.ts');
    const zap = await vite.ssrLoadModule('/features/clientes/client-whatsapp-format.ts');
    const fmt = await vite.ssrLoadModule('/server/lilly/registration-format.mjs');
    const telefone = [];
    for (const q of CONSULTAS) for (const s of GUARDADOS) telefone.push({ q, s, casa: busca.clientPhoneMatches(q, s) });
    const MODOS = ['hoje', 'ontem', '7dias', 'data', 'periodo', '3dias', 'xx'];
    const politica = PAPEIS.map((papel) => ({ papel, dates: area.clientRolePolicy(papel).dates, pageSize: area.clientRolePolicy(papel).pageSize, canSeeBalance: area.clientRolePolicy(papel).canSeeBalance }));
    const faixa = [];
    for (const papel of PAPEIS) for (const modo of MODOS) for (const [start, end] of [['2026-10-20', '2026-10-25'], ['2026-10-25', '2026-10-20'], ['2026-10-22', '2026-10-22']]) {
      faixa.push({ papel, modo, today: '2026-11-07', start, end, r: tentar(() => area.clientListRange(papel, modo, '2026-11-07', start, end)).ok ?? null });
    }
    const whats = FONES.map((v) => ({ v, saida: zap.clientWhatsAppText(v) }));
    const nomes = NOMES.map((n) => ({ n, sugerido: fmt.suggestedRegistrationNames(n), compra: fmt.suggestedClientNames(n), completo: fmt.registrationFullName(n) }));
    const duplicado = FONES.map((v) => ({ v, norm: fmt.normalizeDuplicatePhone(v) }));
    const historico = fs.readFileSync(path.join(front, 'features/clientes/client-profile-history.tsx'), 'utf8');
    const m = historico.match(/const pageSize=(\d+);/);
    const saida = path.join(__dirname, 'apoio-gf-clientes', 'ouro-clientes-v706.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'client-search-model, client-workspace-model, client-whatsapp-format, registration-format, client-profile-history', telefone, politica, faixa, whats, nomes, duplicado, paginaHistorico: m ? Number(m[1]) : null }));
    console.log(`Ouro gravado: ${telefone.length} telefones, ${faixa.length} faixas, ${whats.length} whats, ${nomes.length} nomes, ${duplicado.length} duplicidades, página ${m && m[1]}.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
