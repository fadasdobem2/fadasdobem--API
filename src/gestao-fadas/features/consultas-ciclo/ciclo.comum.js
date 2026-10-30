'use strict';

/**
 * Peças comuns da fatia Consulta: quem pode, erros no formato do contrato 28 e o executor de uma gravação idempotente
 * (efeito + auditoria + `gf_operacoes` na MESMA transação), igual ao `gravar` da Agenda. O instante (`agora`) é SEMPRE do servidor.
 */

const { randomUUID, createHash } = require('crypto');
const AppError = require('../../../utils/AppError');
const { resolverPerfil, permissoesDoPerfil } = require('../../_comum/politica-acesso');
const { AUDIT_INSERT, linhaDeAuditoria } = require('../../_comum/auditoria');
const { contaDaRequisicao } = require('../../_comum/conta');
const { emTransacao, escritaHabilitada } = require('../../novo/escritor');
const { umaVez, OperacaoConflitoError } = require('../../novo/operacoes');
const { RegraConsultaError } = require('../../_comum/dominio/consulta-comum');
const { PermissaoConsultaError } = require('../../_comum/dominio/consulta-revisao');

const COPIA_VERSAO = 'A consulta mudou. Confira a situação atual antes de continuar.'; // texto do front (consultations-experience.tsx:1607)
const negado = (escrita, mensagem) => new AppError(mensagem || (escrita ? 'Esta ação não está disponível para a sua função.' : 'Esta informação não está disponível para a sua função.'), 403, { codigo: 'ACCESS_DENIED', usarMensagem: Boolean(mensagem) }, true);
const conflitoVersao = (mensagem) => new AppError(mensagem || COPIA_VERSAO, 409, { codigo: 'VERSION_CHANGED', usarMensagem: true }, true);
const conflitoOcupacao = (mensagem) => new AppError(mensagem, 409, { codigo: 'OCCUPANCY_CONFLICT', usarMensagem: true }, true);
const regra = (mensagem) => new AppError(mensagem, 422, { codigo: 'RULE_VIOLATION' }, true);
const naoEncontrado = () => new AppError('Não encontrado.', 404, { codigo: 'NOT_FOUND' }, true);
const indisponivel = () => new AppError('Serviço indisponível.', 503, { codigo: 'SERVICE_UNAVAILABLE' }, true);

/**
 * Quem age: equipe (`canManageConsultations`; leitura `canViewConsultations`) ou a taróloga no `tarotId` da sessão.
 * `soEquipe` fecha para a taróloga. O nome é o da sessão (nunca o do corpo).
 */
function ator(req, { escrita = false, soEquipe = false } = {}) {
  const perfil = resolverPerfil(req);
  const p = perfil ? permissoesDoPerfil(perfil) : {};
  if (!perfil) throw negado(escrita);
  const equipe = perfil !== 'tarologa' && Boolean(escrita ? p.canManageConsultations : p.canViewConsultations);
  const tarologa = perfil === 'tarologa' && !soEquipe;
  if (!equipe && !tarologa) throw negado(escrita);
  const nome = `${(req.user && req.user.nome) || ''}`.trim().slice(0, 120) || (tarologa ? 'Tarólogo' : 'Atendimento');
  return { id: contaDaRequisicao(req), nome, perfil, permissoes: p, equipe, tarotIdProprio: perfil === 'tarologa' ? `${(req.user && req.user.tarotId) || ''}` : '' };
}

const chaveDeAuditoria = (escopo, chave) => `con:${createHash('sha256').update(`${escopo}:${chave}`).digest('hex').slice(0, 40)}`;

/** Erros do domínio viram HTTP: regra 422 (mensagem do front), permissão 403. */
function traduzir(erro) {
  if (erro instanceof RegraConsultaError) return regra(erro.message);
  if (erro instanceof PermissaoConsultaError) return negado(true, erro.message);
  return erro;
}

/** Uma gravação idempotente. `producao(ex)` devolve `{ antes, depois, resposta, entidadeId }`. */
async function gravar(req, a, { escopo, operationKey, corpo, acao, producao }) {
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  if (!a.id) throw indisponivel();
  let r;
  // Tarefas para DEPOIS do commit (o espelho no legado): nunca dentro da transação do Postgres, para um rollback não deixar sobra lá.
  const posteriores = [];
  const compensacoes = []; // legado primeiro (Maturacao/46): o que desfazer no legado se o Postgres falhar depois de ele ter recebido a escrita
  try {
    r = await emTransacao(async (ex) => umaVez(ex, { escopo, chave: operationKey, corpo: { ...corpo, usuario: a.id } }, async () => {
      ex.posCommit = posteriores; ex.compensacoes = compensacoes;
      const feito = await producao(ex);
      await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
        { actorUserId: a.id, actorRole: a.perfil, action: acao, entity: 'consulta', entityId: feito.entidadeId, before: feito.antes, after: feito.depois },
        { id: randomUUID(), agora: Date.now(), chave: chaveDeAuditoria(escopo, operationKey) },
      ));
      return feito.resposta;
    }));
  } catch (erro) {
    for (const desfazer of compensacoes) { try { await desfazer(); } catch (e) { console.error('[gf-consulta] desfazer do legado falhou:', (e && e.message) || e); } }
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY')) throw conflitoVersao();
    throw traduzir(erro);
  }
  if (!r.repetida) for (const tarefa of posteriores) { try { await tarefa(); } catch (e) { console.error('[gf-consulta] tarefa posterior falhou:', (e && e.message) || e); } }
  return r.resposta;
}

module.exports = { negado, conflitoVersao, conflitoOcupacao, regra, naoEncontrado, indisponivel, ator, gravar, traduzir, COPIA_VERSAO };
