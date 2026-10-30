'use strict';

/**
 * Peças comuns da fatia Agenda (e da Ordem da fila): quem pode, erros no formato do contrato 28 e o executor de uma gravação
 * idempotente (efeito + auditoria + `gf_operacoes` na MESMA transação), igual ao `gravar` de Horários.
 */

const { randomUUID, createHash } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil, permissoesDoPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');

const negado = (escrita) => new AppError(escrita ? 'Esta ação não está disponível para a sua função.' : 'Esta informação não está disponível para a sua função.', 403, { codigo: 'ACCESS_DENIED' }, true);
// `usarMensagem`: o gate devolve este texto (o do front) em vez do padrão de VERSION_CHANGED.
const conflitoVersao = (mensagem) => new AppError(mensagem || 'Este agendamento mudou. Feche e abra novamente para conferir.', 409, { codigo: 'VERSION_CHANGED', usarMensagem: true }, true);
const regra = (mensagem) => new AppError(mensagem, 422, { codigo: 'RULE_VIOLATION' }, true);
const naoEncontrado = () => new AppError('Não encontrado.', 404, { codigo: 'NOT_FOUND' }, true);
const indisponivel = () => new AppError('Serviço indisponível.', 503, { codigo: 'SERVICE_UNAVAILABLE' }, true);

/** Equipe que opera a Agenda (`canViewAgenda` / `canManageConsultations`). A taróloga fica de fora desta fatia (agenda própria é outra tela). */
function ator(req, escrita, { aceitaTarologa = false } = {}) {
  const perfil = resolverPerfil(req);
  const p = perfil ? permissoesDoPerfil(perfil) : {};
  const autorizado = aceitaTarologa ? Boolean(p.canViewOwnAgenda) : escrita ? Boolean(p.canManageConsultations) : Boolean(p.canViewAgenda);
  if (!perfil || !autorizado) throw negado(escrita);
  const nome = `${(req.user && req.user.nome) || ''}`.trim() || 'Atendimento';
  return { id: contaDaRequisicao(req), nome, perfil };
}

const chaveDeAuditoria = (escopo, chave) => `agd:${createHash('sha256').update(`${escopo}:${chave}`).digest('hex').slice(0, 40)}`;

/**
 * Uma gravação idempotente. `producao(ex)` faz o efeito e devolve `{ antes, depois, resposta, entidadeId }`; um `resposta.__recusa`
 * (`{ codigo, mensagem, status }`) confirma o que `producao` gravou (a recusa registrada) e só então responde o erro.
 */
async function gravar(req, a, { escopo, operationKey, corpo, acao, producao }) {
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  if (!a.id) throw indisponivel();
  let r;
  try {
    r = await emTransacao(async (ex) => umaVez(ex, { escopo, chave: operationKey, corpo: { ...corpo, usuario: a.id } }, async () => {
      const feito = await producao(ex);
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: a.id, actorRole: a.perfil, action: acao, entity: 'agenda', entityId: feito.entidadeId, before: feito.antes, after: feito.depois },
        { id: randomUUID(), agora: Date.now(), chave: chaveDeAuditoria(escopo, operationKey) },
      ));
      return feito.resposta;
    }));
  } catch (erro) {
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY')) throw conflitoVersao();
    throw erro;
  }
  const recusa = r.resposta && r.resposta.__recusa;
  if (recusa) throw new AppError(recusa.mensagem, recusa.status, { codigo: recusa.codigo, usarMensagem: true }, true);
  return r.resposta;
}

module.exports = { negado, conflitoVersao, regra, naoEncontrado, indisponivel, ator, gravar };
