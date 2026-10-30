'use strict';

/**
 * Registro das escritas no legado feitas ANTES do commit do Postgres (`gf_legado_intencoes`, Maturacao/46). Cada linha é gravada numa transação
 * PRÓPRIA do Postgres (conexão separada da transação do pedido), de propósito: se o pedido for desfeito, o registro de que o legado chegou a
 * receber algo continua lá, e a reconciliação (`reconciliacao.js`) sabe o que fazer. Estados: iniciada (antes da escrita), concluida (o
 * commit do pedido confirmou), revertida (o Postgres falhou e o legado voltou ao valor anterior), divergente (o Postgres falhou e o legado NÃO pôde
 * ser desfeito: decisão humana) e recusada (a trava de banco barrou). Nunca guarda segredo; só nomes de coluna e valores do cadastro.
 */

const { randomUUID } = require('crypto');
const { emTransacao } = require('../novo/escritor');

const aparar = (t, n = 300) => (t === undefined || t === null ? null : String(t).slice(0, n));
const json = (v) => (v === undefined || v === null ? null : JSON.stringify(v));

/** Abre a intenção (transação própria). Devolve o id. */
async function abrir({ entidade, entidadeId, escopo, operationKey, legadoId, antes, depois }) {
  const id = randomUUID();
  await emTransacao((ex) => ex.execute(
    'INSERT INTO gf_legado_intencoes (id, entidade, entidade_id, escopo, operation_key, legado_id, antes, depois, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, entidade, String(entidadeId), aparar(escopo, 80), aparar(operationKey, 128), aparar(legadoId, 20), json(antes), json(depois), 'iniciada'],
  ));
  return id;
}

/** Muda o estado numa transação própria (depois de um desfazer, por exemplo). Nunca lança: o que falhar só é logado. */
async function marcar(id, estado, detalhe, legadoId) {
  try {
    await emTransacao((ex) => ex.execute(
      'UPDATE gf_legado_intencoes SET estado = ?, detalhe = ?, legado_id = COALESCE(?, legado_id), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?',
      [estado, aparar(detalhe), aparar(legadoId, 20), id],
    ));
  } catch (e) { console.error('[gf-legado.intencao] não marcou', estado, ':', (e && e.message) || e); }
}

/** Concluída, DENTRO da transação do pedido (confirma junto com o efeito; se o pedido for desfeito, a linha fica `iniciada`). */
async function concluirNaTransacao(ex, id, legadoId) {
  await ex.execute('UPDATE gf_legado_intencoes SET estado = ?, legado_id = COALESCE(?, legado_id), atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', ['concluida', aparar(legadoId, 20), id]);
}

/** Auditoria da trava de banco: uma linha `recusada` (transação própria). */
async function registrarRecusa({ banco, motivo, instrucao }) {
  await emTransacao((ex) => ex.execute(
    'INSERT INTO gf_legado_intencoes (id, entidade, entidade_id, estado, detalhe, depois) VALUES (?, ?, ?, ?, ?, ?)',
    [randomUUID(), 'trava', aparar(banco || 'desconhecido', 64), 'recusada', aparar(motivo), json({ instrucao })],
  ));
}

/** `iniciada` antes de `corte` (ISO). Só leitura. */
async function antigas(corte, limite = 50) {
  return emTransacao(async (ex) => {
    const [l] = await ex.execute(
      "SELECT id, entidade, entidade_id, escopo, operation_key, legado_id, antes, depois FROM gf_legado_intencoes WHERE estado = 'iniciada' AND atualizado_em < ? ORDER BY atualizado_em, id LIMIT ?", [corte, limite],
    );
    const lerJson = (v) => (typeof v === 'string' ? JSON.parse(v) : v || null);
    return l.map((x) => ({ ...x, antes: lerJson(x.antes), depois: lerJson(x.depois) }));
  });
}

/** O pedido desta intenção chegou a ser registrado (`gf_operacoes`)? Então o commit aconteceu. */
async function pedidoConfirmado(escopo, operationKey) {
  if (!escopo || !operationKey) return false;
  return emTransacao(async (ex) => { const [l] = await ex.execute('SELECT 1 AS x FROM gf_operacoes WHERE escopo = ? AND chave = ?', [escopo, operationKey]); return l.length > 0; });
}

/** Contagem por estado (o resumo do comando offline). */
async function resumo() {
  return emTransacao(async (ex) => {
    const [l] = await ex.execute('SELECT estado, COUNT(*) AS n FROM gf_legado_intencoes GROUP BY estado ORDER BY estado', []);
    return Object.fromEntries(l.map((x) => [x.estado, Number(x.n)]));
  });
}

module.exports = { abrir, marcar, concluirNaTransacao, registrarRecusa, antigas, pedidoConfirmado, resumo };
