'use strict';

/**
 * Gera o OURO dos e-mails da v711 a partir do CÓDIGO REAL do front, em scripts/apoio-gf-email/ouro.json:
 *   node scripts/gerar-ouro-gf-email.js --front=<pasta do front com node_modules>
 * Roda: validateEmailSettings, validMailbox, validMailId (features/email/email-model.ts), handleEmail (email-service.ts, com repositório, envio e convites
 * falsos), encryptMailSecret/decryptMailSecret (email-crypto.ts), smtpMessage e sendSmtp (server/email/smtp-transport.mjs, sem abrir rede). Nada do front é alterado.
 * Tudo fictício; relógio fixo.
 */

const fs = require('fs');
const path = require('path');
const { abrir } = require('./apoio-gf-regras-b/front');
const C = require('./apoio-gf-email/cenarios');

const arg = (n) => (process.argv.find((a) => a.startsWith(`--${n}=`)) || '').slice(n.length + 3);
const j = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const tentar = async (fn) => { try { return { ok: j(await fn()) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

async function rodarPedidos(f) {
  const repo = C.repoFalso(); const enviados = [];
  const convites = C.convitesFalsos(f.MailOperationError);
  const env = { EMAIL_ENCRYPTION_KEY: C.MESTRA, EMAIL_PUBLIC_ORIGIN: C.ORIGEM };
  const atores = { admin: { id: 'admin', role: 'administradora' }, staff: { id: 'staff', role: 'atendente' } };
  const saida = [];
  for (const p of C.PEDIDOS) {
    const antes = enviados.length;
    const init = { method: p.method, headers: { Origin: C.ORIGEM, 'Content-Type': 'application/json' }, ...(p.body !== undefined && !['GET', 'HEAD'].includes(p.method) ? { body: JSON.stringify(p.body) } : {}) };
    const r = await f.handleEmail(new Request(`${C.ORIGEM}/api/email?resource=${p.resource}`, init), env, { repository: repo, send: C.envioFalso(enviados), actor: p.actor ? atores[p.actor] : null, invitations: convites, now: () => C.AGORA });
    const corpo = await r.json();
    saida.push({ ...p, saida: C.normalizar({ status: r.status, corpo, enviado: enviados.slice(antes) }) });
  }
  return saida;
}

(async () => {
  if (!arg('front')) { console.error('Informe --front=<pasta do front com node_modules>'); process.exit(2); }
  const ctx = await abrir(arg('front'));
  try {
    const modelo = await ctx.carregar('/features/email/email-model.ts');
    const servico = await ctx.carregar('/features/email/email-service.ts');
    const cripto = await ctx.carregar('/features/email/email-crypto.ts');
    const erros = await ctx.carregar('/features/email/email-errors.ts');
    const smtp = await ctx.carregar('/server/email/smtp-transport.mjs');
    const ouro = { gerado: 'a partir do código do front v711 (features/email/*, server/email/smtp-transport.mjs)', agora: C.AGORA };
    ouro.configuracoes = [];
    for (const [nome, entrada] of C.CONFIGURACOES) ouro.configuracoes.push({ nome, entrada: j(entrada), esperado: await tentar(() => modelo.validateEmailSettings(j(entrada))) });
    ouro.caixas = C.CAIXAS.map((e) => ({ e, esperado: modelo.validMailbox(e) }));
    ouro.ids = C.IDS.map((e) => ({ e, esperado: modelo.validMailId(e) }));
    ouro.vazia = j(modelo.emptyEmailSettings());
    ouro.pedidos = await rodarPedidos({ handleEmail: servico.handleEmail, MailOperationError: erros.MailOperationError });
    const cifra = await cripto.encryptMailSecret('segredo-ficticio', C.MESTRA, 'one');
    ouro.cripto = { cifra, segredo: 'segredo-ficticio', id: 'one', formato: /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(cifra), outroId: await tentar(() => cripto.decryptMailSecret(cifra, C.MESTRA, 'outra')), outraChave: await tentar(() => cripto.decryptMailSecret(cifra, Buffer.alloc(32, 9).toString('base64'), 'one')) };
    ouro.mensagens = C.MENSAGENS.map((m) => ({ m: j(m), esperado: (() => { try { return { ok: smtp.smtpMessage(m) }; } catch (e) { return { erro: e.message }; } })() }));
    ouro.enderecos = [];
    for (const address of C.ENDERECOS) {
      let abriu = false;
      const r = await tentar(() => smtp.sendSmtp(C.smtp({ port: 465, security: 'tls' }), 'senha-ficticia', { to: 'a@example.org', subject: 'T', text: 't', sender: C.remetente }, { resolve: async () => [{ address }], secureConnect: () => { abriu = true; throw new Error('parou'); } }));
      ouro.enderecos.push({ address, esperado: { ...r, abriu } });
    }
    ouro.conexoes = [];
    for (const [nome, conexao] of C.CONEXOES_SMTP) {
      let abriu = false;
      const r = await tentar(() => smtp.sendSmtp(j(conexao), 'senha-ficticia', { to: 'a@example.org', subject: 'T', text: 't', sender: C.remetente }, { resolve: async () => [{ address: '8.8.8.8' }], secureConnect: () => { abriu = true; throw new Error('parou'); }, connect: () => { abriu = true; throw new Error('parou'); } }));
      ouro.conexoes.push({ nome, conexao: j(conexao), esperado: { ...r, abriu } });
    }
    fs.writeFileSync(path.join(__dirname, 'apoio-gf-email', 'ouro.json'), `${JSON.stringify(ouro)}\n`);
    console.log(`configurações ${ouro.configuracoes.length} | pedidos ${ouro.pedidos.length} | mensagens ${ouro.mensagens.length} | endereços ${ouro.enderecos.length} | conexões ${ouro.conexoes.length}`);
  } finally { await ctx.fechar(); }
})().catch((e) => { console.error(e); process.exit(2); });
