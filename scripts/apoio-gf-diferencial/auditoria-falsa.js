'use strict';

/** Tabela `gf_auditoria` em memória para a ampliação do histórico (item 1, history-access): lê por chave ou id e insere. */

const COLUNAS = ['id', 'ocorrido_em', 'ator_conta_id', 'ator_funcao', 'acao', 'entidade', 'entidade_id', 'antes', 'depois', 'motivo', 'operation_key'];

function criarExecutorDeAuditoria() {
  const linhas = [];
  return {
    linhas,
    execute: async (sql, valores) => {
      const texto = sql.replace(/\s+/g, ' ').trim();
      if (/^INSERT INTO gf_auditoria/.test(texto)) {
        const linha = Object.fromEntries(COLUNAS.map((c, i) => [c, valores[i]]));
        if (linhas.some((l) => l.operation_key === linha.operation_key)) throw Object.assign(new Error('dup'), { code: 'ER_DUP_ENTRY' });
        linhas.push(linha);
        return [{ affectedRows: 1 }];
      }
      const m = /FROM gf_auditoria WHERE (operation_key|id) = \?$/.exec(texto);
      if (!m) throw new Error(`SQL não simulado: ${texto.slice(0, 80)}`);
      return [structuredClone(linhas.filter((l) => l[m[1]] === valores[0]))];
    },
  };
}

module.exports = { criarExecutorDeAuditoria };
