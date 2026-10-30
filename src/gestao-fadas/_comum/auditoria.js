'use strict';

/**
 * Trilha de auditoria em `gf_auditoria` (porte de features/integrations/payout-audit.ts do suspiro).
 * Cada gravação do Gestão Fadas escreve a sua linha DENTRO da mesma transação da operação.
 */

const { randomUUID } = require('crypto');

const COLUNAS = ['id', 'ocorrido_em', 'ator_conta_id', 'ator_funcao', 'acao', 'entidade', 'entidade_id', 'antes', 'depois', 'motivo', 'operation_key'];
const AUDIT_INSERT = `INSERT INTO gf_auditoria (${COLUNAS.join(', ')}) VALUES (${COLUNAS.map(() => '?').join(', ')})`;
const POR_CHAVE = `SELECT ${COLUNAS.join(', ')} FROM gf_auditoria WHERE operation_key = ?`;
const POR_ID = `SELECT ${COLUNAS.join(', ')} FROM gf_auditoria WHERE id = ?`;

class AuditoriaError extends Error {
  constructor(operacao, erro) {
    super(`auditoria ${operacao} falhou (${(erro && erro.code) || 'erro'})`);
    this.name = 'AuditoriaError';
    this.statusCode = 503;
    this.codigo = 'AUDITORIA_INDISPONIVEL';
    this.operacao = operacao;
  }
}

// `antes` e `depois` guardam JSON; o lado ausente fica NULL, nunca o texto "null".
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

/** Valores do AUDIT_INSERT, na ordem das colunas. */
function linhaDeAuditoria(fato, { id, agora, chave }) {
  return [id, agora, fato.actorUserId, fato.actorRole, fato.action, fato.entity, fato.entityId, json(fato.before), json(fato.after), fato.reason ?? null, chave];
}

function lerJson(texto) {
  if (texto === null || texto === undefined) return null;
  try {
    return JSON.parse(texto);
  } catch {
    throw new AuditoriaError('ler', { code: 'malformed-row' });
  }
}

function entrada(linha) {
  return {
    id: linha.id,
    actorUserId: linha.ator_conta_id,
    actorRole: linha.ator_funcao,
    action: linha.acao,
    entity: linha.entidade,
    entityId: linha.entidade_id,
    ...(linha.antes === null ? {} : { before: lerJson(linha.antes) }),
    ...(linha.depois === null ? {} : { after: lerJson(linha.depois) }),
    ...(linha.motivo === null ? {} : { reason: linha.motivo }),
    createdAt: new Date(Number(linha.ocorrido_em)).toISOString(),
  };
}

async function guardado(operacao, trabalho) {
  try {
    return await trabalho();
  } catch (erro) {
    if (erro instanceof AuditoriaError) throw erro;
    throw new AuditoriaError(operacao, erro);
  }
}

/** `executor` tem `execute(sql, valores) -> [linhas]` (ver models/legado/escrita.js). */
function criarAuditoria(executor, { agora = Date.now, novoId = randomUUID } = {}) {
  const primeira = async (sql, valor) => {
    const [linhas] = await executor.execute(sql, [valor]);
    return linhas[0] ? entrada(linhas[0]) : null;
  };
  return {
    /** Grava sem chave de operação: o `id` serve de chave. */
    adicionar: (fato) =>
      guardado('adicionar', async () => {
        const id = novoId();
        const ts = agora();
        await executor.execute(AUDIT_INSERT, linhaDeAuditoria(fato, { id, agora: ts, chave: id }));
        return { ...fato, id, createdAt: new Date(ts).toISOString() };
      }),
    /** Grava uma vez por chave; a chave já gravada devolve a linha guardada. */
    adicionarUmaVez: (fato, chave) =>
      guardado('adicionarUmaVez', async () => {
        const guardada = await primeira(POR_CHAVE, chave);
        if (guardada) return guardada;
        const valores = linhaDeAuditoria(fato, { id: novoId(), agora: agora(), chave });
        try {
          await executor.execute(AUDIT_INSERT, valores);
        } catch (erro) {
          const vencedora = await primeira(POR_CHAVE, chave);
          if (vencedora) return vencedora;
          throw erro;
        }
        return primeira(POR_ID, valores[0]);
      }),
    obter: (id) => guardado('obter', () => primeira(POR_ID, id)),
  };
}

module.exports = { AUDIT_INSERT, AuditoriaError, linhaDeAuditoria, criarAuditoria };
