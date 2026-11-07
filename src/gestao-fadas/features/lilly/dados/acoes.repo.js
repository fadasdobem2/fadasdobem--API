'use strict';

/** `gf_lilly_acoes`: guarda de idempotência e conciliação (chave interna única, chave original preservada, hash estável do corpo). */

const { lerJson, gravarJson, iso } = require('./executor');

const COLUNAS = 'chave_interna, chave_original, hash_corpo, kind, estado, resultado, evento_origem, criado_em, atualizado_em';

const paraObjeto = (l) => l && ({
  chaveInterna: l.chave_interna,
  chaveOriginal: l.chave_original,
  hash: l.hash_corpo,
  kind: l.kind,
  estado: l.estado,
  resultado: lerJson(l.resultado),
  eventoOrigem: l.evento_origem,
  criadoEm: iso(l.criado_em),
  atualizadoEm: iso(l.atualizado_em),
});

/** Reserva a chave no estado 'em_execucao'. Devolve `true` se esta chamada criou a linha. */
async function reservar(executor, { chaveInterna, chaveOriginal, hash, kind, eventoOrigem = null }) {
  const [r] = await executor.execute(
    `INSERT IGNORE INTO gf_lilly_acoes (chave_interna, chave_original, hash_corpo, kind, estado, evento_origem) VALUES (?, ?, ?, ?, 'em_execucao', ?)`,
    [chaveInterna, chaveOriginal, hash, kind, eventoOrigem],
  );
  return r.affectedRows === 1;
}

/** Lê a ação; `travar` bloqueia a linha até o fim da transação (FOR UPDATE). */
async function lerAcao(executor, chaveInterna, { travar = false } = {}) {
  const [linhas] = await executor.execute(`SELECT ${COLUNAS} FROM gf_lilly_acoes WHERE chave_interna = ?${travar ? ' FOR UPDATE' : ''}`, [chaveInterna]);
  return paraObjeto(linhas[0]) || null;
}

async function mudarEstado(executor, chaveInterna, estado, resultado) {
  await executor.execute(
    'UPDATE gf_lilly_acoes SET estado = ?, resultado = ?, atualizado_em = CURRENT_TIMESTAMP WHERE chave_interna = ?',
    [estado, gravarJson(resultado), chaveInterna],
  );
}

const confirmar = (executor, chave, resultado) => mudarEstado(executor, chave, 'confirmada', resultado);
const recusar = (executor, chave, recusa) => mudarEstado(executor, chave, 'recusada', recusa);
const marcarIncerta = (executor, chave, detalhe) => mudarEstado(executor, chave, 'incerta', detalhe ?? null);

module.exports = { reservar, lerAcao, confirmar, recusar, marcarIncerta };
