'use strict';

/**
 * Gera os CASOS DE OURO dos dados da ficha (nome completo, CPF, e-mail, telefones, endereço) a partir do CÓDIGO do front, rodando o caminho REAL do
 * editor de cadastro: `prepareClientRegistrationEdit` (client-registration-editor-model.ts), que chama normalizeClientEmail, validDuplicateCpf,
 * clientPhoneComplete, validateClientRegistration, validateClientAddress e validateText. Também grava o que o front aceita para Pré/Pós
 * (`legacyIdentityChanges`, legacy-client-write.ts), que não impõe sentido nenhum.
 * Grava em scripts/apoio-gf-ficha-dados/ouro.json.   node scripts/gerar-ouro-gf-ficha-dados.js --front=<pasta do front>
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

const CPFS = ['529.982.247-25', '52998224725', ' 529.982.247-25 ', '111.111.111-11', '123', '52998224724', 'abc', '529.982.247-2', '5299822472500', '000.000.000-00', '529 982 247 25', '529.982.247-25\n', `${'1'.repeat(51)}`, '529.982.247-25\u0001', '11144477735', '1114447773x'];
const EMAILS = ['ana@exemplo.com', 'Ana.Silva@Exemplo.COM.BR', ' ana@exemplo.com ', 'sem-arroba', 'a@b', 'a@b.c', 'a b@c.com', '.a@b.com', 'a.@b.com', 'a..b@c.com', 'a@b..com', 'a@-b.com', 'a@b-.com', 'a@b.123', 'ana@exemplo.com.br', 'a@@b.com', '@b.com', 'a@.com',
  `${'x'.repeat(45)}@b.com`, `${'x'.repeat(40)}@ex.com`, 'ana(comentario)@b.com', 'ana,x@b.com', 'ana@exemplo.com\u0001', 'ana+etiqueta@exemplo.com', 'ana\n@b.com', 'ánna@exemplo.com'];
const NOMES = ['Ana Souza', ' Ana Souza ', 'ANA SOUZA', 'Ana\nSouza', 'Ana\u0001Souza', 'A'.repeat(255), 'A'.repeat(256), 'Ana 😀 Souza', 'Ana\tSouza', 'Ana\u0085Souza', 'Zé'];
const FONES = [
  { phones: ['+55 11 98888-7777'] }, { phones: ['+55 11 98888-7777', '+55 21 93333-4444'], consultationPhoneIndex: 1, whatsappPhoneIndex: 0 },
  { phones: ['11988887777', '2133334444'], consultationPhoneIndex: 0, whatsappPhoneIndex: 1 }, { phones: ['(11) 98888-7777'] }, { phones: ['98888-7777'] }, { phones: ['+55 98888-7777'] },
  { phones: ['+351 912 345 678'] }, { phones: ['+1 415 555 0100', '+55 11 3333-4444'] }, { phones: ['abc'] }, { phones: ['1234567'] }, { phones: ['+55 11 98888-7777', ''] },
  { phones: ['+55 11 98888-7777', '+55 11 98888-7777'] }, { phones: ['+55 11 98888-7777', '+55 21 93333-4444'], consultationPhoneIndex: 5, whatsappPhoneIndex: 0 },
  { phones: ['+55 11 98888-7777'], consultationPhoneIndex: -1 }, { phones: ['+55 11 98888-7777'], whatsappPhoneIndex: 1.5 }, { phones: ['0011988887777'] }, { phones: ['5511988887777'] },
  { phones: ['+5511988887777'] }, { phones: ['+55 (11) 3333-4444'] }, { phones: ['1'.repeat(16)] }, { phones: ['+55 11 98888-7777\n'] }, { phones: ['x'.repeat(51)] },
];
const ENDERECOS = [
  { street: 'Rua A', number: '10', complement: 'Apto 2', district: 'Centro', zip: '50000-000', city: 'Recife', state: 'PE', country: '' },
  { street: 'Rua A', number: '10', complement: '', district: '', zip: '50000000', city: 'Recife', state: 'pe', country: 'Brasil' },
  { street: 'Rua A', number: '10', complement: '', district: '', zip: '5000-000', city: 'Recife', state: 'PE', country: 'BR' },
  { street: 'Rua A', number: '10', complement: '', district: '', zip: '50000-000', city: 'Recife', state: 'PER', country: 'BR' },
  { street: 'Rua A', number: '10', complement: '', district: '', zip: '50000-000', city: 'Recife', state: '1A', country: 'brazil' },
  { street: '5th Avenue', number: '350', complement: '', district: '', zip: '10118', city: 'New York', state: 'New York', country: 'USA' },
  { street: 'X', number: '1', complement: '', district: '', zip: 'A'.repeat(25), city: 'Y', state: 'Z', country: 'Portugal' },
  { street: 'R'.repeat(201), number: '1', complement: '', district: '', zip: '50000-000', city: 'Recife', state: 'PE', country: '' },
  { street: 'Rua A', number: '1'.repeat(21), complement: '', district: '', zip: '50000-000', city: 'Recife', state: 'PE', country: '' },
  { street: 'Rua A', number: '1', complement: 'C'.repeat(101), district: '', zip: '50000-000', city: 'Recife', state: 'PE', country: '' },
  { street: 'Rua A\nB', number: '1', complement: '', district: '', zip: '50000-000', city: 'Recife', state: 'PE', country: '' },
  { street: ' Rua A ', number: ' 1 ', complement: '', district: '', zip: ' 50000-000 ', city: ' Recife ', state: ' PE ', country: '' },
  { street: '', number: '', complement: '', district: '', zip: '', city: 'Recife', state: '', country: '' },
  { street: '', number: '', complement: '', district: '', zip: '', city: '', state: '', country: '' },
  { cep: '50000-000', street: 'Rua A', number: '1', complement: '', district: '', city: 'Recife', state: 'PE', country: '' },
  [], 'Rua A', null,
];
const REGIMES = ['', 'Pré-pago', 'Pós-pago', 'Pre', 'pós-pago', 'Pré-paga', 'x'];

async function main() {
  const { createServer } = req('vite');
  const { realCalendarPlugin } = await import(pathToFileURL(path.join(front, 'tests', 'helpers', 'calendar.mjs')).href);
  const vite = await createServer({ plugins: [realCalendarPlugin()], root: front, appType: 'custom', configFile: false, cacheDir: '/private/tmp/fadas-ouro-ficha-dados', resolve: { alias: { '@': front } }, server: { middlewareMode: true, hmr: false, ws: false }, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const editor = await vite.ssrLoadModule('/features/clientes/client-registration-editor-model.ts');
    const escrita = await vite.ssrLoadModule('/features/integration/legacy-client-write.ts');
    const identity = { name: 'Ana', treatAs: 'Ana', birthDate: '17/05/1990', whatsapp: '+55 11 98888-7777', paymentProfile: 'Pré-pago' };
    const registration = { fullName: 'Ana Souza', phones: ['+55 11 98888-7777', '+55 21 93333-4444'], consultationPhoneIndex: 0, whatsappPhoneIndex: 0 };
    // O que o editor entrega para gravar quando só estes campos mudam (caminho real); erro = a mensagem que a tela mostra.
    const editar = (mudou) => {
      try {
        const out = editor.prepareClientRegistrationEdit({ identity, registration: { ...registration, ...mudou }, baselineIdentity: identity, baselineRegistration: registration, latestIdentity: identity, latestRegistration: registration, role: 'administradora' });
        const r = out.registration;
        const ok = {};
        for (const k of ['fullName', 'cpf', 'email', 'phones', 'consultationPhoneIndex', 'whatsappPhoneIndex', 'address']) if (r[k] !== undefined) ok[k] = r[k];
        return { ok };
      } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; }
    };
    const cpf = CPFS.map((v) => ({ v, front: editar({ cpf: v }) }));
    const email = EMAILS.map((v) => ({ v, front: editar({ email: v }) }));
    const nome = NOMES.map((v) => ({ v, front: editar({ fullName: v }) }));
    const fones = FONES.map((v) => ({ v, front: editar(v) }));
    const endereco = ENDERECOS.map((v) => ({ v, front: editar({ address: v }) }));
    const regime = REGIMES.map((v) => { try { escrita.legacyIdentityChanges('1', { paymentProfile: v }); return { v, front: 'aceita' }; } catch (e) { return { v, front: e.message }; } });
    const saida = path.join(__dirname, 'apoio-gf-ficha-dados', 'ouro.json');
    fs.writeFileSync(saida, JSON.stringify({ geradoDe: 'client-registration-editor-model (prepareClientRegistrationEdit), legacy-client-write (legacyIdentityChanges)', identity, registration, cpf, email, nome, fones, endereco, regime }));
    console.log(`Ouro gravado: ${cpf.length} CPFs, ${email.length} e-mails, ${nome.length} nomes, ${fones.length} telefones, ${endereco.length} endereços, ${regime.length} regimes.`);
  } finally { await vite.close(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
