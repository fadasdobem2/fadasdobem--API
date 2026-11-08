'use strict';

/** Cenários do ouro da v706: rodam o código REAL do front (passado em `front`) e guardam entrada + saída. */

const AGORA = Date.parse('2026-11-10T15:00:00.000Z');
const HORA = 3600 * 1000;
const j = (v) => JSON.parse(JSON.stringify(v === undefined ? null : v));
const tentar = async (fn) => { try { return { ok: j(await fn()) }; } catch (e) { return { erro: e instanceof Error ? e.message : String(e) }; } };

const EMAILS = ['ana@fadasdobem.com.br', 'ANA@FADASDOBEM.COM.BR', '  ana@fadasdobem.com.br  ', 'ana@fadasdobem.com', 'ana@fadasdobem.com.br.evil.com', 'ana@evil.fadasdobem.com.br', '@fadasdobem.com.br',
  'a b@fadasdobem.com.br', 'ana@@fadasdobem.com.br', 'ana@exemplo.com', 'ana', '', ' ', 'ana@demonstracao.invalid', 'ana.silva+x@fadasdobem.com.br', 'ana@fadasdobem.com.br\n',
  'ana@exemplo.com', 'ANA@Exemplo.Com.BR', ' ana@exemplo.com ', 'a..b@exemplo.com', '.a@exemplo.com', 'a.@exemplo.com', 'a@exemplo', 'a@x.c', 'a@-x.com', 'a@x_y.com', "o'brien@exemplo.com", 'ana@sub.exemplo.com.br', 'josé@exemplo.com', 'ana@exemplo.com\u0000', 'ana@exemplo.com\t', `${'a'.repeat(246)}@exemplo.com`, `${'a'.repeat(250)}@exemplo.com`, 'a b@exemplo.com', 'ana@exemplo.123'];
const SENHAS = ['', 'curta', 'Abcdefghij1!', 'Abcdefghijkl1!', 'Abcdefghijklm1!', 'Abcdefghijklmn1!', 'abcdefghijklmn1!', 'ABCDEFGHIJKLMN1!', 'Abcdefghijklmno!', 'Abcdefghijklmn12',
  'Ação#Forte12345', 'x'.repeat(14) + 'A1!', 'Valida#Senha1234', 'Valida#Senha123', ' Valida#Senha1234 '];
const PAPEIS = ['administradora', 'assistente', 'supervisora', 'atendente', 'tarologa'];

const conta = (o = {}) => ({ id: 'usr-1', name: 'Ana', email: 'ana@fadasdobem.com.br', role: 'atendente', commission: '—', access: 'Ainda não acessou', active: true, ...o });
const admin = (o = {}) => ({ id: 'usr-adm', name: 'Clara', role: 'administradora', active: true, ...o });
const CRED = { scheme: 'PBKDF2-SHA256', salt: 'a'.repeat(32), digest: 'b'.repeat(64), iterations: 120000 };

async function montar(f) {
  const ouro = { agora: AGORA, emails: [], senhas: [], criacoes: [], resolucoes: [], resgates: [], revogacoes: [], entradas: [], minutagem: [], validas: [], escritas: [], verMinutagem: [] };

  for (const e of EMAILS) ouro.emails.push({ e, esperado: f.conv.isAccountEmail(e) });
  ouro.emails.push({ e: null, esperado: f.conv.isAccountEmail(null) }, { e: 7, esperado: f.conv.isAccountEmail(7) });
  for (const s of SENHAS) ouro.senhas.push({ s, esperado: f.cred.strongAccountPassword(s) });

  // Emissão: o token é o do front; o servidor tem de produzir o mesmo convite a partir dele.
  const emitidos = [];
  for (const e of ['ana@fadasdobem.com.br', 'ANA@Fadasdobem.com.br', 'ana@exemplo.com', '']) {
    for (const kind of ['first-access', 'reset-password']) {
      for (const [id, agora] of [['usr-1', AGORA], ['', AGORA], ['usr-1', Number.NaN]]) {
        const entrada = { id, email: e, role: 'atendente' };
        const r = await tentar(async () => { const x = await f.conv.createDemoInvitation(entrada, kind, agora); emitidos.push({ token: x.token, invitation: x.invitation }); return x.invitation; });
        const token = r.ok && emitidos[emitidos.length - 1].token;
        ouro.criacoes.push({ conta: entrada, kind, agora: Number.isNaN(agora) ? null : agora, token: token || null, esperado: r });
      }
    }
  }

  // Resolução: toda forma de convite (válido, usado, revogado, expirado, trocado...).
  const base = await f.conv.createDemoInvitation(conta(), 'first-access', AGORA - HORA);
  const outro = await f.conv.createDemoInvitation(conta({ id: 'usr-2', email: 'bia@fadasdobem.com.br' }), 'reset-password', AGORA - HORA);
  const com = (inv, c = {}) => conta({ ...c, demoInvitation: inv });
  const variantes = [
    ['válido', com(base.invitation)], ['usado', com({ ...base.invitation, usedAt: new Date(AGORA).toISOString() })],
    ['revogado', com({ ...base.invitation, revokedAt: new Date(AGORA).toISOString() })], ['usado e revogado', com({ ...base.invitation, usedAt: 'x', revokedAt: 'y' })],
    ['expirado', com(base.invitation, {}), AGORA + 48 * HORA], ['expira agora', com(base.invitation, {}), Date.parse(base.invitation.expiresAt)],
    ['um ms antes de expirar', com(base.invitation, {}), Date.parse(base.invitation.expiresAt) - 1],
    ['emitido no futuro', com(base.invitation, {}), AGORA - 2 * HORA], ['conta inativa', com(base.invitation, { active: false })],
    ['e-mail da conta mudou', com(base.invitation, { email: 'outra@fadasdobem.com.br' })], ['função da conta mudou', com(base.invitation, { role: 'supervisora' })],
    ['id da conta mudou', com({ ...base.invitation, accountId: 'usr-9' })], ['e-mail da conta fora do Fadas', com(base.invitation, { email: 'ana@exemplo.com' })],
    ['e-mail do convite fora do Fadas', com({ ...base.invitation, email: 'ana@exemplo.com' })], ['tipo inválido', com({ ...base.invitation, kind: 'x' })],
    ['validade além de 48 h', com({ ...base.invitation, expiresAt: new Date(AGORA + 49 * HORA).toISOString() })],
    ['validade igual à emissão', com({ ...base.invitation, expiresAt: base.invitation.issuedAt })], ['datas inválidas', com({ ...base.invitation, issuedAt: 'x' })],
    ['reset-password', com(outro.invitation, { id: 'usr-2', email: 'bia@fadasdobem.com.br' })], ['sem convite', conta()],
  ];
  for (const [nome, c, quando] of variantes) {
    const tok = nome === 'reset-password' ? outro.token : base.token;
    const agora = quando === undefined ? AGORA : quando;
    for (const token of [tok, tok.toUpperCase(), 'x'.repeat(64), tok.slice(1), '']) {
      const r = await f.conv.resolveDemoInvitation([c], token, agora);
      ouro.resolucoes.push({ nome, contas: [c], token, agora, status: r.status, contaId: r.account ? r.account.id : null });
    }
  }
  const duas = [com(base.invitation), com(base.invitation, { id: 'usr-5' })];
  ouro.resolucoes.push({ nome: 'dois com o mesmo token', contas: duas, token: base.token, agora: AGORA, status: (await f.conv.resolveDemoInvitation(duas, base.token, AGORA)).status, contaId: null });
  ouro.resolucoes.push({ nome: 'relógio inválido', contas: [com(base.invitation)], token: base.token, agora: null, status: (await f.conv.resolveDemoInvitation([com(base.invitation)], base.token, Number.NaN)).status, contaId: null });

  // Resgate (a credencial do demo não existe no servidor: só entram casos de credencial válida) e revogação.
  for (const [nome, c, quando] of variantes) {
    const tok = nome === 'reset-password' ? outro.token : base.token; const agora = quando === undefined ? AGORA : quando;
    for (const acesso of ['Acesso pendente', 'Ainda não acessou', 'Hoje, 10:00']) {
      const cc = { ...c, access: acesso };
      const r = await f.conv.redeemDemoInvitation(cc, tok, CRED, agora);
      ouro.resgates.push({ nome, conta: cc, token: tok, agora, esperado: j(r) });
    }
    ouro.revogacoes.push({ nome, conta: c, agora: AGORA, esperado: j(f.conv.revokeDemoInvitation(c, AGORA)) });
  }

  // Quem pode entrar. Cadastro ativo é o real do front (perfil/diretório).
  const perfil = (id, nome, ativo) => ({ id, name: nome, registrationActive: ativo });
  const cenariosEntrada = [];
  for (const role of PAPEIS) for (const active of [true, false]) for (const email of ['ana@fadasdobem.com.br', 'ana@exemplo.com', 'ana@exemplo']) for (const access of ['Acesso pendente', 'Ainda não acessou']) {
    for (const inv of [undefined, { ...base.invitation, kind: 'first-access' }, { ...base.invitation, kind: 'first-access', usedAt: 'x' }, { ...base.invitation, kind: 'reset-password' }]) {
      for (const cad of role === 'tarologa' ? ['ativo', 'inativo', 'sem'] : ['sem']) {
        const c = conta({ role, active, email, access, ...(inv ? { demoInvitation: inv } : {}), ...(role === 'tarologa' ? { tarotId: 't1' } : {}) });
        const profiles = cad === 'sem' ? [] : [perfil('t1', 'Ana', cad === 'ativo')];
        const directory = [];
        cenariosEntrada.push({ conta: c, profiles, directory, cadastroAtivo: f.acesso.accountRegistrationActive(c, profiles, directory), esperado: f.acesso.accountCanEnter(c, profiles, directory) });
      }
    }
  }
  cenariosEntrada.push({ conta: null, profiles: [], directory: [], cadastroAtivo: false, esperado: f.acesso.accountCanEnter(undefined, [], []) });
  ouro.entradas = cenariosEntrada;

  // Permissão "Ver minutagem total".
  const atores = [admin(), admin({ active: false }), admin({ role: 'supervisora' }), undefined];
  for (const role of PAPEIS) for (const perm of [undefined, { viewDailyMinutes: true }, { viewDailyMinutes: false }]) for (const [ia, ator] of atores.entries()) {
    for (const enabled of [true, false, 'sim']) for (const [at, id] of [['2026-11-10T15:00:00.000Z', 'ev-1'], ['x', 'ev-1'], ['2026-11-10T15:00:00.000Z', '  ']]) {
      const c = conta({ role, ...(perm ? { permissions: perm } : {}) });
      const r = await tentar(() => f.perm.setDailyMinutesPermission(c, enabled, ator, at, id));
      ouro.minutagem.push({ conta: c, enabled, ator: ator || null, at, id, esperado: r, ia });
    }
    ouro.verMinutagem.push({ role, individual: perm || null, esperado: f.papeis.permissionsFor(role, perm).canViewDailyMinutes });
  }
  ouro.verMinutagem.push({ role: 'atendente', individual: null, semArgumento: true, esperado: f.papeis.permissionsFor('atendente').canViewDailyMinutes });
  for (const role of PAPEIS) ouro.minutagem.push({ pode: role, esperado: f.perm.canReceiveDailyMinutesPermission(role) });

  const trilha = (o = {}) => ({ id: 'e1', permission: 'viewDailyMinutes', before: false, after: true, at: '2026-11-10T15:00:00.000Z', actorId: 'a', actorName: 'Clara', actorRole: 'administradora', ...o });
  const formas = [{}, { permissions: {} }, { permissions: { viewDailyMinutes: true } }, { permissions: { viewDailyMinutes: 'sim' } }, { permissions: { outra: true } }, { permissions: null }, { permissions: [] }, { permissions: 'x' },
    { permissionAudit: [] }, { permissionAudit: [trilha()] }, { permissionAudit: [trilha(), trilha()] }, { permissionAudit: [trilha({ id: 'e2' })] }, { permissionAudit: [trilha({ id: ' ' })] },
    { permissionAudit: [trilha({ permission: 'x' })] }, { permissionAudit: [trilha({ before: 'x' })] }, { permissionAudit: [trilha({ after: 1 })] }, { permissionAudit: [trilha({ at: 'x' })] },
    { permissionAudit: [trilha({ actorId: 1 })] }, { permissionAudit: [trilha({ actorName: null })] }, { permissionAudit: [trilha({ actorRole: 'atendente' })] }, { permissionAudit: {} }, { permissionAudit: [null] }, { permissionAudit: null }];
  for (const x of formas) ouro.validas.push({ x, esperado: f.perm.validAccountPermissions(x) });

  const a1 = conta({ id: 'u1' }); const a1p = conta({ id: 'u1', permissions: { viewDailyMinutes: true }, permissionAudit: [trilha()] });
  const a2 = conta({ id: 'u2' });
  const pares = [[[a1], [a1]], [[a1], [a1p]], [[a1p], [a1]], [[a1], [a1, a2]], [[a1, a2], [a1]], [undefined, [a1]], [[a1], undefined], [undefined, undefined], [[a1], [{ ...a1, name: 'Outro' }]], [[a1], [{ ...a1, permissions: { viewDailyMinutes: false } }]], [[a1], [{ ...a1, permissionAudit: [] }]]];
  for (const [antes, depois] of pares) for (const papel of [...PAPEIS, undefined]) {
    ouro.escritas.push({ antes: antes || null, depois: depois || null, papel: papel || null, esperado: await tentar(() => { f.perm.assertAccountPermissionWrite(antes, depois, papel); return true; }) });
  }
  return ouro;
}

module.exports = { montar, AGORA };
