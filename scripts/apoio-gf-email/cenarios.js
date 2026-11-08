'use strict';

/**
 * Cenários do ouro de e-mails (v711). Dados 100% fictícios (domínio example.org, chave mestra de sete, segredos de mentira).
 * O gerador roda o CÓDIGO REAL do front (handleEmail, validateEmailSettings, prepareEmailSettings, smtpMessage, sendSmtp, criptografia) e guarda entrada + saída;
 * o verificador repete as mesmas entradas na API. Aqui só as entradas.
 */

const MESTRA = Buffer.alloc(32, 7).toString('base64');
const ORIGEM = 'https://fadas.example.org';
const AGORA = Date.parse('2026-11-08T18:00:00Z');
const TOKEN = 'a'.repeat(64);

const base = () => ({
  revision: 0,
  connections: [{ id: 'one', label: 'Conta oficial', transport: 'resend', hasSecret: false }],
  purposes: {
    financeiro: { senderName: 'Financeiro', from: 'financeiro@example.org', replyTo: '', connectionId: 'one' },
    usuarios: { senderName: 'Fadas do Bem', from: 'acessos@example.org', replyTo: 'admin@example.org', connectionId: 'one' },
    marketing: { senderName: '', from: '', replyTo: '', connectionId: '' },
    institucional: { senderName: '', from: '', replyTo: '', connectionId: '' },
  },
});
const com = (f) => { const s = base(); f(s); return s; };
const smtp = (extra = {}) => ({ id: 'one', label: 'SMTP', transport: 'smtp', host: 'smtp.example.org', port: 587, security: 'starttls', username: 'envio', hasSecret: false, ...extra });

/** Configurações para `validateEmailSettings` (cada uma isolada). */
const CONFIGURACOES = [
  ['padrão', base()], ['vazia', { revision: 0, connections: [], purposes: Object.fromEntries(['financeiro', 'usuarios', 'marketing', 'institucional'].map((p) => [p, { senderName: '', from: '', replyTo: '', connectionId: '' }])) }],
  ['smtp 587', com((s) => { s.connections = [smtp()]; })], ['smtp 465', com((s) => { s.connections = [smtp({ port: 465, security: 'tls' })]; })],
  ['smtp 587 tls', com((s) => { s.connections = [smtp({ security: 'tls' })]; })], ['smtp 465 starttls', com((s) => { s.connections = [smtp({ port: 465 })]; })],
  ['smtp 25', com((s) => { s.connections = [smtp({ port: 25, security: 'none' })]; })], ['host localhost', com((s) => { s.connections = [smtp({ host: 'localhost' })]; })],
  ['host .local', com((s) => { s.connections = [smtp({ host: 'mail.local' })]; })], ['host .internal', com((s) => { s.connections = [smtp({ host: 'smtp.internal' })]; })],
  ['host maiúsculo', com((s) => { s.connections = [smtp({ host: 'SMTP.Example.ORG' })]; })], ['host ip', com((s) => { s.connections = [smtp({ host: '10.0.0.1' })]; })],
  ['host com espaço', com((s) => { s.connections = [smtp({ host: 'smtp example.org' })]; })], ['usuário vazio', com((s) => { s.connections = [smtp({ username: ' ' })]; })],
  ['usuário com quebra', com((s) => { s.connections = [smtp({ username: 'a\nb' })]; })], ['rótulo vazio', com((s) => { s.connections[0].label = ' '; })],
  ['rótulo longo', com((s) => { s.connections[0].label = 'x'.repeat(101); })], ['rótulo com quebra', com((s) => { s.connections[0].label = 'a\r\nb'; })],
  ['id inválido', com((s) => { s.connections[0].id = 'a b'; })], ['id proto', com((s) => { s.connections[0].id = '__proto__'; })],
  ['id repetido', com((s) => { s.connections.push({ ...s.connections[0] }); })], ['21 conexões', com((s) => { s.connections = Array.from({ length: 21 }, (_, i) => ({ id: `c${i}`, label: 'x', transport: 'resend', hasSecret: false })); })],
  ['transporte desconhecido', com((s) => { s.connections[0].transport = 'sendgrid'; })], ['revisão negativa', com((s) => { s.revision = -1; })], ['revisão fracionária', com((s) => { s.revision = 1.5; })],
  ['sem finalidades', { revision: 0, connections: [] }], ['sem conexões', { revision: 0, purposes: base().purposes }], ['nulo', null], ['texto', 'x'],
  ['from com quebra', com((s) => { s.purposes.usuarios.from = 'a@example.org\r\nBcc:b@example.org'; })], ['from com vírgula', com((s) => { s.purposes.usuarios.from = 'a@example.org,b@example.org'; })],
  ['from maiúsculo', com((s) => { s.purposes.usuarios.from = 'ACESSOS@Example.ORG'; })], ['replyTo inválido', com((s) => { s.purposes.usuarios.replyTo = 'nao-e-email'; })],
  ['remetente sem nome', com((s) => { s.purposes.usuarios.senderName = ' '; })], ['nome longo', com((s) => { s.purposes.usuarios.senderName = 'n'.repeat(121); })],
  ['conexão inexistente', com((s) => { s.purposes.usuarios.connectionId = 'zzz'; })], ['finalidade parcial', com((s) => { s.purposes.marketing = { senderName: 'M', from: '', replyTo: '', connectionId: '' }; })],
  ['finalidade ausente', com((s) => { delete s.purposes.marketing; })], ['campo não texto', com((s) => { s.purposes.usuarios.from = 7; })],
];

const CAIXAS = ['a@example.org', 'A.B+c@sub.example.org', 'a@b.c', 'a@b.co', 'a b@example.org', 'a@@example.org', '@example.org', 'a@example', 'a@-example.org', 'a@example-.org', `${'a'.repeat(250)}@example.org`, '', null, 7, "o'brien@example.org", 'a..b@example.org', 'a@example.org\n', 'a@exa mple.org'];
const IDS = ['one', 'a_b-C9', '', 'a b', '__proto__', 'constructor', 'prototype', 'x'.repeat(80), 'x'.repeat(81), null, 7, 'á'];

/** Pedidos do serviço: sequência COM ESTADO (repositório vazio no início). `actor`: admin | staff | nenhum. */
const P = (resource, method, body, actor = 'admin') => ({ resource, method, body, actor });
const PEDIDOS = [
  P('availability', 'GET'), P('settings', 'GET', undefined, null), P('settings', 'GET', undefined, 'staff'), P('settings', 'GET'),
  P('settings', 'PUT', { settings: base() }), P('settings', 'PUT', { settings: base(), secrets: { one: 'x'.repeat(4097) } }), P('settings', 'PUT', { settings: base(), secrets: { one: 'a\nb' } }),
  P('settings', 'PUT', { settings: base(), secrets: { zzz: 'segredo' } }), P('settings', 'PUT', { settings: base(), secrets: [] }), P('settings', 'PUT', { settings: base(), secrets: { one: 7 } }),
  P('settings', 'PUT', { settings: com((s) => { s.purposes.usuarios.from = 'x'; }), secrets: { one: 'segredo-ficticio' } }), P('settings', 'PUT', [1]), P('settings', 'PUT', undefined),
  P('settings', 'PUT', { settings: com((s) => { s.revision = 3; }), secrets: { one: 'segredo-ficticio' } }),
  P('settings', 'PUT', { settings: base(), secrets: { one: 'segredo-ficticio' } }), P('settings', 'GET'),
  P('settings', 'PUT', { settings: base() }), // revisão antiga
  P('settings', 'PUT', { settings: com((s) => { s.revision = 1; }) }), // reaproveita o segredo
  P('settings', 'PUT', { settings: com((s) => { s.revision = 2; s.connections = [smtp()]; }) }), // troca para SMTP sem segredo novo
  P('settings', 'PUT', { settings: com((s) => { s.revision = 2; s.connections = [smtp()]; }), secrets: { one: 'senha-ficticia' } }),
  P('settings', 'PUT', { settings: com((s) => { s.revision = 3; s.connections = [smtp({ host: 'outro.example.org' })]; }) }),
  P('settings', 'PUT', { settings: com((s) => { s.revision = 3; s.connections = [smtp({ username: 'outro' })]; }) }),
  P('settings', 'PUT', { settings: com((s) => { s.revision = 3; s.connections = [smtp({ label: 'Novo nome' })]; }) }),
  P('settings', 'GET'),
  P('test', 'POST', { purpose: 'financeiro', to: 'laya@example.org' }), P('test', 'POST', { purpose: 'marketing', to: 'laya@example.org' }), P('test', 'POST', { purpose: 'zzz', to: 'laya@example.org' }),
  P('test', 'POST', { purpose: 'usuarios', to: 'ruim' }), P('test', 'POST', { purpose: 'usuarios', to: 'laya@example.org' }), P('test', 'POST', { purpose: 'usuarios', to: 'FALHA@example.org' }),
  P('test', 'POST', { purpose: 'usuarios', to: 'laya@example.org' }, 'staff'), P('test', 'POST', { purpose: 'usuarios', to: 'laya@example.org' }, null), P('test', 'GET', undefined),
  P('invitation', 'POST', { accountId: 'usr1' }), P('invitation', 'POST', { accountId: 'a b' }), P('invitation', 'POST', {}), P('invitation', 'POST', { accountId: 'cooldown' }), P('invitation', 'POST', { accountId: 'falha' }),
  P('invitation', 'POST', { accountId: 'usr1' }, 'staff'),
  P('recovery', 'POST', { email: 'person@example.org' }, null), P('recovery', 'POST', { email: 'ninguem@example.org' }, null), P('recovery', 'POST', { email: 'cooldown@example.org' }, null),
  P('recovery', 'POST', { email: 'ruim' }, null), P('recovery', 'POST', {}, null), P('recovery', 'POST', [], null),
  P('inspect', 'POST', { token: TOKEN }, null), P('inspect', 'POST', {}, null), P('accept', 'POST', { token: TOKEN, password: 'SenhaLongaSegura123!' }, null), P('accept', 'POST', { token: 'x' }, null),
  P('history', 'GET'), P('history', 'GET', undefined, 'staff'), P('history', 'POST', {}), P('zzz', 'GET'), P('settings', 'DELETE'),
];

/** Mensagens SMTP para `smtpMessage`. */
const remetente = { senderName: 'Fadas', from: 'from@example.org', replyTo: '' };
const MENSAGENS = [
  { to: 'a@example.org', subject: 'Olá', text: '.line\ntexto', sender: remetente }, { to: 'a@example.org', subject: 'Ação ✓', text: 'x'.repeat(200), sender: { ...remetente, replyTo: 'r@example.org' } },
  { to: 'a@example.org', subject: 'ok\r\nBcc: evil@example.org', text: 't', sender: remetente }, { to: 'a@example.org', subject: 's', text: 't', sender: { ...remetente, senderName: 'a\nb' } },
  { to: 'a@example.org,b@example.org', subject: 's', text: 't', sender: remetente }, { to: 'a@example.org', subject: 's', text: 't', sender: { ...remetente, from: 'x' } },
  { to: 'a@example.org', subject: 's', text: 't', sender: { ...remetente, replyTo: 'x' } }, { to: 'a@example.org', subject: 's', text: 7, sender: remetente },
  { to: 'a@example.org', subject: 's', text: 'x'.repeat(100001), sender: remetente }, { to: 'a@example.org', subject: 's'.repeat(200), text: 't', sender: remetente },
  { to: 'a@example.org', subject: 's', text: '', sender: remetente }, null, { to: 'a@example.org', subject: 's', text: 't' },
];

/** Endereços que o host pode resolver; o envio só segue com todos públicos. */
const ENDERECOS = ['8.8.8.8', '203.0.114.1', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.32.0.1', '192.168.1.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '198.18.0.1', '192.0.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '192.88.99.1',
  '1000::1', '1fff::1', '4000::1', 'fec0::1', 'ff02::1', '::1', '::', '2001:db8::1', '2001:2::1', '2001:4860:4860::8888', '2002:7f00:1::', '3fff::1', '2606:4700::1111', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', 'nao-e-ip'];

const CONEXOES_SMTP = [
  ['ok 587', smtp()], ['ok 465', smtp({ port: 465, security: 'tls' })], ['porta 25', smtp({ port: 25, security: 'none' })], ['587 tls', smtp({ security: 'tls' })], ['host sem ponto', smtp({ host: 'smtp' })],
  ['usuário com quebra', smtp({ username: 'a\nb' })], ['resend', { id: 'one', transport: 'resend' }], ['nula', null],
];

module.exports = { MESTRA, ORIGEM, AGORA, TOKEN, CONFIGURACOES, CAIXAS, IDS, PEDIDOS, MENSAGENS, ENDERECOS, CONEXOES_SMTP, base, smtp, remetente };

/** Repositório falso em memória, com a mesma interface do front e da API (revisão otimista; recibos do mais novo ao mais antigo). */
function repoFalso() {
  let valor = null; let revisao = 0; const eventos = [];
  const c = (v) => JSON.parse(JSON.stringify(v));
  return {
    eventos,
    async read() { return valor ? c(valor) : null; },
    async save(v, esperada) { if (revisao !== esperada) return false; valor = c(v); revisao += 1; return true; },
    async audit(e) { eventos.push(c(e)); },
    async recent() { return [...eventos].reverse().slice(0, 50).map((e) => ({ id: e.id, at: e.at, actorId: e.actorId, purpose: e.purpose, kind: e.kind, ...(e.accountId ? { accountId: e.accountId } : {}), status: e.status, ...(e.error ? { error: e.error } : {}) })); },
  };
}

/** Convites falsos: `Erro` é a classe de erro de cada lado (o front e a API têm a sua). */
function convitesFalsos(Erro) {
  const expira = new Date(AGORA + 48 * 3600000).toISOString();
  return {
    async issue(accountId) {
      if (accountId === 'cooldown') throw new Erro('Aguarde 30 segundos antes de reenviar o convite.', 429);
      return { id: 'invite', accountId, name: 'Nome', email: accountId === 'falha' ? 'falha@example.org' : 'pessoal@example.org', kind: 'first-access', token: TOKEN, expiresAt: expira };
    },
    async findByEmail(email) { return email === 'person@example.org' ? 'usr1' : email === 'cooldown@example.org' ? 'cooldown' : null; },
    async inspect(token) { return token === TOKEN ? { status: 'valid', name: 'Nome', email: 'pessoal@example.org', kind: 'first-access', expiresAt: expira } : { status: 'invalid' }; },
    async accept(token) { if (token !== TOKEN) throw new Erro('Convite inválido. Solicite um novo link à administração.', 409); },
  };
}

/** Envio falso: guarda o que recebeu e falha quando o destinatário começa com "falha". */
function envioFalso(registro) {
  return async (connection, secret, message) => {
    registro.push({ connection, secret, message });
    if (message.to.toLowerCase().startsWith('falha')) throw new Error('provedor ecoou segredo-ficticio');
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Sem o que muda a cada execução: ids sorteados viram `<id>`. */
const normalizar = (v) => (Array.isArray(v) ? v.map(normalizar) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' && typeof x === 'string' && UUID.test(x) ? '<id>' : normalizar(x)])) : v);

module.exports.repoFalso = repoFalso;
module.exports.convitesFalsos = convitesFalsos;
module.exports.envioFalso = envioFalso;
module.exports.normalizar = normalizar;
