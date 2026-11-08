'use strict';

/**
 * `request_more_time` (Lilly v708, docs/banco/21 §5 da Nice): REGISTRA que a cliente vai pedir mais tempo numa consulta ativa. Não aumenta minutos,
 * não cria cobrança e não encerra a consulta (`gf_consultas_ext` e `gf_pagamentos` nem são tocados; a tabela impede `altera_duracao` e
 * `encerra_consulta` verdadeiros). Um ciclo por pedido: o mesmo evento repetido (webhook, outra chave) devolve o mesmo registro; um pedido
 * POSTERIOR na mesma consulta abre outro ciclo e preserva o anterior; um mais antigo ou igual ao último não reabre nada.
 * Exige consulta "Em curso" da MESMA cliente e do MESMO tarólogo. Payload: consultationId, clientId, tarologistId, requestedAt, sourceEventId,
 * sourceConversationId, label, changesDuration:false, closeConsultation:false.
 */

const { registrar } = require('../acoes/acoes.registro');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, sha, auditar } = require('./executores.comum');
const { avulso } = require('../dados/executor');
const cfg = require('./executores.config');

const ROTULO_PADRAO = 'Pediu mais tempo';
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
const MARGEM_FUTURO_MS = 5 * 60 * 1000;

/** `{ motivo }` ou `{ pedido }` com o payload já conferido na forma. */
function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados do pedido de mais tempo.' };
  const consultationId = texto(p.consultationId);
  const clientId = texto(`${acao.clientId ?? p.clientId ?? ''}`);
  const tarologistId = texto(`${acao.tarologistId ?? p.tarologistId ?? ''}`);
  if (!consultationId || consultationId.length > 64) return { motivo: 'Informe a consulta do pedido de mais tempo.' };
  if (!clientId || !tarologistId) return { motivo: 'Informe a cliente e o profissional do pedido de mais tempo.' };
  for (const [campo, valor] of [['clientId', p.clientId], ['tarologistId', p.tarologistId]]) {
    const daAcao = campo === 'clientId' ? acao.clientId : acao.tarologistId;
    if (valor !== undefined && daAcao !== undefined && daAcao !== null && `${valor}` !== `${daAcao}`) return { motivo: `${campo} do pedido não confere com o da ação.` };
  }
  const sourceEventId = texto(p.sourceEventId);
  if (!sourceEventId || sourceEventId.length > 200) return { motivo: 'Informe o evento de origem do pedido.' };
  if (p.sourceConversationId !== undefined && texto(p.sourceConversationId) !== texto(acao.conversationId)) return { motivo: 'A conversa de origem não confere com a da ação.' };
  const requestedAt = texto(p.requestedAt);
  if (!INSTANTE.test(requestedAt) || Number.isNaN(Date.parse(requestedAt))) return { motivo: 'requestedAt precisa ser um instante válido.' };
  if (Date.parse(requestedAt) > Date.now() + MARGEM_FUTURO_MS) return { motivo: 'requestedAt está no futuro.' };
  // Contrato: o pedido NUNCA muda a duração nem encerra a consulta. Ausente ou verdadeiro = recusa (não se presume).
  if (p.changesDuration !== false || p.closeConsultation !== false) return { motivo: 'Pedir mais tempo não altera minutos nem encerra a consulta: changesDuration e closeConsultation precisam ser false.' };
  const label = p.label === undefined ? ROTULO_PADRAO : texto(p.label);
  if (!label || label.length > 60) return { motivo: 'label inválido.' };
  return { pedido: { consultationId, clientId, tarologistId, sourceEventId, requestedAt: new Date(requestedAt).toISOString(), label, conversationId: texto(acao.conversationId) } };
}

/** A consulta ativa da cliente e do profissional. `{ motivo }` ou `{}`. */
async function conferirConsulta(executor, pedido) {
  const [l] = await executor.execute('SELECT id_cliente, id_tarologo, status FROM gf_consultas_ext WHERE id = ?', [pedido.consultationId]);
  if (!l[0]) return { motivo: 'Consulta não encontrada no Gestão.' };
  if (l[0].status !== 'Em curso') return { motivo: 'O pedido de mais tempo só vale para uma consulta em curso.' };
  if (l[0].id_cliente !== pedido.clientId || l[0].id_tarologo !== pedido.tarologistId) return { motivo: 'A consulta não é desta cliente com este profissional.' };
  return {};
}

const resultado = (l) => ({
  id: l.id, consultationId: l.consulta_id, cycle: Number(l.ciclo), requestedAt: new Date(l.solicitado_em).toISOString(), label: l.rotulo, changesDuration: false, closeConsultation: false,
});

function registrarMaisTempo() {
  registrar('request_more_time', {
    async validar(acao) {
      if (!cfg.contaDeServico()) return nao('A conta de serviço da Lilly não está configurada no Gestão.');
      const n = normalizar(acao); if (n.motivo) return nao(n.motivo);
      const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, vinculoOpcional: true, exigirTarologo: true });
      if (recusa) return recusa;
      const c = await conferirConsulta(avulso, n.pedido); if (c.motivo) return nao(c.motivo);
      return permitido(acao, { consultationId: n.pedido.consultationId });
    },
    async executar(acao, { executor, chave }) {
      const n = normalizar(acao); if (n.motivo) recusar('INVALID_INPUT', n.motivo);
      const pedido = n.pedido;
      const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, vinculoOpcional: true, exigirTarologo: true, executor });
      if (recusa) recusar('LILLY_MORE_TIME_NOT_ALLOWED', recusa.reason);
      await executor.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_lilly_mais_tempo:${pedido.consultationId}`]);
      const c = await conferirConsulta(executor, pedido); if (c.motivo) recusar('LILLY_MORE_TIME_CONSULTATION_INVALID', c.motivo);
      const [mesmo] = await executor.execute('SELECT * FROM gf_lilly_mais_tempo WHERE source_event_id = ?', [pedido.sourceEventId]);
      if (mesmo[0]) return { ...resultado(mesmo[0]), duplicate: true }; // o mesmo evento (webhook repetido, outra chave): nunca outro ciclo
      const [ultimo] = await executor.execute('SELECT * FROM gf_lilly_mais_tempo WHERE consulta_id = ? ORDER BY ciclo DESC LIMIT 1', [pedido.consultationId]);
      if (ultimo[0] && Date.parse(pedido.requestedAt) <= new Date(ultimo[0].solicitado_em).getTime()) return { ...resultado(ultimo[0]), duplicate: true }; // fora de ordem: não reabre
      const ciclo = ultimo[0] ? Number(ultimo[0].ciclo) + 1 : 1;
      const id = `MT-${sha(`${pedido.consultationId}|${ciclo}`).slice(0, 40)}`;
      await executor.execute(
        `INSERT INTO gf_lilly_mais_tempo (id, consulta_id, ciclo, id_cliente, id_tarologo, solicitado_em, source_event_id, source_conversation_id, rotulo, altera_duracao, encerra_consulta)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, FALSE)`,
        [id, pedido.consultationId, ciclo, pedido.clientId, pedido.tarologistId, pedido.requestedAt, pedido.sourceEventId, pedido.conversationId, pedido.label],
      );
      await auditar(executor, chave, {
        acao: 'request_more_time', entidade: 'consulta', entidadeId: pedido.consultationId, antes: ciclo > 1 ? { ciclo: ciclo - 1 } : null,
        depois: { ciclo, requestedAt: pedido.requestedAt, clientId: pedido.clientId, tarologistId: pedido.tarologistId, sourceEventId: pedido.sourceEventId, conversationId: pedido.conversationId },
      });
      return { id, consultationId: pedido.consultationId, cycle: ciclo, requestedAt: pedido.requestedAt, label: pedido.label, changesDuration: false, closeConsultation: false };
    },
  });
}

module.exports = { registrarMaisTempo, normalizar };
