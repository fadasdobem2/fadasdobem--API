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
async function gravar(req, { escopo, operationKey, corpo, entidade, entidadeId, acao, producao, semAuditoria = false, comContas = false }) {
  if (!escritaHabilitada()) throw new AppError('Gravação desligada neste ambiente.', 503, { codigo: 'WRITE_DISABLED' }, true);
  const conta = contaDaRequisicao(req);
  const perfil = resolverPerfil(req);
  if (!conta || !perfil) throw indisponivel();
  // Tarefas para DEPOIS do commit (espelho no legado, Maturacao/45): nunca dentro da transação do Postgres.
  const posteriores = [];
  // Desfazer do legado (Maturacao/46): se o Postgres falhar DEPOIS de o legado ter recebido a escrita (legado primeiro), estas tarefas devolvem o legado ao valor anterior.
  const compensacoes = [];
  try {
    // `comContas`: a mesma conexão também dá a transação das tabelas da A (`users`, `refresh_tokens`), como em Contas (contas.banco.js).
    const rodar = comContas ? require('../contas/contas.banco').emTransacaoContas : (fn) => emTransacao((ex) => fn(ex));
    const r = await rodar(async (ex, t) => umaVez(ex, { escopo, chave: operationKey, corpo: { ...corpo, usuario: conta } }, async () => {
      ex.posCommit = posteriores; ex.compensacoes = compensacoes;
      const feito = await producao(ex, t);
      if (!semAuditoria) {
        await ex.execute(AUDIT_INSERT, linhaDeAuditoria(
          { actorUserId: conta, actorRole: perfil, action: acao, entity: entidade, entityId: entidadeId, before: feito.antes, after: feito.depois },
          { id: randomUUID(), agora: Date.now(), chave: chaveAuditoria(escopo, operationKey) },
        ));
      }
      return feito.resposta;
    }));
    if (!r.repetida) for (const tarefa of posteriores) { try { await tarefa(); } catch (e) { console.error('[gf-cadastros] tarefa posterior falhou:', (e && e.message) || e); } }
    return r.resposta;
  } catch (erro) {
    for (const desfazer of compensacoes) { try { await desfazer(); } catch (e) { console.error('[gf-cadastros] desfazer do legado falhou:', (e && e.message) || e); } }
    if (erro instanceof OperacaoConflitoError) throw new AppError('Esta operação já foi registrada com outros dados.', 409, { codigo: 'OPERATION_KEY_CONFLICT' }, true);
    if (erro && (erro.errno === 1062 || erro.code === 'ER_DUP_ENTRY' || erro.code === '23505')) throw conflitoVersao();
    throw erro;
  }
}

module.exports = {
  negado, conflitoVersao, indisponivel, invalido, regra, naoEncontrado, quem, nomeDe, chaveOperacao, revisao, ehObjeto, traduzir, gravar, chaveAuditoria,
};
