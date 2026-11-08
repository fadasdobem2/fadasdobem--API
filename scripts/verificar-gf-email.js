'use strict';

/**
 * Verificação dos E-MAILS da v711 (Configurações > E-mails, convite por e-mail e recuperação), contra o CÓDIGO REAL do front (ouro em
 * scripts/apoio-gf-email/ouro.json, gerado por gerar-ouro-gf-email.js). Roda SEM banco e SEM rede externa:
 *   1) domínio (validateEmailSettings, remetente, id) e serviço (todos os recursos, com repositório, envio e convites falsos) iguais ao front;
 *   2) criptografia: o texto cifrado do front abre na API e vice-versa; segredo nunca em claro (resposta, recibo, histórico, armazenado, log);
 *   3) SMTP: mensagem MIME e política de endereço público iguais ao front; envio REAL contra um servidor falso local, TLS obrigatório;
 *   4) o gate (flag, origem, JSON, sessão), as regras da API (envio desligado por padrão) e mutantes refutados.
 * Sem `--offline` roda também o filho com Postgres descartável (apoio-gf-email/filho.js): tabelas, CHECKs, gatilho, rotas com banco.
 */

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const { execFileSync } = require('child_process');
const express = require('express');
const pg = require('./apoio-esquema/pg');
const C = require('./apoio-gf-email/cenarios');
const { criarServidor } = require('./apoio-gf-email/smtp-falso');
const { RAIZ, FEATURE, ouro, carregarMutante, modulo, tentar, rodarPedidos } = require('./apoio-gf-email/comparar');

let ok = 0;
const falhas = [];
async function passo(nome, fn) {
  try { await fn(); ok += 1; console.log(`  ok  ${nome}`); } catch (e) { falhas.push(nome); console.log(`  FALHOU  ${nome}: ${String(e.message).slice(0, 400)}`); }
}
const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const DOM = 'src/gestao-fadas/_comum/dominio/email-modelo.js';
const f = (n) => `${FEATURE}/${n}`;
const MSG_ENVIO = { to: 'a@example.org', subject: 'Teste', text: 'corpo', sender: C.remetente };

function divergenciasDoDominio(m) {
  const d = [];
  for (const x of ouro.configuracoes) if (!igual(tentar(() => m.validateEmailSettings(JSON.parse(JSON.stringify(x.entrada)))), x.esperado)) d.push(`configuração "${x.nome}"`);
  for (const x of ouro.caixas) if (m.validMailbox(x.e) !== x.esperado) d.push(`caixa ${JSON.stringify(x.e).slice(0, 30)}`);
  for (const x of ouro.ids) if (m.validMailId(x.e) !== x.esperado) d.push(`id ${JSON.stringify(x.e)}`);
  if (!igual(m.emptyEmailSettings(), ouro.vazia)) d.push('configuração vazia');
  return d;
}

function divergenciasDoServico(saida) {
  const d = [];
  saida.forEach((p, i) => { if (!igual(p.saida, ouro.pedidos[i].saida)) d.push(`pedido ${i} ${p.resource} ${p.method}: ${JSON.stringify(p.saida).slice(0, 160)} != ${JSON.stringify(ouro.pedidos[i].saida).slice(0, 160)}`); });
  return d;
}

async function servicoDe(rel = null, de = null, para = null) {
  const svc = rel === 'service' ? carregarMutante(f('email.service.js'), de, para) : modulo(f('email.service.js'));
  return { servico: svc, EmailErro: modulo(f('email.erro.js')).EmailErro };
}

function divergenciasSmtp(smtp) {
  const d = [];
  ouro.mensagens.forEach((x, i) => { if (!igual(tentar(() => smtp.smtpMessage(x.m)), x.esperado)) d.push(`mensagem ${i}`); });
  for (const x of ouro.enderecos) if (!igual(x.address === 'nao-e-ip' ? { x: 1 } : { x: 1 }, { x: 1 }) ) d.push('?');
  return d;
}

async function offline() {
  const dom = modulo(DOM); const erro = modulo(f('email.erro.js')).EmailErro;

  console.log('Domínio contra o ouro do front');
  await passo(`configuração, remetente e identificação iguais ao front (${ouro.configuracoes.length} configurações, ${ouro.caixas.length} caixas, ${ouro.ids.length} ids)`, () => { const d = divergenciasDoDominio(dom); assert.deepStrictEqual(d, []); });
  await passo('o ouro cobre as recusas de servidor, porta/segurança, quebra de linha, vírgula, remetente parcial e 21 conexões', () => {
    const msgs = new Set(ouro.configuracoes.map((c) => c.esperado.erro).filter(Boolean));
    assert.ok(msgs.size >= 6, [...msgs].join(' | '));
    assert.ok(ouro.configuracoes.filter((c) => c.esperado.ok).length >= 6);
  });

  console.log('Serviço (todos os recursos) contra o ouro do front');
  const { servico } = await servicoDe();
  const base = await rodarPedidos({ servico, EmailErro: erro });
  await passo(`${ouro.pedidos.length} pedidos com estado: mesma resposta, mesmo recibo, mesmo remetente, mesma mensagem enviada`, () => assert.deepStrictEqual(divergenciasDoServico(base.saida), []));
  await passo('o ouro cobre aceito, falhou 502, 403, 409, 429, recuperação sem revelar conta, reaproveitamento e troca de segredo', () => {
    const st = new Set(ouro.pedidos.map((p) => p.saida.status));
    for (const s of [200, 400, 403, 405, 409, 429, 502]) assert.ok(st.has(s), `sem ${s}`);
    assert.ok(ouro.pedidos.filter((p) => p.resource === 'recovery').every((p) => p.saida.status !== 200 || JSON.stringify(p.saida.corpo) === '{"status":"accepted"}'));
    assert.ok(ouro.pedidos.some((p) => p.saida.enviado.length && p.saida.enviado[0].secret === 'senha-ficticia'));
  });

  console.log('Segredo nunca em claro');
  const todo = JSON.stringify([base.saida.map((p) => ({ ...p.saida, enviado: undefined })), base.repo.eventos, await base.repo.read()]);
  await passo('resposta, recibo, histórico e configuração guardada não contêm segredo; só o texto cifrado v1', async () => {
    for (const s of ['segredo-ficticio', 'senha-ficticia']) assert.ok(!todo.includes(s), `vazou ${s}`);
    const guardado = await base.repo.read();
    assert.ok(Object.values(guardado.secrets).length >= 1 && Object.values(guardado.secrets).every((c) => /^v1\.[\w+/=]+\.[\w+/=]+$/.test(c)));
    assert.ok(!JSON.stringify(guardado.settings).includes('secret'));
    assert.ok(base.saida.filter((p) => p.resource === 'settings').every((p) => !JSON.stringify(p.saida.corpo).includes('secrets')));
  });
  await passo('nenhum log (console) recebe segredo, mensagem ou erro do provedor durante toda a sequência', async () => {
    const guarda = []; const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
    for (const k of Object.keys(orig)) console[k] = (...a) => guarda.push(a.join(' '));
    try { await rodarPedidos({ servico, EmailErro: erro }); } finally { Object.assign(console, orig); }
    assert.ok(!guarda.join('\n').match(/segredo-ficticio|senha-ficticia|ecoou/), guarda.join('\n').slice(0, 200));
  });

  console.log('Criptografia (AES-256-GCM, compatível com o front)');
  const cr = modulo(f('email.cripto.js'));
  await passo('o texto cifrado gerado pelo front abre na API, e o da API abre com a mesma chave; outra conexão ou chave não abre', () => {
    assert.strictEqual(cr.decifrarSegredo(ouro.cripto.cifra, C.MESTRA, 'one'), 'segredo-ficticio');
    assert.ok(ouro.cripto.formato && ouro.cripto.outroId.erro && ouro.cripto.outraChave.erro);
    const c = cr.cifrarSegredo('outro segredo ç', C.MESTRA, 'a');
    assert.ok(/^v1\./.test(c)); assert.strictEqual(cr.decifrarSegredo(c, C.MESTRA, 'a'), 'outro segredo ç');
    assert.notStrictEqual(cr.cifrarSegredo('x', C.MESTRA, 'a'), cr.cifrarSegredo('x', C.MESTRA, 'a'));
    assert.throws(() => cr.decifrarSegredo(c, C.MESTRA, 'b'));
    assert.throws(() => cr.decifrarSegredo(c, Buffer.alloc(32, 9).toString('base64'), 'a'));
    const [v, iv, dados] = c.split('.'); const adulterado = Buffer.from(dados, 'base64'); adulterado[0] ^= 1;
    assert.throws(() => cr.decifrarSegredo(`${v}.${iv}.${adulterado.toString('base64')}`, C.MESTRA, 'a'));
    for (const ruim of ['', 'v2.a.b', 'v1..', 'v1.a', 'lixo']) assert.throws(() => cr.decifrarSegredo(ruim, C.MESTRA, 'a'));
  });
  await passo('chave mestra ausente, curta ou longa é recusada (nada é cifrado com chave fraca)', () => {
    for (const k of [undefined, '', 'curta', Buffer.alloc(16).toString('base64'), Buffer.alloc(33).toString('base64')]) { assert.throws(() => cr.cifrarSegredo('x', k, 'a')); assert.strictEqual(cr.chaveConfigurada(k), false); }
    assert.strictEqual(cr.chaveConfigurada(C.MESTRA), true);
  });

  console.log('SMTP: mensagem e política de endereço');
  const sm = modulo(f('email.smtp.mensagem.js')); const smtp = modulo(f('email.smtp.js'));
  await passo(`mensagem MIME idêntica ao front (${ouro.mensagens.length} casos, inclusive injeção de cabeçalho e destinatário extra)`, () => {
    ouro.mensagens.forEach((x, i) => assert.ok(igual(tentar(() => sm.smtpMessage(x.m)), x.esperado), `mensagem ${i}`));
  });
  await passo(`só endereço público abre socket: ${ouro.enderecos.length} endereços, mesma decisão do front`, async () => {
    for (const x of ouro.enderecos) {
      let abriu = false;
      const r = await smtp.sendSmtp(C.smtp({ port: 465, security: 'tls' }), 'senha-ficticia', { ...MSG_ENVIO }, { resolve: async () => [{ address: x.address }], secureConnect: () => { abriu = true; throw new Error('parou'); } }).then(() => ({ ok: null }), (e) => ({ erro: e.message }));
      assert.ok(igual({ ...r, abriu }, x.esperado), `${x.address}: ${JSON.stringify({ ...r, abriu })} != ${JSON.stringify(x.esperado)}`);
    }
  });
  await passo('conexão inválida (porta, segurança, host sem ponto, quebra de linha, resend) é recusada antes de abrir socket, como no front', async () => {
    for (const x of ouro.conexoes) {
      let abriu = false;
      const r = await smtp.sendSmtp(JSON.parse(JSON.stringify(x.conexao)), 'senha-ficticia', { ...MSG_ENVIO }, { resolve: async () => [{ address: '8.8.8.8' }], secureConnect: () => { abriu = true; throw new Error('parou'); }, connect: () => { abriu = true; throw new Error('parou'); } }).then(() => ({ ok: null }), (e) => ({ erro: e.message }));
      assert.ok(igual({ ...r, abriu }, x.esperado), x.nome);
    }
    await assert.rejects(smtp.sendSmtp(C.smtp(), '', { ...MSG_ENVIO }, { resolve: async () => [{ address: '8.8.8.8' }] }), /invalid-smtp-configuration/);
    await assert.rejects(smtp.sendSmtp(C.smtp(), 'a\nb', { ...MSG_ENVIO }, { resolve: async () => [{ address: '8.8.8.8' }] }), /invalid-smtp-configuration/);
    await assert.rejects(smtp.sendSmtp(C.smtp(), 'x', { ...MSG_ENVIO }, { resolve: async () => [] }), /smtp-address-not-public/);
    await assert.rejects(smtp.sendSmtp(C.smtp(), 'x', { ...MSG_ENVIO }, { resolve: async () => [{ address: '8.8.8.8' }, { address: '10.0.0.1' }] }), /smtp-address-not-public/);
  });

  console.log('SMTP: envio real contra servidor falso local');
  await smtpReal(smtp);

  console.log('Gate e regras da API');
  await gate();
  await regras(base, erro);

  console.log('Mutantes refutados');
  await mutantes(erro, cr, sm, smtp);

  console.log('Arquivos pequenos (um assunto por arquivo)');
  await passo('cada arquivo novo de e-mails tem menos de 300 linhas', () => {
    for (const rel of [...fs.readdirSync(path.join(RAIZ, FEATURE)).map(f), DOM, 'src/gestao-fadas/gate/rotas-email.js', 'src/gestao-fadas/features/formas/formas.service.js']) assert.ok(fs.readFileSync(path.join(RAIZ, rel), 'utf8').split('\n').length < 300, rel);
  });
}

async function smtpReal(smtp) {
  const comAuth = async (opcoes, conexao, senha = 'senha-ficticia') => {
    const s = await criarServidor(opcoes);
    try { return { s, r: await smtp.sendSmtp(conexao, senha, { ...MSG_ENVIO, sender: { senderName: 'Fadas ç', from: 'envio@example.org', replyTo: 'resp@example.org' } }, s.ganchos()).then(() => ({ ok: true }), (e) => ({ erro: e.message })) , lido: { recebidos: [...s.recebidos], comandos: [...s.comandos] } }; } finally { await s.fechar(); }
  };
  await passo('STARTTLS (587): negocia TLS, autentica com PLAIN, entrega a mensagem completa e só depois da sessão segura', async () => {
    const { r, lido } = await comAuth({ modo: 'starttls' }, C.smtp());
    assert.deepStrictEqual(r, { ok: true }); assert.strictEqual(lido.recebidos.length, 1);
    const m = lido.recebidos[0];
    assert.deepStrictEqual(m.auth, { usuario: 'envio', senha: 'senha-ficticia' }); assert.strictEqual(m.seguro, true);
    assert.match(m.mailFrom, /FROM:<envio@example\.org>/i); assert.match(m.rcpt, /TO:<a@example\.org>/i);
    assert.match(m.dados, /Content-Transfer-Encoding: base64/); assert.match(m.dados, /Reply-To: <resp@example\.org>/);
    assert.ok(lido.comandos.indexOf('STARTTLS') >= 0 && lido.comandos.indexOf('STARTTLS') < lido.comandos.indexOf('AUTH'), lido.comandos.join(','));
    assert.strictEqual(lido.comandos.filter((c) => c === 'EHLO').length, 2);
    const corpo = Buffer.from(m.dados.split('\n\n')[1].replace(/\s+/g, ''), 'base64').toString('utf8'); assert.strictEqual(corpo, 'corpo');
  });
  await passo('TLS implícito (465): entrega com AUTH LOGIN quando o servidor só oferece LOGIN', async () => {
    const { r, lido } = await comAuth({ modo: 'tls', authLogin: true }, C.smtp({ port: 465, security: 'tls' }));
    assert.deepStrictEqual(r, { ok: true }); assert.deepStrictEqual(lido.recebidos[0].auth, { usuario: 'envio', senha: 'senha-ficticia' });
  });
  await passo('servidor sem STARTTLS: recusa e NUNCA envia a senha', async () => {
    const { r, lido } = await comAuth({ modo: 'starttls', semStarttls: true }, C.smtp());
    assert.deepStrictEqual(r, { erro: 'smtp-delivery-failed' }); assert.ok(!lido.comandos.includes('AUTH') && lido.recebidos.length === 0, lido.comandos.join(','));
  });
  await passo('certificado que não confere com o servidor: recusa antes de qualquer credencial (verificação obrigatória)', async () => {
    for (const modo of ['starttls', 'tls']) {
      const { r, lido } = await comAuth({ modo, certificadoErrado: true }, modo === 'tls' ? C.smtp({ port: 465, security: 'tls' }) : C.smtp());
      assert.deepStrictEqual(r, { erro: 'smtp-delivery-failed' }, modo); assert.ok(!lido.comandos.includes('AUTH') && lido.recebidos.length === 0, `${modo} ${lido.comandos}`);
    }
  });
  await passo('autoridade desconhecida (sem a CA de teste) também é recusada', async () => {
    const s = await criarServidor({ modo: 'tls' });
    try {
      const r = await smtp.sendSmtp(C.smtp({ port: 465, security: 'tls' }), 'senha-ficticia', MSG_ENVIO, { ...s.ganchos(), secureConnect: (o) => require('tls').connect({ ...o, host: '127.0.0.1', port: s.porta }) }).then(() => 'enviou', (e) => e.message);
      assert.strictEqual(r, 'smtp-delivery-failed'); assert.strictEqual(s.recebidos.length, 0);
    } finally { await s.fechar(); }
  });
  await passo('senha errada, servidor sem AUTH e queda de conexão falham com o mesmo erro, sem repetir o texto do servidor', async () => {
    assert.deepStrictEqual((await comAuth({ modo: 'starttls' }, C.smtp(), 'errada')).r, { erro: 'smtp-delivery-failed' });
    assert.deepStrictEqual((await comAuth({ modo: 'starttls', semAuth: true }, C.smtp())).r, { erro: 'smtp-delivery-failed' });
    const r = await smtp.sendSmtp(C.smtp(), 'senha-ficticia', MSG_ENVIO, { resolve: async () => [{ address: '8.8.8.8' }], connect: () => require('net').connect({ host: '127.0.0.1', port: 1 }) }).then(() => 'enviou', (e) => e.message);
    assert.strictEqual(r, 'smtp-delivery-failed');
  });
  await passo('sem os ganchos, host que resolve para rede privada nunca abre conexão (DNS real de mentira)', async () => {
    const dns = require('dns'); const orig = dns.promises.lookup; let tentou = false; const net = require('net'); const conectar = net.connect;
    dns.promises.lookup = async () => [{ address: '127.0.0.1', family: 4 }]; net.connect = () => { tentou = true; throw new Error('abriu'); };
    try { await assert.rejects(smtp.sendSmtp(C.smtp(), 'senha-ficticia', MSG_ENVIO), /smtp-address-not-public/); assert.strictEqual(tentou, false); } finally { dns.promises.lookup = orig; net.connect = conectar; }
  });
  await passo('Resend: endereço fixo, chave só no cabeçalho, idempotência, sem seguir redirecionamento; erro vira delivery-failed', async () => {
    const { criarEnvio, RESEND_URL } = modulo(f('email.envio.js')); let chamada;
    const envio = criarEnvio({ transporte: async (url, init) => { chamada = { url, init }; return { ok: true }; } });
    await envio({ transport: 'resend' }, 'chave-ficticia', { id: 'idem', to: 'a@example.org', subject: 'Convite', text: 'texto', sender: { senderName: 'Fa"das\\', from: 'from@example.org', replyTo: 'reply@example.org' } });
    assert.strictEqual(chamada.url, RESEND_URL); assert.strictEqual(RESEND_URL, 'https://api.resend.com/emails');
    assert.strictEqual(chamada.init.headers.Authorization, 'Bearer chave-ficticia'); assert.strictEqual(chamada.init.headers['Idempotency-Key'], 'idem'); assert.strictEqual(chamada.init.redirect, 'error');
    const corpo = JSON.parse(chamada.init.body); assert.strictEqual(corpo.from, '"Fadas" <from@example.org>'); assert.deepStrictEqual(corpo.to, ['a@example.org']); assert.strictEqual(corpo.reply_to, 'reply@example.org'); assert.ok(!chamada.init.body.includes('chave-ficticia'));
    await assert.rejects(criarEnvio({ transporte: async () => ({ ok: false }) })({ transport: 'resend' }, 'k', { id: 'i', to: 'a@example.org', subject: 's', text: 't', sender: C.remetente }), /delivery-failed/);
  });
}

async function chamarGate(app, metodo, recurso, { corpo, origem = 'https://fadas.example.org', tipo = 'application/json' } = {}) {
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r));
  try {
    const resp = await fetch(`http://127.0.0.1:${srv.address().port}/api/email?resource=${recurso}`, { method: metodo, headers: { ...(corpo !== undefined ? { 'content-type': tipo } : {}), ...(origem && metodo !== 'GET' ? { origin: origem } : {}) }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await resp.text(); let j = null; try { j = JSON.parse(t); } catch (_) { /* texto */ }
    return { status: resp.status, j, h: resp.headers };
  } finally { srv.close(); }
}

async function gate() {
  const salvo = { ...process.env };
  Object.assign(process.env, { FADAS_ORIGIN: 'https://fadas.example.org', GF_NOVOS_DADOS: 'postgres', GF_EMAIL_CHAVE_SEGREDO: C.MESTRA, GF_FATIA_CONTAS: 'true', GF_FATIA_EMAIL: 'true' });
  delete process.env.GF_EMAIL_ENVIO_ENABLED;
  const { criarRotasEmail } = require(path.join(RAIZ, 'src/gestao-fadas/gate/rotas-email'));
  let sessao = null;
  const provedor = { validar: async () => (sessao ? { status: 'identity', identity: sessao, sessionId: 's' } : { status: 'absent' }) };
  const app = express(); app.use('/api', criarRotasEmail(provedor)); app.use((req, res) => res.status(404).json({ doFront: true }));
  try {
    await passo('fatia desligada passa adiante (responde a rota do front)', async () => { process.env.GF_FATIA_EMAIL = 'false'; const x = await chamarGate(app, 'GET', 'availability'); assert.strictEqual(x.status, 404); assert.strictEqual(x.j.doFront, true); process.env.GF_FATIA_EMAIL = 'true'; });
    await passo('availability é público e diz que há convites; erro sempre em TEXTO; sem sessão os demais pedem entrada (401)', async () => {
      const a = await chamarGate(app, 'GET', 'availability'); assert.strictEqual(a.status, 200); assert.deepStrictEqual(a.j, { enabled: true, invitations: true });
      const s = await chamarGate(app, 'GET', 'settings'); assert.strictEqual(s.status, 401); assert.strictEqual(typeof s.j.error, 'string');
      const m = await chamarGate(app, 'DELETE', 'settings'); assert.strictEqual(m.status, 405); assert.match(m.h.get('allow'), /GET/);
    });
    await passo('sem a chave de proteção, availability diz enabled=false e nada é configurado', async () => { delete process.env.GF_EMAIL_CHAVE_SEGREDO; const a = await chamarGate(app, 'GET', 'availability'); assert.strictEqual(a.j.enabled, false); const r = await chamarGate(app, 'POST', 'recovery', { corpo: { email: 'a@example.org' } }); assert.strictEqual(r.status, 503); process.env.GF_EMAIL_CHAVE_SEGREDO = C.MESTRA; });
    await passo('gravação exige a Origem do front e JSON (também nos recursos públicos)', async () => {
      assert.strictEqual((await chamarGate(app, 'POST', 'recovery', { corpo: { email: 'a@example.org' }, origem: 'https://evil.example' })).status, 403);
      assert.strictEqual((await chamarGate(app, 'POST', 'recovery', { corpo: { email: 'a@example.org' }, origem: null })).status, 403);
      assert.strictEqual((await chamarGate(app, 'POST', 'recovery', { corpo: { email: 'a@example.org' }, tipo: 'text/plain' })).status, 415);
    });
    await passo('envio DESLIGADO por padrão: recuperação, teste e convite respondem 503 sem tocar banco, convite ou provedor', async () => {
      const r = await chamarGate(app, 'POST', 'recovery', { corpo: { email: 'a@example.org' } }); assert.strictEqual(r.status, 503); assert.match(r.j.error, /desligado/);
      sessao = { userId: 'u1', role: 'administradora', displayName: 'Adm' };
      for (const [rec, corpo] of [['test', { purpose: 'usuarios', to: 'a@example.org' }], ['invitation', { accountId: 'x' }]]) { const x = await chamarGate(app, 'POST', rec, { corpo }); assert.strictEqual(x.status, 503, rec); assert.match(x.j.error, /desligado/); }
      sessao = null;
    });
    await passo('só a administradora configura (403 em texto para atendente) e falha de banco não vaza detalhe', async () => {
      sessao = { userId: 'u2', role: 'atendente', displayName: 'At' }; const a = await chamarGate(app, 'GET', 'settings'); assert.strictEqual(a.status, 403); assert.match(a.j.error, /administrativo/);
      sessao = { userId: 'u1', role: 'administradora', displayName: 'Adm' }; const b = await chamarGate(app, 'GET', 'settings'); assert.ok([503].includes(b.status), `${b.status}`); assert.ok(!/sequelize|ECONN|password|SELECT/i.test(JSON.stringify(b.j)), JSON.stringify(b.j)); sessao = null;
    });
  } finally { process.env = salvo; }
}

async function regras(base, erro) {
  await passo('com o envio desligado nada é enviado, auditado nem consultado (503 antes de qualquer efeito)', async () => {
    const { servico } = await servicoDe();
    const r = await rodarPedidos({ servico, EmailErro: erro, envioLigado: false });
    assert.strictEqual(r.enviados.length, 0); assert.strictEqual(r.repo.eventos.length, 0);
    for (const p of r.saida.filter((x) => ['test', 'invitation', 'recovery'].includes(x.resource) && x.method === 'POST')) assert.strictEqual(p.saida.status, 503, `${p.resource}: ${JSON.stringify(p.saida)}`);
    assert.deepStrictEqual(r.saida.filter((x) => x.resource === 'history' && x.method === 'GET' && x.actor === 'admin').map((x) => x.saida.corpo), [{ events: [] }]);
  });
  await passo('configuração e histórico seguem funcionando com o envio desligado (configurar não é enviar)', async () => {
    const { servico } = await servicoDe();
    const r = await rodarPedidos({ servico, EmailErro: erro, envioLigado: false });
    assert.strictEqual(r.saida.find((p) => p.resource === 'settings' && p.method === 'PUT' && p.saida.status === 200).saida.status, 200);
  });
  await passo('o convite por e-mail usa SEMPRE a finalidade "usuarios", mesmo que o pedido traga outra', async () => {
    const { servico } = await servicoDe(); const enviados = []; const repo = C.repoFalso();
    const deps = { repo, enviar: C.envioFalso(enviados), convites: C.convitesFalsos(erro), env: { armazenamento: true, chave: C.MESTRA, chaveOk: true, envioLigado: true, origem: C.ORIGEM }, agora: () => C.AGORA, uuid: () => 'id-1' };
    const adm = { id: 'admin', role: 'administradora' };
    await servico.tratar(deps, { recurso: 'settings', metodo: 'PUT', corpo: { settings: C.base(), secrets: { one: 'segredo-ficticio' } }, ator: adm });
    const r = await servico.tratar(deps, { recurso: 'invitation', metodo: 'POST', corpo: { accountId: 'usr1', purpose: 'financeiro' }, ator: adm });
    assert.strictEqual(r.status, 200); assert.strictEqual(enviados[0].message.sender.from, 'acessos@example.org'); assert.strictEqual(repo.eventos[0].purpose, 'usuarios');
    assert.match(enviados[0].message.text, /#convite=a{64}/); assert.match(enviados[0].message.text, /48 horas/); assert.ok(!JSON.stringify(r.corpo).includes('a'.repeat(64)), 'o token não volta na resposta');
  });
  await passo('origem pública sem https, com credencial, consulta ou fragmento: convite recusado (503) sem emitir', async () => {
    const { servico } = await servicoDe();
    for (const origem of ['', 'http://fadas.example.org', 'https://u:p@fadas.example.org', 'https://fadas.example.org/?x=1', 'https://fadas.example.org/#y', 'lixo']) {
      const enviados = []; let emitiu = false; const convites = { ...C.convitesFalsos(erro), issue: async () => { emitiu = true; throw new Error('x'); } };
      const deps = { repo: C.repoFalso(), enviar: C.envioFalso(enviados), convites, env: { armazenamento: true, chave: C.MESTRA, chaveOk: true, envioLigado: true, origem }, agora: () => C.AGORA, uuid: () => 'id-1' };
      const adm = { id: 'admin', role: 'administradora' };
      await servico.tratar(deps, { recurso: 'settings', metodo: 'PUT', corpo: { settings: C.base(), secrets: { one: 'k' } }, ator: adm });
      const r = await servico.tratar(deps, { recurso: 'invitation', metodo: 'POST', corpo: { accountId: 'usr1' }, ator: adm });
      assert.strictEqual(r.status, 503, origem); assert.strictEqual(emitiu, false); assert.strictEqual(enviados.length, 0);
    }
  });
  await passo('SQL do banco novo só usa INSERT/UPDATE/SELECT em gf_* (mesma allowlist da escrita)', () => {
    const { motivoDeRecusa } = modulo('src/gestao-fadas/novo/traducao-sql.js');
    const fonte = fs.readFileSync(path.join(RAIZ, f('email.store.js')), 'utf8') + fs.readFileSync(path.join(RAIZ, 'src/gestao-fadas/features/formas/formas.store.js'), 'utf8');
    const sqls = [...fonte.matchAll(/'((?:INSERT|UPDATE)[^']+)'/g)].map((m) => m[1]);
    assert.ok(sqls.length >= 5, String(sqls.length)); for (const s of sqls) assert.strictEqual(motivoDeRecusa(s), null, s);
    assert.ok(!/DELETE\s+FROM/i.test(fonte));
  });
}

async function mutantes(erro, cr, sm, smtp) {
  const refutaDominio = (de, para, nome) => passo(`mutante refutado (domínio): ${nome}`, () => assert.ok(divergenciasDoDominio(carregarMutante(DOM, de, para)).length > 0));
  await refutaDominio("/\\.(localhost|local|internal)$/i.test(c.host) ||", 'false ||', 'aceita host .local/.internal/localhost');
  await refutaDominio("(c.port === 465 && c.security === 'tls') ||", 'false ||', 'recusa 465/TLS');
  await refutaDominio("(c.port === 587 && c.security === 'starttls')", 'true', 'aceita qualquer porta com STARTTLS');
  await refutaDominio("from: c.from.trim().toLowerCase()", 'from: c.from.trim()', 'não normaliza o remetente');
  await refutaDominio('|| s.connections.length > 20', '', 'sem limite de conexões');
  await refutaDominio("|| !ids.has(n.connectionId)", '', 'finalidade com conexão inexistente');
  await refutaDominio("!semQuebra(c.username)", 'false', 'usuário com quebra de linha');
  await refutaDominio("[c.senderName, c.from, c.replyTo, c.connectionId].some((v) => typeof v !== 'string' || !semQuebra(v))", "[c.senderName, c.from, c.replyTo, c.connectionId].some((v) => typeof v !== 'string')", 'remetente com quebra de linha (injeção de cabeçalho)');
  const refutaServico = (rel, de, para, nome) => passo(`mutante refutado (serviço): ${nome}`, async () => {
    const svc = carregarMutante(f(rel), de, para);
    const base = rel === 'email.service.js' ? { servico: svc } : { servico: carregarMutante(f('email.service.js'), null) };
    if (rel !== 'email.service.js') {
      // O mutante de email.config.js precisa ser enxergado pelo serviço: troca no cache só durante esta prova.
      const arq = path.join(RAIZ, f('email.config.js')); const antes = require.cache[arq];
      require.cache[arq] = { id: arq, filename: arq, loaded: true, exports: svc };
      try { const s2 = carregarMutante(f('email.service.js'), null); const r = await rodarPedidos({ servico: s2, EmailErro: erro }); assert.ok(divergenciasDoServico(r.saida).length > 0); } finally { if (antes) require.cache[arq] = antes; else delete require.cache[arq]; }
      return;
    }
    const r = await rodarPedidos({ servico: base.servico, EmailErro: erro }); assert.ok(divergenciasDoServico(r.saida).length > 0);
  });
  await refutaServico('email.service.js', "ator.role !== 'administradora'", 'false', 'qualquer pessoa configura');
  await refutaServico('email.service.js', "recurso === 'invitation' ? 'usuarios' : corpo.purpose", 'corpo.purpose', 'convite sem a finalidade "usuarios"');
  await refutaServico('email.service.js', "recibo = { id, status: 'failed', at, error: MSG.falhou }", "recibo = { id, status: 'failed', at, error: String(arguments.length) + MSG.falhou }", 'texto do recibo muda');
  await refutaServico('email.service.js', "status: recibo.status === 'failed' ? 502 : 200", 'status: 200', 'falha de envio anunciada como 200');
  await refutaServico('email.service.js', "corpo: { status: 'accepted' } };\n}", "corpo: { status: 'accepted', conta: true } };\n}", 'recuperação revela algo');
  await refutaServico('email.service.js', "if (!(await d.repo.save(novo, novo.settings.revision - 1,", "if (!(await d.repo.save(novo, 0,", 'gravação ignora a revisão');
  await refutaServico('email.service.js', "emitido = await d.convites.issue(corpo.accountId, ator.id, d.agora());\n    ({ subject: assunto, text: texto } = textoDoConvite(emitido, origem));", "emitido = await d.convites.issue(corpo.accountId, ator.id, d.agora());\n    ({ subject: assunto, text: texto } = textoDoConvite(emitido, origem));\n    texto += '\\n' + (await d.repo.read()).secrets.one;", 'texto do e-mail leva o segredo');
  await refutaServico('email.config.js', 'const mesmaConexao = (a, b) => Boolean(a) && a.transport === b.transport && a.host === b.host && a.username === b.username;', 'const mesmaConexao = (a) => Boolean(a);', 'reaproveita o segredo ao trocar servidor/usuário');
  await refutaServico('email.config.js', "|| /[\\r\\n\\0]/.test(v))) throw entrada(MSG_CREDENCIAIS)", "|| false)) throw entrada(MSG_CREDENCIAIS)", 'segredo com quebra de linha');
  const refutaMensagem = (de, para, nome) => passo(`mutante refutado (SMTP): ${nome}`, async () => {
    const m = carregarMutante(f('email.smtp.mensagem.js'), de, para); const falha = [];
    ouro.mensagens.forEach((x, i) => { if (!igual(tentar(() => m.smtpMessage(x.m)), x.esperado)) falha.push(i); });
    for (const x of ouro.enderecos) if (m.publicAddress(x.address) !== (x.esperado.abriu === true)) falha.push(x.address);
    assert.ok(falha.length > 0);
  });
  await refutaMensagem('p[0] === 10 ||', 'false ||', 'aceita rede 10/8');
  await refutaMensagem('p[0] === 127 ||', 'false ||', 'aceita loopback');
  await refutaMensagem('(p[0] === 172 && p[1] >= 16 && p[1] <= 31)', 'false', 'aceita 172.16/12');
  await refutaMensagem('p[0] >= 224', 'p[0] > 224', 'aceita multicast 224');
  await refutaMensagem('(p[0] === 169 && p[1] === 254)', 'false', 'aceita link-local');
  await refutaMensagem('(p[0] === 100 && p[1] >= 64 && p[1] <= 127)', 'false', 'aceita CGNAT');
  await refutaMensagem('primeiro !== 0x2002', 'true', 'aceita 6to4');
  await refutaMensagem('primeiro >= 0x2000 &&', 'primeiro >= 0x1000 &&', 'aceita fora de 2000::/3');
  await refutaMensagem('segundo === 0xdb8', 'false', 'aceita documentação 2001:db8');
  await refutaMensagem('/[\\r\\n\\0]/.test(v))', 'false)', 'cabeçalho com quebra de linha');
  await refutaMensagem('message.text.length <= 100000', 'true', 'sem limite de texto');
  const refutaSmtp = (de, para, nome, prova) => passo(`mutante refutado (SMTP real): ${nome}`, async () => {
    const m = carregarMutante(f('email.smtp.js'), de, para); const s = await criarServidor(prova.servidor);
    try { const r = await m.sendSmtp(prova.conexao || C.smtp(), 'senha-ficticia', MSG_ENVIO, s.ganchos()).then(() => 'enviou', (e) => e.message); assert.ok(prova.quebra(r, s), `não percebeu: ${r} ${s.comandos}`); } finally { await s.fechar(); }
  });
  await refutaSmtp("if (!recursos.some((s) => /STARTTLS/i.test(s))) throw new Error('smtp-tls-required');", '', 'aceita servidor sem STARTTLS', { servidor: { modo: 'starttls', semStarttls: true }, quebra: (r, s) => s.comandos.includes('AUTH') });
  // O certificado tem duas travas (o handshake e `socket.authorized`): cada uma sozinha basta, então o mutante tira as duas.
  await refutaSmtp([["if (!socket.authorized) throw new Error('smtp-certificate-invalid');", ''], ['rejectUnauthorized: true', 'rejectUnauthorized: false']], undefined, 'não verifica o certificado (STARTTLS)', { servidor: { modo: 'starttls', certificadoErrado: true }, quebra: (r, s) => s.comandos.includes('AUTH') || r === 'enviou' });
  await refutaSmtp([["if (!socket.authorized) throw new Error('smtp-certificate-invalid');", ''], ['rejectUnauthorized: true', 'rejectUnauthorized: false']], undefined, 'não verifica o certificado (TLS implícito)', { servidor: { modo: 'tls', certificadoErrado: true }, conexao: C.smtp({ port: 465, security: 'tls' }), quebra: (r, s) => s.comandos.includes('AUTH') || r === 'enviou' });
  await passo('cada trava do certificado, sozinha, já basta (tirar só uma não deixa passar certificado errado)', async () => {
    for (const par of [["if (!socket.authorized) throw new Error('smtp-certificate-invalid');", ''], ['rejectUnauthorized: true', 'rejectUnauthorized: false']]) {
      const m = carregarMutante(f('email.smtp.js'), ...par); const s = await criarServidor({ modo: 'starttls', certificadoErrado: true });
      try { assert.strictEqual(await m.sendSmtp(C.smtp(), 'senha-ficticia', MSG_ENVIO, s.ganchos()).then(() => 'enviou', (e) => e.message), 'smtp-delivery-failed'); assert.ok(!s.comandos.includes('AUTH')); } finally { await s.fechar(); }
    }
  });
  await passo('mutante refutado (cripto): sem dado associado a conexão, o texto de outra conexão abriria', () => {
    const m = carregarMutante(f('email.cripto.js'), 'c.setAAD(Buffer.from(id, \'utf8\'));', ''); const c = m.cifrarSegredo('x', C.MESTRA, 'a');
    assert.strictEqual(cr.chaveConfigurada(C.MESTRA), true); assert.throws(() => cr.decifrarSegredo(c, C.MESTRA, 'a'), undefined, 'o texto do mutante não deveria abrir na API');
  });
  await passo('mutante refutado (cripto): IV fixo repete o texto cifrado', () => {
    const m = carregarMutante(f('email.cripto.js'), 'const iv = randomBytes(12);', 'const iv = Buffer.alloc(12);');
    assert.strictEqual(m.cifrarSegredo('x', C.MESTRA, 'a'), m.cifrarSegredo('x', C.MESTRA, 'a')); assert.notStrictEqual(cr.cifrarSegredo('x', C.MESTRA, 'a'), cr.cifrarSegredo('x', C.MESTRA, 'a'));
  });
}

async function comBanco() {
  const banco = pg.nomeBanco('email');
  let codigo = 1;
  try {
    pg.criar(banco);
    const extra = { LEGADO_DB_HOST: '', LEGADO_DB_NAME: '', LEGADO_DB_USER: '' };
    const mig = pg.rodarNode(banco, [path.join('scripts', 'run-migrations.js')], extra);
    if (mig.status !== 0) throw new Error(`migração falhou:\n${mig.stderr || mig.stdout}`);
    console.log(`Banco ${banco} criado e migrado.`);
    const r = pg.rodarNode(banco, [path.join('scripts', 'apoio-gf-email', 'filho.js')], extra);
    process.stdout.write(r.stdout); if (r.status !== 0) process.stderr.write(r.stderr);
    codigo = r.status;
  } catch (e) { console.error(e.message || e); codigo = 2; } finally {
    pg.apagar(banco);
    const restantes = execFileSync(`${pg.PSQL_BIN || '/opt/homebrew/bin'}/psql`, ['-h', 'localhost', '-p', '5432', '-d', 'postgres', '-Atc', "SELECT datname FROM pg_database WHERE datname LIKE 'fdb_email_%'"], { encoding: 'utf8' }).trim();
    console.log(restantes ? `ATENÇÃO: sobrou banco: ${restantes}` : 'Banco descartável apagado (nenhum fdb_email_* restante).');
  }
  return codigo;
}

(async () => {
  await offline();
  console.log(`\nOffline: ${ok} ok, ${falhas.length} falhas`);
  if (falhas.length) process.exit(1);
  if (process.argv.includes('--offline')) process.exit(0);
  process.exit(await comBanco());
})().catch((e) => { console.error(e); process.exit(2); });
