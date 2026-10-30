'use strict';

/**
 * INTENÇÃO de espelho (anti-órfã). Gravada no Postgres, DENTRO da transação que cria/atualiza a consulta, ANTES de qualquer INSERT no
 * legado: `legado_estado = 'pendente'` + a chave natural no `legado_detalhe` (`#k=...`, ver legado-escrita/chave.js). Assim, se o
 * processo cair entre o INSERT no legado e a marcação do vínculo, o Postgres já diz "havia a intenção X" e a reconciliação
 * (`ciclo.reconciliacao.js`) procura a linha no legado pela chave antes de reinserir. Sem mudar nada na estrutura do legado.
 * Só vale para consulta ainda SEM vínculo; com `id_consulta_legado` o espelho é UPDATE e não há o que perder.
 */

const legado = require('../../legado-escrita');
const store = require('./ciclo.store');

const { chaveDaIntencao, lerDoDetalhe, detalheComChave } = legado.chave;

async function estadoDoEspelho(ex, id) {
  const [linhas] = await ex.execute('SELECT id_consulta_legado, legado_estado, legado_detalhe, legado_atualizado_em FROM gf_consultas_ext WHERE id = ?', [id]);
  return linhas[0] || null;
}

/** Chave a usar: a já fixada numa intenção anterior (preserva a de uma órfã possível) ou a do estado atual. `null` se a data é inválida. */
function escolherChave(linha, item) {
  const guardada = linha && lerDoDetalhe(linha.legado_detalhe);
  if (guardada) return guardada;
  try { return chaveDaIntencao(item); } catch (_) { return null; }
}

/** Marca a intenção na transação em curso. Nunca derruba a gravação da consulta: sem chave válida, só não marca (o `erro` explica depois). */
async function registrar(ex, id, item) {
  const linha = await estadoDoEspelho(ex, id);
  if (!linha || linha.id_consulta_legado) return false;
  const chave = escolherChave(linha, item);
  if (!chave) return false;
  await store.marcarLegado(ex, id, { estado: 'pendente', detalhe: detalheComChave('intenção de espelho', chave) });
  return true;
}

module.exports = { registrar, estadoDoEspelho, escolherChave };
