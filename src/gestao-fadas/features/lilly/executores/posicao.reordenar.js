'use strict';

/**
 * `reorder_appointment` (Lilly v710, docs/banco/22 §6): corrige a POSIÇÃO de um agendamento pelo comando de ordem EXISTENTE
 * (`POST /agenda/queues/:tarotId/order`, `agenda-ordem.service.js`: impressão `queue-v1`, conflito entre comandos, histórico). Só muda `positionOverrides`
 * e o comando de ordem (nunca identidade, data, horário, cliente, consulta ou pagamento).
 * Antes: revisão do snapshot, assinatura da linha (sha256 do JSON da linha do contexto), revisão e lista da fila (`appointmentPositionQuotes`), atendente
 * autorizada provada em evento resolvido pela API, posição inteira entre 1 e o tamanho da fila, agendamento fora de consulta. Uma SIMULAÇÃO local
 * confirma que a ordem pedida é a que o comparador do painel vai produzir; se não for, nada é gravado.
 */

const ordem = require('../../agenda/agenda-ordem.service');
const { hojeOperacional } = require('../../../_comum/dia-operacional');
const { registrar } = require('../acoes/acoes.registro');
const leituras = require('../dados/leituras.v710');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const v = require('../v710/comum');
const fila = require('../v710/fila');
const { ordemDoTarologo } = require('../v710/ordem');
const { revisaoAtual } = require('../contexto/revisao');
const { avulso } = require('../dados/executor');

function normalizar(acao) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados da correção.' };
  const appointmentId = texto(p.appointmentId);
  if (!v.ID.test(appointmentId)) return { motivo: 'Informe o agendamento.' };
  if (!Number.isInteger(p.position) || p.position < 1) return { motivo: 'A posição precisa ser um inteiro a partir de 1.' };
  if (!Number.isSafeInteger(p.expectedRevision)) return { motivo: 'A ação precisa da revisão lida no contexto (expectedRevision, inteiro).' };
  if (typeof p.expectedQueueRevision !== 'string' || !p.expectedQueueRevision) return { motivo: 'A ação precisa da revisão da fila (expectedQueueRevision).' };
  if (typeof p.expectedAppointment !== 'string' || !p.expectedAppointment) return { motivo: 'A ação precisa da impressão do agendamento (expectedAppointment).' };
  const ids = p.orderedAppointmentIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || !ids.every((x) => typeof x === 'string' && x) || new Set(ids).size !== ids.length || !ids.includes(appointmentId)) return { motivo: 'A lista da fila é inválida.' };
  if (!v.autorValido(p.author)) return { motivo: 'A correção exige a atendente autenticada.' };
  const sourceEventId = texto(p.sourceEventId);
  if (!sourceEventId || texto(p.sourceConversationId) !== texto(acao.conversationId)) return { motivo: 'A origem da correção não confere com a conversa da ação.' };
  if (!texto(acao.tarologistId)) return { motivo: 'A ação não informa o tarólogo.' };
  return { appointmentId, position: p.position, expectedRevision: p.expectedRevision, expectedQueueRevision: p.expectedQueueRevision, expectedAppointment: p.expectedAppointment, ids, author: { id: p.author.id.trim(), name: p.author.name.trim() }, sourceEventId };
}

async function avaliar(acao, executor) {
  const n = normalizar(acao);
  const ruim = (code, motivo, status = 422) => ({ recusa: { code, motivo, status } });
  if (n.motivo) return ruim('INVALID_INPUT', n.motivo);
  const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirTarologo: true, exigirConta: true, executor });
  if (recusa) return ruim('LILLY_POSITION_NOT_ALLOWED', recusa.reason);
  try {
    await v.provarOrigem(executor, { ref: n.sourceEventId, tipo: 'staff', autorId: n.author.id, clientId: acao.clientId, conversationId: texto(acao.conversationId) });
    await v.exigirRevisao(n.expectedRevision, 'A agenda mudou. Confira novamente a posição antes de salvar.');
  } catch (e) { if (e && e.code) return ruim(e.code, e.message, e.status); throw e; }
  const linha = await leituras.agendamentoPorId(n.appointmentId);
  if (!linha) return ruim('LILLY_APPOINTMENT_NOT_FOUND', 'Agendamento não encontrado.', 404);
  if (linha.id_cliente !== `${acao.clientId}` || linha.id_tarologo !== `${acao.tarologistId}` || linha.agenda_outcome) return ruim('LILLY_APPOINTMENT_NOT_ALLOWED', 'O agendamento não é desta cliente e deste tarólogo, ou já foi encerrado.');
  const agora = Date.now(); const hoje = hojeOperacional(new Date(agora));
  const o = await ordemDoTarologo(linha.id_tarologo, { agora, hoje });
  if (o.consultas.some((c) => fila.emConsulta([c], linha.id))) return ruim('LILLY_STATE_CHANGED', 'O agendamento já está em consulta.', 409);
  if (!o.ordem.includes(linha.id)) return ruim('LILLY_STATE_CHANGED', 'O agendamento não está na fila ordenável.', 409);
  const linhaDoContexto = v.agendamentoDoContexto(linha, { agora, ordem: o.ordem });
  if (v.impressaoDaLinha(linhaDoContexto) !== n.expectedAppointment) return ruim('LILLY_APPOINTMENT_CHANGED', 'O agendamento mudou desde a leitura.', 409);
  if (o.revisao !== n.expectedQueueRevision || JSON.stringify(o.ordem) !== JSON.stringify(n.ids)) return ruim('LILLY_QUEUE_CHANGED', 'A fila mudou. Confira novamente a posição antes de salvar.', 409);
  if (n.position > o.ordem.length) return ruim('LILLY_POSITION_INVALID', 'Escolha uma posição disponível na fila.');
  if (o.ordem.indexOf(linha.id) + 1 === n.position) return ruim('LILLY_STATE_CHANGED', 'O agendamento já está nessa posição.', 409);
  const novosIds = o.ordem.filter((id) => id !== linha.id); novosIds.splice(n.position - 1, 0, linha.id);
  const escopo = fila.escopoDoDia(hoje);
  const ranks = fila.ranksDaMudanca(o.itens, novosIds, escopo);
  // Simulação: a ordem que o comparador do painel dará DEPOIS de gravar tem de ser a pedida.
  const simulados = require('../../../_comum/dominio/painel-ordem').reordenar(o.itens, novosIds, escopo, true);
  const depois = fila.ordemVigente(simulados, o.consultas, { agora, hoje });
  if (depois.indexOf(linha.id) + 1 !== n.position) return ruim('LILLY_POSITION_UNSAFE', 'A fila não garante essa posição pelas regras atuais. Confira no painel.');
  return { n, linha, o, novosIds, ranks };
}

function registrarReordenar() {
  registrar('reorder_appointment', {
    async validar(acao) {
      const r = await avaliar(acao, avulso);
      return r.recusa ? nao(r.recusa.motivo) : permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const r = await avaliar(acao, executor);
      if (r.recusa) recusar(r.recusa.code, r.recusa.motivo, r.recusa.status);
      const { n, linha, o, novosIds, ranks } = r;
      const operationKey = chaveDaOperacao(chave, 'posicao');
      await chamarServico(() => ordem.ordenar(pedidoDeServico({
        params: { tarotId: linha.id_tarologo },
        nome: n.author.name,
        body: { operationKey, commandId: `lilly-${v.sha([chave.interna, n.appointmentId]).slice(0, 40)}`, baseRevision: o.revisao, movedId: linha.id, beforeIds: o.ordem, afterIds: novosIds, ranks },
      })));
      const agora = Date.now(); const hoje = hojeOperacional(new Date(agora));
      const depois = await ordemDoTarologo(linha.id_tarologo, { agora, hoje });
      const linhaDepois = await leituras.agendamentoPorId(n.appointmentId);
      const resultado = {
        id: n.appointmentId, appointmentId: n.appointmentId, position: depois.ordem.indexOf(n.appointmentId) + 1, clientId: `${acao.clientId}`, tarologistId: `${acao.tarologistId}`,
        revision: await revisaoAtual(), queueRevision: depois.revisao, version: Number(linhaDepois.version),
      };
      // A simulação acima já garantiu a posição pedida; se ainda assim divergir, o resultado devolve a posição REAL e a Lilly não anuncia sucesso.
      await auditar(executor, chave, { acao: 'reorder_appointment', entidade: 'agenda', entidadeId: n.appointmentId, antes: { position: o.ordem.indexOf(n.appointmentId) + 1 }, depois: { ...resultado, author: n.author, sourceEventId: n.sourceEventId } });
      return resultado;
    },
  });
}

module.exports = { registrarReordenar, normalizar };
