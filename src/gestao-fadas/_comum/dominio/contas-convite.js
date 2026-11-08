'use strict';

/**
 * Convite de acesso da equipe (v706). Regras do CÓDIGO do front, com as mesmas mensagens e estados:
 *   features/auth/demo-invitations.ts (isAccountEmail, createDemoInvitation, resolveDemoInvitation, redeemDemoInvitation, revokeDemoInvitation),
 *   features/auth/account-access.ts (accountCanEnter) e a escolha do tipo em `saveAccount` (shell/home-experience.tsx).
 * Puro: o token e o relógio chegam por parâmetro. Aqui o token só existe como impressão SHA-256; o servidor nunca guarda o token.
 * Substituída: a credencial PBKDF2 do demo (`demoCredential`). No servidor a senha é o hash bcrypt de `users`; a regra de força é a mesma.
 */

const { createHash } = require('crypto');

const DURACAO_MS = 48 * 60 * 60 * 1000;
const TIPOS = Object.freeze(['first-access', 'reset-password']);
const MSG = Object.freeze({
  emailInvalido: 'Informe um e-mail válido.',
  selecione: 'Selecione uma conta para gerar o convite.',
  validade: 'Não foi possível determinar a validade do convite.',
  emailConvite: 'Informe um e-mail válido para gerar o convite.',
  cadastroInativo: 'Ative o cadastro da profissional antes de gerar o convite.',
  acessoInativo: 'Reative o acesso antes de gerar o convite.',
});

const emailNormal = (e) => `${e}`.trim().toLocaleLowerCase('pt-BR');
/**
 * `isAccountEmail` (features/auth/account-email.ts, v711): o endereço identifica a conta e o domínio NÃO dá acesso (antes só valia @fadasdobem.com.br).
 * `z.string().trim().max(254).email()` do zod 3 (mesma expressão), sem caractere de controle.
 */
const EMAIL_ZOD = /^(?!\.)(?!.*\.\.)([A-Z0-9_'+\-.]*)[A-Z0-9_+-]@([A-Z0-9][A-Z0-9-]*\.)+[A-Z]{2,}$/i;
const isAccountEmail = (email) => {
  if (typeof email !== 'string' || /[\u0000-\u001f\u007f]/.test(email)) return false;
  const aparado = email.trim();
  return aparado.length <= 254 && EMAIL_ZOD.test(aparado);
};
/** Impressão do token (hex de 64), a única coisa guardada. */
const impressaoDoToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');

/** `createDemoInvitation` sem o sorteio: o token (hex de 64) vem de fora. Devolve só o convite que se guarda. */
function criarConvite(conta, kind, token, agora) {
  const email = emailNormal(conta.email);
  if (!isAccountEmail(email)) throw new Error(MSG.emailInvalido);
  if (!conta.id) throw new Error(MSG.selecione);
  if (!Number.isFinite(agora)) throw new Error(MSG.validade);
  return {
    accountId: conta.id, tokenHash: impressaoDoToken(token), email, role: conta.role, kind,
    issuedAt: new Date(agora).toISOString(), expiresAt: new Date(agora + DURACAO_MS).toISOString(),
  };
}

/** `resolveDemoInvitation`: `{status:'valid', account, invitation}` ou `{status}` de falha. */
function resolverConvite(contas, token, agora) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || !Number.isFinite(agora)) return { status: 'invalid' };
  const digest = impressaoDoToken(token);
  const achadas = contas.filter((c) => c.demoInvitation && c.demoInvitation.tokenHash === digest);
  if (achadas.length !== 1) return { status: 'invalid' };
  const conta = achadas[0]; const convite = conta.demoInvitation;
  const emitido = Date.parse(convite.issuedAt); const expira = Date.parse(convite.expiresAt);
  if (!TIPOS.includes(convite.kind) || !Number.isFinite(emitido) || !Number.isFinite(expira) || expira <= emitido || expira - emitido > DURACAO_MS || emitido > agora) return { status: 'invalid' };
  if (!isAccountEmail(conta.email) || !isAccountEmail(convite.email)) return { status: 'invalid' };
  if (convite.accountId !== conta.id || convite.email !== emailNormal(conta.email) || convite.role !== conta.role) return { status: 'changed' };
  if (convite.usedAt) return { status: 'used' };
  if (convite.revokedAt) return { status: 'revoked' };
  if (expira <= agora) return { status: 'expired' };
  if (!conta.active) return { status: 'blocked' };
  return { status: 'valid', account: conta, invitation: convite };
}

/** `redeemDemoInvitation`, sem a credencial do demo: marca o uso e libera o "Acesso pendente". A senha é gravada pelo serviço. */
function resgatarConvite(conta, token, agora) {
  const r = resolverConvite([conta], token, agora);
  if (r.status !== 'valid') return { status: r.status };
  return {
    status: 'accepted',
    account: { ...conta, access: conta.access === 'Acesso pendente' ? 'Ainda não acessou' : conta.access, demoInvitation: { ...r.invitation, usedAt: new Date(agora).toISOString() } },
  };
}

/** `revokeDemoInvitation`. */
function revogarConvite(conta, agora) {
  const c = conta.demoInvitation;
  if (!c || c.usedAt || c.revokedAt) return conta;
  return { ...conta, demoInvitation: { ...c, revokedAt: new Date(agora).toISOString() } };
}

/** Tipo do convite em `saveAccount`: primeiro acesso (conta nova, acesso pendente, ou primeiro convite ainda não usado) ou nova senha. */
function tipoDoConvite({ existente, completando }) {
  const c = existente && existente.demoInvitation;
  return !existente || completando || (c && c.kind === 'first-access' && !c.usedAt) ? 'first-access' : 'reset-password';
}

/**
 * Conferências de `saveAccount` ao gerar convite, na ordem do front. `null` se pode.
 * `cadastroAtivo`: o cadastro da profissional (ou `undefined` sem vínculo); `existente`: a conta que se edita.
 */
function conferirGeracao({ email, cadastroAtivo, existente, completando }) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return MSG.emailConvite;
  if (cadastroAtivo === false) return MSG.cadastroInativo;
  if (existente && !existente.active && !completando) return MSG.acessoInativo;
  return null;
}

/** `accountCanEnter`: ativa, e-mail válido, acesso já criado (nem pendente, nem primeiro convite sem uso) e cadastro ativo. */
function podeEntrar(conta, cadastroAtivo) {
  return Boolean(conta && conta.active && isAccountEmail(conta.email) && conta.access !== 'Acesso pendente'
    && !(conta.demoInvitation && conta.demoInvitation.kind === 'first-access' && !conta.demoInvitation.usedAt) && cadastroAtivo);
}

module.exports = { DURACAO_MS, TIPOS, MSG, isAccountEmail, impressaoDoToken, criarConvite, resolverConvite, resgatarConvite, revogarConvite, tipoDoConvite, conferirGeracao, podeEntrar };
