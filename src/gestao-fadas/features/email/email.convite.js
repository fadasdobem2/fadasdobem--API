'use strict';

/**
 * Convite por e-mail sobre as contas do Gestão (v711): a entrega por LINK continua como está (`contas.convite.service.js`); aqui o MESMO convite
 * (48 horas, uso único, só o mais recente vale) é emitido para ser ENVIADO pela finalidade "usuarios". Porte das regras de
 * server/email/mysql-invitations.ts do front: conta ativa, e-mail válido, profissional só com cadastro ativo, espera de 30 segundos entre
 * emissões, bloqueio de nova emissão por conta, e recusa sem pista do motivo. O token nasce aqui, vai só no e-mail e nunca é guardado
 * (só a impressão SHA-256). Implementa a interface `MailInvitationAccounts` que `email.service.js` usa.
 */

const { createHmac, randomUUID } = require('crypto');
const { QueryTypes } = require('sequelize');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const conv = require('../../_comum/dominio/contas-convite');
const dom = require('../../_comum/dominio/contas');
const { novosDadosNoPostgres } = require('../../novo/modo');
const store = require('../contas/contas.store');
const convite = require('../contas/contas.convite.service');
const { emTransacaoContas } = require('../contas/contas.banco');
const { chaveAuditoria } = require('../contas/contas.comum');
const { EmailErro } = require('./email.erro');

const ESPERA_MS = 30_000;
const MSG_INDISPONIVEL = 'Convite indisponível. Solicite um novo link à administração.';
const MSG_INVALIDO = 'Convite inválido. Solicite um novo link à administração.';
const MSG_SENHA = 'Use uma senha de 15 a 128 caracteres, com maiúscula, minúscula, número e símbolo.';
const AUTO = 'self-recovery';

const segredo = () => process.env.JWT_SECRET || 'gf-contas';
const novoToken = (id, chave) => createHmac('sha256', segredo()).update(`convite:${id}:${chave}`).digest('hex');
const indisponivel = () => new EmailErro(MSG_INDISPONIVEL, 409);

/** Conta apta a receber convite: ativa, e-mail válido e, sendo profissional, com cadastro ativo. */
const apta = (l) => Boolean(l && l.ativo && conv.isAccountEmail(l.email) && (l.perfil !== 'tarologa' || l.cadastro_ativo !== false));

async function emitir(accountId, actorId, agora) {
  if (!novosDadosNoPostgres()) throw indisponivel();
  const operationKey = randomUUID();
  const token = novoToken(accountId, operationKey);
  try {
    return await emTransacaoContas(async (ex, t) => {
      const usuario = await store.travar(accountId, t);
      const antes = usuario && await store.lerUma(accountId, t);
      if (!apta(antes)) throw indisponivel();
      if (antes.convite_emitido && new Date(antes.convite_emitido).getTime() > agora - ESPERA_MS) throw new EmailErro('Aguarde 30 segundos antes de reenviar o convite.', 429);
      const emitido = await convite.emitirDentro(ex, t, antes, operationKey, new Date(agora));
      const autor = actorId === AUTO ? accountId : actorId;
      await store.gravarExt(ex, accountId, {}, autor);
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: autor, actorRole: antes.perfil, action: 'contas.convite.email', entity: 'conta', entityId: accountId, before: { convite: Boolean(antes.convite_hash) }, after: { convite: emitido.kind, expiraEm: emitido.expiresAt, canal: actorId === AUTO ? 'recuperacao' : 'email' } },
        { id: randomUUID(), agora, chave: chaveAuditoria('contas.convite.email', operationKey) },
      ));
      return { id: operationKey, accountId, name: antes.nome, email: antes.email, kind: emitido.kind, token, expiresAt: emitido.expiresAt };
    });
  } catch (e) {
    if (e instanceof EmailErro) throw e;
    throw indisponivel();
  }
}

/** O que a tela do link mostra, no formato do front: `valid` com nome, e-mail, tipo e validade; senão só o estado. */
async function inspecionar(token, agora) {
  if (!novosDadosNoPostgres() || !/^[a-f0-9]{64}$/.test(token)) return { status: 'invalid' };
  const { linha, r } = await convite.resolverLinha(token, undefined, new Date(agora));
  if (r.status === 'valid' && linha.perfil === 'tarologa' && linha.cadastro_ativo === false) return { status: 'invalid' };
  if (r.status !== 'valid') return { status: ['used', 'revoked', 'expired'].includes(r.status) ? r.status : 'invalid' };
  return { status: 'valid', name: r.account.name, email: r.account.email, kind: r.invitation.kind, expiresAt: r.invitation.expiresAt };
}

async function aceitar(token, senha, agora) {
  if ((await inspecionar(token, agora)).status !== 'valid') throw new EmailErro(MSG_INVALIDO, 409);
  if (senha.length > 128 || Buffer.byteLength(senha) > 512 || !dom.senhaForte(senha)) throw new EmailErro(MSG_SENHA, 400);
  const r = await convite.aceitarPublico({ body: { token, password: senha } });
  if (r.status !== 'accepted') throw new EmailErro(MSG_INVALIDO, 409);
}

async function acharPorEmail(email) {
  if (!novosDadosNoPostgres()) return null;
  const { sequelize } = require('../../../config/database');
  const [u] = await sequelize.query('SELECT id FROM users WHERE lower(email) = :e AND deleted_at IS NULL LIMIT 1', { type: QueryTypes.SELECT, replacements: { e: email.trim().toLocaleLowerCase('pt-BR') } });
  if (!u) return null;
  const linha = await store.lerUma(u.id);
  return apta(linha) ? u.id : null;
}

const contasPorEmail = { issue: emitir, inspect: inspecionar, accept: aceitar, findByEmail: acharPorEmail };

module.exports = { contasPorEmail, apta };
