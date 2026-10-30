'use strict';

/**
 * Espelho de NOTA NOVA da ficha em `obs_liberacao_consulta` (legado primeiro, Maturacao/46 e 47 Q6). Flag `GF_LEGADO_NOTAS`. Só nota nova (edição não é espelhada).
 * `id_atendente` = `usuarios.id` do autor, lido de `gf_contas_ext.legacy_id` da conta da sessão. Sem esse vínculo (ou fora de nivel 2/99), texto acima de 500 ou
 * emoji: a nota é SALVA só no Postgres, `legado_estado = 'recusada'` com o motivo; nunca se inventa id. Legado fora do ar: 503 e nada é salvo.
 */

const legado = require('../../legado-escrita');
const lp = require('../../legado-escrita/legado-primeiro');
const intencoes = require('../../legado-escrita/intencoes');
const { contaDaRequisicao } = require('../../_comum/conta');
const { MapeamentoError } = legado.mapeamento;

async function nova(ex, req, nota, operationKey) {
  if (!lp.ativo('notas')) return { legadoId: null, estado: 'nao_espelhada', detalhe: null };
  const [c] = await ex.execute('SELECT legacy_id FROM gf_contas_ext WHERE user_id = ?', [contaDaRequisicao(req)]);
  let colunas;
  try { colunas = legado.notas.linhaDaNota(nota.text, nota.clientId, c[0] && c[0].legacy_id); } catch (e) { if (e instanceof MapeamentoError) return { legadoId: null, estado: 'recusada', detalhe: e.message }; throw e; }
  let intencaoId = null;
  try {
    const legadoId = await legado.emTransacao(async (lx) => {
      intencaoId = await intencoes.abrir({ entidade: 'pagamentos', entidadeId: nota.id, escopo: 'ficha.nota.gravar', operationKey, depois: { id_usuario: colunas.id_usuario, id_atendente: colunas.id_atendente } });
      return legado.notas.inserir(lx, colunas);
    }, { entidade: 'notas' });
    await intencoes.concluirNaTransacao(ex, intencaoId, legadoId);
    if (Array.isArray(ex.compensacoes)) ex.compensacoes.push(() => intencoes.marcar(intencaoId, 'divergente', `o Postgres falhou depois de o legado receber a nota (obs_liberacao_consulta ${legadoId}): decisão humana`, legadoId));
    return { legadoId, estado: 'espelhada', detalhe: 'inserida' };
  } catch (e) {
    if (intencaoId) await intencoes.marcar(intencaoId, 'revertida', `o legado não gravou: ${(e && (e.codigo || e.message)) || 'erro'}`);
    if (e instanceof MapeamentoError) return { legadoId: null, estado: 'recusada', detalhe: e.message };
    throw lp.falhaDoLegado(e);
  }
}

async function marcar(ex, id, d) {
  await ex.execute('UPDATE gf_clientes_notas SET legado_id = COALESCE(?, legado_id), legado_estado = ?, legado_detalhe = ?, legado_atualizado_em = CURRENT_TIMESTAMP WHERE id = ?', [d.legadoId ?? null, d.estado, d.detalhe ? String(d.detalhe).slice(0, 300) : null, id]);
}

module.exports = { nova, marcar };
