'use strict';

/**
 * Contas de acesso (Configurações > Equipe). Só a administradora lê e grava (a tela só existe para ela: admin-experience.tsx:196).
 *   - a conta É o usuário da A (`users`), com o perfil da B vindo dos papéis RBAC (Maturacao/23): administradora, assistente,
 *     supervisora, atendente; a taróloga é `users.role = TAROLOGA` + `specialists` ligado ao catálogo por `gf_tarologos_perfil.conta_slug`;
 *   - campos do front sem coluna na A (ID no sistema antigo, foto, revisão) ficam em `gf_contas_ext`;
 *   - senha: SÓ hash bcrypt (o mesmo custo do login da A); nunca em log, auditoria, resposta ou `gf_operacoes` (a impressão da operação usa HMAC);
 *   - bloquear/trocar senha revoga os refresh tokens da conta (o access é validado contra o banco a cada pedido);
 *   - idempotência por `operationKey`, revisão otimista `expectedRevision` (409 VERSION_CHANGED), auditoria na MESMA transação.
 * Convite com link/token NÃO existe aqui: o front não tem o conceito (Maturacao/33, seção 3).
 */

const bcrypt = require('bcryptjs');
const { randomUUID, createHash, createHmac } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const dom = require('../../_comum/dominio/contas');
const { novosDadosNoPostgres } = require('../../novo/modo');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');
const c = require('../cadastros/cadastros.comum');
const tarologos = require('../cadastros/tarologos.service');
const tarologosStore = require('../cadastros/tarologos.store');
const store = require('./contas.store');
const validar = require('./contas.validacao');
const { emTransacaoContas } = require('./contas.banco');

const chaveAuditoria = (escopo, chave) => `cta:${createHash('sha256').update(`${escopo}:${chave}`).digest('hex').slice(0, 40)}`;
const custoBcrypt = () => require('../../../features/auth/auth.constants').AUTH_CONFIG.bcryptCostPassword || 12;
const hashSenha = (s) => bcrypt.hash(s, custoBcrypt());
/** Impressão da senha para a idempotência: HMAC com segredo do servidor (a senha em claro nunca entra no corpo guardado). */
const marcaSenha = (s) => (s === undefined ? null : createHmac('sha256', process.env.JWT_SECRET || 'gf-contas').update(s).digest('hex'));

function exigirAdministradora(req, escrita) {
  if (resolverPerfil(req) !== 'administradora') throw c.negado(escrita);
}
const conflitoConta = () => new AppError('Não foi possível salvar este cadastro. Seu rascunho foi mantido; reabra o cadastro e tente novamente.', 409, { codigo: 'VERSION_CHANGED', usarMensagem: true }, true);
const naoEncontrada = () => c.naoEncontrado();

/** O que a auditoria guarda de uma conta: nunca senha, hash nem a foto inteira. */
const resumo = (conta) => (conta ? { name: conta.name, email: conta.email, role: conta.role, active: conta.active, ...(conta.tarotId ? { tarotId: conta.tarotId } : {}), ...(conta.legacyId ? { legacyId: conta.legacyId } : {}), temFoto: Boolean(conta.avatar) } : null);

/** `GET /accounts`. */
async function ler(req) {
  if (!novosDadosNoPostgres()) throw c.indisponivel();
  exigirAdministradora(req, false);
  const agora = new Date();
  const linhas = await store.lerLinhas();
  return { readAt: agora.toISOString(), accounts: linhas.map((l) => store.dto(l, agora)), revisions: Object.fromEntries(linhas.map((l) => [l.id, l.revisao])) };
}

/** Gravação idempotente: efeito + auditoria + gf_operacoes numa transação; `producao(ex, t)` devolve `{ antes, depois, resposta }`. */
async function gravar(req, { escopo, operationKey, corpo, acao, entidadeId, producao }) {
  const conta = contaDaRequisicao(req);
  const perfil = resolverPerfil(req);
  if (!conta || !perfil) throw c.indisponivel();
  try {
    const r = await emTransacaoContas(async (ex, t) => umaVez(ex, { escopo, chave: operationKey, corpo: { ...corpo, usuario: conta } }, async () => {
      const feito = await producao(ex, t, conta);
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: conta, actorRole: perfil, action: acao, entity: 'conta', entityId: feito.entidadeId || entidadeId, before: feito.antes, after: feito.depois },
        { id: randomUUID(), agora: Date.now(), chave: chaveAuditoria(escopo, operationKey) },
      ));
      return feito.resposta;
    }));
    return r.resposta;
  } catch (erro) {
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro && (erro.name === 'SequelizeUniqueConstraintError' || erro.errno === 1062 || erro.code === '23505')) throw c.regra(dom.MSG.emailEmUso);
    if (erro && erro.codigo === 'PAPEL_AUSENTE') throw c.indisponivel();
    throw erro;
  }
}

const respostaDe = async (id, t, ex, agora = new Date()) => {
  const l = await store.lerUma(id, t);
  return { readAt: agora.toISOString(), account: store.dto(l, agora), revision: l.revisao };
};

/** `POST /accounts`. */
async function criar(req) {
  exigirAdministradora(req, true);
  const b = validar.corpoCriar(req.body);
  let item = null;
  if (b.role === 'tarologa') {
    item = (await tarologos.catalogo()).find((i) => i.id === b.tarotId);
    if (!item) throw c.regra(dom.MSG.semCadastro);
    if (item.accountLinked) throw c.regra(dom.MSG.jaTemAcesso);
  }
  // Ordem do front (`planAccountCommand`): nome e e-mail, e-mail já cadastrado e só então a força da senha.
  if (await store.emailEmUso(b.email)) throw c.regra(dom.MSG.emailEmUso);
  validar.exigirSenhaForte(b.password);
  if (b.role === 'tarologa' && !b.tarotId) throw c.regra(dom.MSG.semCadastro);
  const hash = await hashSenha(b.password);
  const corpo = { role: b.role, tarotId: b.tarotId, name: b.name, email: b.email, senha: marcaSenha(b.password), legacyId: b.legacyId, temFoto: Boolean(b.avatar) };
  return gravar(req, {
    escopo: 'contas.criar', operationKey: b.operationKey, corpo: { ...corpo, avatar: b.avatar ? createHash('sha256').update(b.avatar).digest('hex') : null }, acao: 'contas.criar',
    producao: async (ex, t, ator) => {
      const { User, Specialist } = require('../../../models');
      if (await store.emailEmUso(b.email, t)) throw c.regra(dom.MSG.emailEmUso);
      const tarologa = b.role === 'tarologa';
      const papeis = dom.PAPEIS_DA_A[b.role];
      const usuario = await User.create({ email: b.email, password_hash: hash, role: tarologa ? 'TAROLOGA' : papeis.produto, is_active: tarologa ? item.registrationActive !== false : true, email_verified_at: new Date() }, { transaction: t });
      if (tarologa) {
        const perfil = await tarologosStore.perfilTravado(ex, b.tarotId);
        if (perfil && perfil.conta_slug) throw c.regra(dom.MSG.jaTemAcesso);
        const slug = `conta-${b.tarotId}`.slice(0, 64);
        await Specialist.create({ user_id: usuario.id, display_name: b.name, slug, status: 'OFFLINE', commission_percent_default: '30.00', registration_approval_status: 'APPROVED' }, { transaction: t });
        if (perfil) await tarologosStore.ligarConta(ex, b.tarotId, slug, ator, b.operationKey);
        else if (/^[1-9]\d{0,9}$/.test(b.tarotId)) await tarologosStore.inserirComConta(ex, b.tarotId, Number(b.tarotId), slug, ator, b.operationKey);
        else throw c.regra(dom.MSG.semCadastro);
      } else {
        await store.definirPapeis(usuario, papeis.rbac, t);
        await store.nomeStaff(usuario.id, b.name, t);
      }
      await store.gravarExt(ex, usuario.id, { legacyId: b.legacyId, avatar: b.avatar }, ator);
      const resposta = await respostaDe(usuario.id, t, ex);
      return { entidadeId: usuario.id, antes: null, depois: resumo(resposta.account), resposta };
    },
  });
}

/** `PATCH /accounts/:id`. */
async function editar(req) {
  exigirAdministradora(req, true);
  const id = validar.idConta(req.params.id);
  const b = validar.corpoEditar(req.body);
  const hash = b.password === undefined ? null : await hashSenha(b.password);
  const corpo = { id, expectedRevision: b.expectedRevision, role: b.role, name: b.name, email: b.email, senha: marcaSenha(b.password), legacyId: b.legacyId, avatar: b.avatar === undefined ? undefined : (b.avatar ? createHash('sha256').update(b.avatar).digest('hex') : null) };
  return gravar(req, {
    escopo: 'contas.editar', operationKey: b.operationKey, corpo, acao: 'contas.editar', entidadeId: id,
    producao: async (ex, t, ator) => {
      const usuario = await store.travar(id, t);
      const antes = usuario && await store.lerUma(id, t);
      if (!antes) throw naoEncontrada();
      if ((await store.revisaoAtual(ex, id)) !== b.expectedRevision) throw conflitoConta();
      const contasAntes = (await store.lerLinhas(t)).map((l) => store.dto(l));
      if (b.role !== undefined && b.role !== antes.perfil) {
        if (antes.perfil === 'tarologa' || b.role === 'tarologa') throw c.regra(dom.MSG.vinculada);
        if (dom.removeUltimaAdmin(contasAntes, id, b.role)) throw c.regra(dom.MSG.ultimaAdmin);
      }
      if (b.email !== undefined && b.email !== antes.email.toLocaleLowerCase('pt-BR') && await store.emailEmUso(b.email, t, id)) throw c.regra(dom.MSG.emailEmUso);
      if (b.password !== undefined) validar.exigirSenhaForte(b.password);
      const campos = {};
      if (b.email !== undefined) campos.email = b.email;
      if (hash) campos.password_hash = hash;
      if (b.role !== undefined && b.role !== antes.perfil) campos.role = dom.PAPEIS_DA_A[b.role].produto;
      if (Object.keys(campos).length) await usuario.update(campos, { transaction: t });
      if (campos.role) await store.definirPapeis(usuario, dom.PAPEIS_DA_A[b.role].rbac, t);
      if (b.name !== undefined && b.name !== antes.nome) await (antes.perfil === 'tarologa' ? store.nomeTarologa(id, b.name, t) : store.nomeStaff(id, b.name, t));
      if (hash) await store.revogarSessoes(id, t);
      await store.gravarExt(ex, id, { legacyId: b.legacyId, avatar: b.avatar }, ator);
      const resposta = await respostaDe(id, t, ex);
      return { antes: resumo(store.dto(antes)), depois: { ...resumo(resposta.account), ...(hash ? { senhaAlterada: true } : {}) }, resposta };
    },
  });
}

/** `POST /accounts/:id/password`. */
async function trocarSenha(req) {
  exigirAdministradora(req, true);
  const id = validar.idConta(req.params.id);
  const b = validar.corpoSenha(req.body);
  const hash = await hashSenha(b.password);
  return gravar(req, {
    escopo: 'contas.senha', operationKey: b.operationKey, corpo: { id, expectedRevision: b.expectedRevision, senha: marcaSenha(b.password) }, acao: 'contas.senha', entidadeId: id,
    producao: async (ex, t, ator) => {
      const usuario = await store.travar(id, t);
      const antes = usuario && await store.lerUma(id, t);
      if (!antes) throw naoEncontrada();
      if ((await store.revisaoAtual(ex, id)) !== b.expectedRevision) throw conflitoConta();
      await usuario.update({ password_hash: hash }, { transaction: t });
      await store.revogarSessoes(id, t);
      await store.gravarExt(ex, id, {}, ator);
      const resposta = await respostaDe(id, t, ex);
      return { antes: { senha: 'anterior' }, depois: { senhaAlterada: true, sessoesEncerradas: true }, resposta };
    },
  });
}

/** `POST /accounts/:id/active`: bloquear ou reativar o acesso. */
async function definirAtivo(req) {
  exigirAdministradora(req, true);
  const id = validar.idConta(req.params.id);
  const b = validar.corpoAtivo(req.body);
  return gravar(req, {
    escopo: 'contas.ativo', operationKey: b.operationKey, corpo: { id, expectedRevision: b.expectedRevision, active: b.active }, acao: 'contas.ativo', entidadeId: id,
    producao: async (ex, t, ator) => {
      const usuario = await store.travar(id, t);
      const antes = usuario && await store.lerUma(id, t);
      if (!antes) throw naoEncontrada();
      if ((await store.revisaoAtual(ex, id)) !== b.expectedRevision) throw conflitoConta();
      if (!b.active) {
        if (id === ator) throw c.regra(dom.MSG.bloquearPropria);
        const contas = (await store.lerLinhas(t)).map((l) => store.dto(l));
        if (dom.removeUltimaAdmin(contas, id, antes.perfil, false)) throw c.regra(dom.MSG.ultimaAdmin);
      } else if (antes.perfil === 'tarologa' && antes.cadastro_ativo === false) {
        throw c.regra(dom.MSG.cadastroInativo);
      }
      await usuario.update({ is_active: b.active, blocked_at: b.active ? null : new Date() }, { transaction: t });
      if (!b.active) await store.revogarSessoes(id, t);
      await store.gravarExt(ex, id, {}, ator);
      const resposta = await respostaDe(id, t, ex);
      return { antes: { active: antes.ativo }, depois: { active: b.active }, resposta };
    },
  });
}

module.exports = { ler, criar, editar, trocarSenha, definirAtivo };
