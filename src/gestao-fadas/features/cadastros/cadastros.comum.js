'use strict';

/**
 * Peças comuns da fatia Cadastros (Maturacao/29 seção 9): erros no formato do gate, perfil/identidade da requisição e a gravação
 * idempotente (efeito + auditoria + `gf_operacoes` na MESMA transação), a mesma de Horários/Agenda/Consulta.
 */

const { randomUUID, createHash } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil, permissoesDoPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { CadastroInvalidoError } = require('../../_comum/dominio/cadastro-tarologo');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');

const negado = (escrita) => new AppError(escrita ? 'Esta ação não está disponível para a sua função.' : 'Esta informação não está disponível para a sua função.', 403, { codigo: 'ACCESS_DENIED' }, true);
const conflitoVersao = (mensagem) => new AppError(mensagem || 'O cadastro mudou desde que você abriu a tela. Atualize e tente novamente.', 409, { codigo: 'VERSION_CHANGED', usarMensagem: true }, true);
const indisponivel = () => new AppError('Serviço indisponível.', 503, { codigo: 'SERVICE_UNAVAILABLE' }, true);
const invalido = (campo) => new AppError('Dados inválidos.', 400, { codigo: 'INVALID_INPUT', campo }, true);
const regra = (mensagem) => new AppError(mensagem, 422, { codigo: 'RULE_VIOLATION' }, true);
const naoEncontrado = () => new AppError('Não encontrado.', 404, { codigo: 'NOT_FOUND' }, true);
const chaveAuditoria = (escopo, chave) => `cad:${createHash('sha256').update(`${escopo}:${chave}`).digest('hex').slice(0, 40)}`;

/** Quem é a requisição: perfil da B, capacidades e, para a taróloga, o `tarotId` da sessão. */
function quem(req) {
  const perfil = resolverPerfil(req);
  const p = perfil ? permissoesDoPerfil(perfil) : {};
  return { perfil, p, proprio: perfil === 'tarologa' ? `${(req.user && req.user.tarotId) || ''}` : '', nome: nomeDe(req) };
}
const nomeDe = (req) => `${(req.user && (req.user.nome || req.user.displayName || req.user.name || req.user.email)) || 'Sistema'}`.slice(0, 120);

function chaveOperacao(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(v)) throw invalido('operationKey');
  return v;
}
function revisao(v) {
  if (!Number.isSafeInteger(v) || v < 0) throw invalido('expectedRevision');
  return v;
}
const ehObjeto = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Erro de domínio do cadastro vira 422 com a mensagem do front. */
const traduzir = (e) => (e instanceof CadastroInvalidoError ? regra(e.message) : e);

/** Gravação idempotente: efeito + auditoria + gf_operacoes numa transação. `producao(ex)` devolve `{ antes, depois, resposta }`. */
async function gravar(req, { escopo, operationKey, corpo, entidade, entidadeId, acao, producao, semAuditoria = false }) {
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  const conta = contaDaRequisicao(req);
  const perfil = resolverPerfil(req);
  if (!conta || !perfil) throw indisponivel();
  try {
    const r = await emTransacao(async (ex) => umaVez(ex, { escopo, chave: operationKey, corpo: { ...corpo, usuario: conta } }, async () => {
      const feito = await producao(ex);
      if (!semAuditoria) {
        await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
          { actorUserId: conta, actorRole: perfil, action: acao, entity: entidade, entityId: entidadeId, before: feito.antes, after: feito.depois },
          { id: randomUUID(), agora: Date.now(), chave: chaveAuditoria(escopo, operationKey) },
        ));
      }
      return feito.resposta;
    }));
    return r.resposta;
  } catch (erro) {
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY' || erro.code === '23505')) throw conflitoVersao();
    throw erro;
  }
}

module.exports = {
  negado, conflitoVersao, indisponivel, invalido, regra, naoEncontrado, quem, nomeDe, chaveOperacao, revisao, ehObjeto, traduzir, gravar, chaveAuditoria,
};
