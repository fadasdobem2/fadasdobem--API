'use strict';

/**
 * Convite de acesso (v706), no servidor, no lugar do convite demonstrativo do navegador (`demo-invitations.ts`):
 *   - a administradora emite (`POST /accounts/:id/invitation`) ou cancela (`.../invitation/cancel`); o token volta UMA vez, na resposta,
 *     e nunca é guardado: o servidor guarda só a impressão SHA-256. O token é derivado (HMAC com o segredo do servidor, chave da operação e
 *     conta) para a repetição da mesma operação devolver o mesmo link sem o token entrar em `gf_operacoes`;
 *   - a pessoa abre o link e define a senha SEM sessão (`POST /invitations/resolve` e `/invitations/accept`): a regra de validade é a do front
 *     (`resolverConvite`: 48 horas, uso único, e-mail e função inalterados, conta ativa) e a senha precisa ser forte (15 caracteres);
 *   - gerar outro convite invalida o anterior; bloquear/reativar, trocar e-mail ou função revoga o convite aberto (como o front).
 * Senha só como hash bcrypt; nunca em log, auditoria nem resposta.
 */

const { createHmac, randomUUID } = require('crypto');
const conv = require('../../_comum/dominio/contas-convite');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { novosDadosNoPostgres } = require('../../novo/modo');
const c = require('../cadastros/cadastros.comum');
const store = require('./contas.store');
const cs = require('./contas.convite.store');
const validar = require('./contas.validacao');
const { emTransacaoContas } = require('./contas.banco');
const { chaveAuditoria, hashSenha, exigirAdministradora, conflitoConta, naoEncontrada, gravar, respostaDe } = require('./contas.comum');

const segredo = () => process.env.JWT_SECRET || 'gf-contas';
const tokenDaOperacao = (userId, operationKey) => createHmac('sha256', segredo()).update(`convite:${userId}:${operationKey}`).digest('hex');

/** O convite que a conta guarda, no formato do front (para as funções de domínio). */
const contaDoFront = (linha, agora) => store.dto(linha, agora);

/** Emite o convite NA transação em curso (criação, reenvio e nova senha). Devolve o convite guardado. */
async function emitirDentro(ex, t, linha, operationKey, agora = new Date()) {
  const conta = contaDoFront(linha, agora);
  const tipo = conv.tipoDoConvite({ existente: conta, completando: Boolean(linha.acesso_pendente) });
  const convite = conv.criarConvite({ id: linha.id, email: linha.email, role: linha.perfil }, tipo, tokenDaOperacao(linha.id, operationKey), agora.getTime());
  await cs.gravarConvite(ex, linha.id, convite, tipo === 'first-access');
  return convite;
}

/** Acrescenta o token à resposta guardada, só se o convite dela ainda é o aberto daquela operação. */
function comToken(resposta, userId, operationKey) {
  const token = tokenDaOperacao(userId, operationKey);
  const d = resposta.account && resposta.account.demoInvitation;
  const aberto = d && d.tokenHash === conv.impressaoDoToken(token) && !d.usedAt && !d.revokedAt;
  return aberto ? { ...resposta, invitation: { token, kind: d.kind, expiresAt: d.expiresAt } } : resposta;
}

/** `POST /accounts/:id/invitation`: gera (ou gera de novo) o convite de primeiro acesso ou de nova senha. */
async function emitir(req) {
  exigirAdministradora(req, true);
  const id = validar.idConta(req.params.id);
  const b = validar.corpoConvite(req.body);
  const resposta = await gravar(req, {
    escopo: 'contas.convite', operationKey: b.operationKey, corpo: { id, expectedRevision: b.expectedRevision }, acao: 'contas.convite', entidadeId: id,
    producao: async (ex, t, ator) => {
      const usuario = await store.travar(id, t);
      const antes = usuario && await store.lerUma(id, t);
      if (!antes) throw naoEncontrada();
      if ((await store.revisaoAtual(ex, id)) !== b.expectedRevision) throw conflitoConta();
      if (!conv.isFadasEmail(antes.email)) throw c.regra(conv.MSG.emailFadas);
      const msg = conv.conferirGeracao({ email: antes.email, cadastroAtivo: antes.perfil === 'tarologa' ? antes.cadastro_ativo !== false : undefined, existente: { active: antes.ativo }, completando: Boolean(antes.acesso_pendente) });
      if (msg) throw c.regra(msg);
      const convite = await emitirDentro(ex, t, antes, b.operationKey);
      await store.gravarExt(ex, id, {}, ator);
      const resposta = await respostaDe(id, t, ex);
      return { antes: { convite: false }, depois: { convite: convite.kind, expiraEm: convite.expiresAt }, resposta };
    },
  });
  return comToken(resposta, id, b.operationKey);
}

/** `POST /accounts/:id/invitation/cancel`: "Cancelar convite". Sem convite aberto, não muda nada. */
async function cancelar(req) {
  exigirAdministradora(req, true);
  const id = validar.idConta(req.params.id);
  const b = validar.corpoConvite(req.body);
  return gravar(req, {
    escopo: 'contas.convite.cancelar', operationKey: b.operationKey, corpo: { id, expectedRevision: b.expectedRevision }, acao: 'contas.convite.cancelar', entidadeId: id,
    producao: async (ex, t, ator) => {
      const usuario = await store.travar(id, t);
      const antes = usuario && await store.lerUma(id, t);
      if (!antes) throw naoEncontrada();
      if ((await store.revisaoAtual(ex, id)) !== b.expectedRevision) throw conflitoConta();
      await cs.revogarConvite(ex, id, new Date().toISOString());
      await store.gravarExt(ex, id, {}, ator);
      const resposta = await respostaDe(id, t, ex);
      return { antes: { convite: Boolean(antes.convite_hash) }, depois: { convite: 'cancelado' }, resposta };
    },
  });
}

/** Linha pelo token, e a decisão do domínio sobre ela. */
async function resolverLinha(token, t, agora) {
  const dono = await cs.donoDaImpressao(conv.impressaoDoToken(token), t);
  const linha = dono && await store.lerUma(dono, t);
  const r = linha ? conv.resolverConvite([contaDoFront(linha, agora)], token, agora.getTime()) : { status: 'invalid' };
  return { linha, r };
}
const publica = (r) => (r.status === 'valid' ? { status: 'valid', kind: r.invitation.kind, account: { name: r.account.name, email: r.account.email } } : { status: r.status });

/** `POST /invitations/resolve`: o que a tela do convite mostra. Sem sessão. */
async function resolverPublico(req) {
  if (!novosDadosNoPostgres()) throw c.indisponivel();
  const b = validar.corpoPublico(req.body, false);
  const { linha, r } = await resolverLinha(b.token, undefined, new Date());
  const ok = r.status === 'valid' && (linha.perfil !== 'tarologa' || linha.cadastro_ativo !== false);
  return ok ? publica(r) : { status: r.status === 'valid' ? 'blocked' : r.status };
}

/** `POST /invitations/accept`: define a senha e consome o convite. Sem sessão. */
async function aceitarPublico(req) {
  if (!novosDadosNoPostgres()) throw c.indisponivel();
  const b = validar.corpoPublico(req.body, true);
  validar.exigirSenhaForte(b.password);
  const hash = await hashSenha(b.password);
  const agora = new Date();
  return emTransacaoContas(async (ex, t) => {
    const dono = await cs.donoDaImpressao(conv.impressaoDoToken(b.token), t);
    const usuario = dono && await store.travar(dono, t);
    if (!usuario) return { status: 'invalid' };
    const linha = await store.lerUma(dono, t);
    const r = conv.resolverConvite([contaDoFront(linha, agora)], b.token, agora.getTime());
    if (r.status !== 'valid') return { status: r.status };
    if (linha.perfil === 'tarologa' && linha.cadastro_ativo === false) return { status: 'blocked' };
    const aceito = conv.resgatarConvite(contaDoFront(linha, agora), b.token, agora.getTime());
    if (aceito.status !== 'accepted') return { status: aceito.status };
    await usuario.update({ password_hash: hash, email_verified_at: usuario.email_verified_at || agora }, { transaction: t });
    await store.revogarSessoes(dono, t);
    await cs.marcarUsado(ex, dono, agora.toISOString());
    await ex.execute('UPDATE gf_contas_ext SET revisao = revisao + 1, atualizado_em = CURRENT_TIMESTAMP, atualizado_por = ? WHERE user_id = ?', [dono, dono]);
    await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
      { actorUserId: dono, actorRole: linha.perfil, action: 'contas.convite.aceitar', entity: 'conta', entityId: dono, before: { acessoPendente: Boolean(linha.acesso_pendente) }, after: { senhaDefinida: true, sessoesEncerradas: true } },
      { id: randomUUID(), agora: agora.getTime(), chave: chaveAuditoria('contas.convite.aceitar', conv.impressaoDoToken(b.token)) },
    ));
    return { status: 'accepted', account: { name: linha.nome, email: linha.email } };
  });
}

module.exports = { emitir, cancelar, resolverPublico, aceitarPublico, emitirDentro, comToken };
