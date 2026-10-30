'use strict';

/**
 * Texto de boas-vindas com REVISÃO OTIMISTA em `gf_welcome` (banco novo): gravar exige a revisão que o editor leu; se outra
 * pessoa gravou antes, a revisão mudou e o resultado é conflito (sem sobrescrever). Primeira gravação: revisão lida 0.
 * Use dentro de `emTransacao`/`executarAvulso` (novo/escritor.js).
 */

const ID_PADRAO = 'principal';

class WelcomeConflitoError extends Error {
  constructor(atual) {
    super('welcome: a revisão mudou desde a leitura');
    this.name = 'WelcomeConflitoError';
    this.codigo = 'revision-conflict';
    this.revisaoAtual = atual;
  }
}

async function ler(executor, id = ID_PADRAO) {
  const [linhas] = await executor.execute('SELECT id, conteudo, revisao, atualizado_por, atualizado_em FROM gf_welcome WHERE id = ?', [id]);
  const l = linhas[0];
  return l ? { id: l.id, conteudo: JSON.parse(l.conteudo), revisao: Number(l.revisao), atualizadoPor: l.atualizado_por, atualizadoEm: l.atualizado_em } : null;
}

/** Grava `conteudo` se a revisão ainda é `revisaoLida`; devolve `{ revisao }` nova. */
async function gravar(executor, { id = ID_PADRAO, conteudo, revisaoLida, usuarioId }) {
  const texto = JSON.stringify(conteudo);
  if (!revisaoLida) {
    try {
      await executor.execute('INSERT INTO gf_welcome (id, conteudo, revisao, atualizado_por) VALUES (?, ?, 1, ?)', [id, texto, usuarioId]);
      return { revisao: 1 };
    } catch (erro) {
      if (erro && erro.errno === 1062) throw new WelcomeConflitoError(null);
      throw erro;
    }
  }
  const [r] = await executor.execute(
    'UPDATE gf_welcome SET conteudo = ?, revisao = revisao + 1, atualizado_por = ?, atualizado_em = CURRENT_TIMESTAMP WHERE id = ? AND revisao = ?',
    [texto, usuarioId, id, revisaoLida],
  );
  if (r.affectedRows !== 1) throw new WelcomeConflitoError((await ler(executor, id))?.revisao ?? null);
  return { revisao: revisaoLida + 1 };
}

module.exports = { ID_PADRAO, WelcomeConflitoError, ler, gravar };
