'use strict';

/**
 * Peças comuns das gravações de contas (usadas por contas.service.js e contas.convite.service.js): hash e impressão da senha,
 * exigência da administradora, conflito de revisão, resumo para auditoria e a gravação idempotente com auditoria na mesma transação.
 */

const bcrypt = require('bcryptjs');
const { randomUUID, createHash, createHmac } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const dom = require('../../_comum/dominio/contas');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');
const c = require('../cadastros/cadastros.comum');
const store = require('./contas.store');
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

module.exports = { chaveAuditoria, hashSenha, marcaSenha, exigirAdministradora, conflitoConta, naoEncontrada, resumo, gravar, respostaDe };
