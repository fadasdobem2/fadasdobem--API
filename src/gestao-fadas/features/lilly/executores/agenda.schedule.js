'use strict';

/**
 * `schedule` (Maturacao/59, 5.2; Maturacao/60, item 7): traduz o payload da Lilly (as três formas) para o `POST /agenda` EXISTENTE
 * (`agenda.service.criar`: operationKey, trava de fila, restrições, admissão do painel). Nenhuma regra da agenda é repetida aqui.
 *  - fila geral = `tarologistId 'afila'` (`scope:'general'`); fila de tarólogo = ID real (`scope:'tarologist'`);
 *  - o dia operacional (06h-06h) é do servidor: sem `date` vale hoje; `date` no passado = 422 `LILLY_DATE_STALE`;
 *  - `position:'last'`: não se manda posição, a agenda calcula; o `result.position` é a posição natural REAL depois de inserido;
 *  - `paid_intake`: `paymentId` precisa existir, ser da mesma cliente, estar confirmado e não estar ligado a OUTRO agendamento;
 *  - cliente com agendamento aberto (qualquer fila) = 409 `LILLY_APPOINTMENT_EXISTS` (R5), conferido de novo sob trava;
 *  - `intakeId`, `paymentId`, `reason` e `confirmed` não cabem no item da agenda (grupos fechados): vão para a auditoria.
 * NÃO RESPONDIDO: semântica de `confirmed:false` (o agendamento é criado normalmente e a auditoria registra `confirmed:false`).
 */

const agenda = require('../../agenda/agenda.service');
const { rotuloDaCliente } = require('../../agenda/agenda-cliente');
const { hojeOperacional } = require('../../../_comum/dia-operacional');
const { registrar } = require('../acoes/acoes.registro');
const { provarAutorizacao } = require('./autorizacao');
const { posicaoNatural } = require('./posicao');
const { conferirBaseComVinculo, permitido, nao, FILA_GERAL } = require('./validacao.base');
const { recusar, ehObjeto, texto, sha, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const { avulso } = require('../dados/executor');

const MOTIVOS = ['paid_intake', 'client_accepted', 'silent_offer', 'staff_command'];
const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Payload -> pedido normalizado, ou `{ motivo }`/`{ motivo, code }` (recusa). */
function normalizar(acao, agora = new Date()) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  const tarologistId = texto(acao.tarologistId);
  if (!p) return { motivo: 'A ação não traz os dados do agendamento.' };
  if (!tarologistId) return { motivo: 'A ação não informa o tarólogo ou a fila.' };
  const geral = tarologistId === FILA_GERAL;
  if (p.scope !== undefined && p.scope !== (geral ? 'general' : 'tarologist')) return { motivo: 'O escopo do agendamento não confere com a fila escolhida.' };
  if (p.reason !== undefined && !MOTIVOS.includes(p.reason)) return { motivo: 'Motivo de agendamento desconhecido.' };
  if (p.position !== undefined && p.position !== 'last') return { motivo: 'Só é possível agendar no fim da fila.' };
  if (p.channel !== undefined && (typeof p.channel !== 'string' || !p.channel.trim() || p.channel.length > 40)) return { motivo: 'O canal informado é inválido.' };
  if (p.minutes !== undefined && p.minutes !== null && (!Number.isInteger(p.minutes) || p.minutes < 1 || p.minutes > 1440)) return { motivo: 'Os minutos devem ser um inteiro de 1 a 1440.' };
  const hoje = hojeOperacional(agora);
  const date = p.date === undefined ? hoje : p.date;
  if (typeof date !== 'string' || !DATA.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) return { motivo: 'A data do agendamento é inválida.' };
  if (date < hoje) return { motivo: 'O dia operacional já virou. Releia a fila antes de agendar.', code: 'LILLY_DATE_STALE' };
  const pago = p.reason === 'paid_intake';
  if (pago && (!texto(p.paymentId) || !texto(p.intakeId))) return { motivo: 'O agendamento pago precisa do atendimento (intakeId) e do pagamento (paymentId).' };
  return {
    pedido: { tarologistId, geral, date, hoje, channel: texto(p.channel) || undefined, minutes: p.minutes ?? undefined, reason: p.reason, confirmed: p.confirmed !== false, paymentId: texto(p.paymentId) || undefined, intakeId: texto(p.intakeId) || undefined, comProposta: p.proposalId !== undefined || p.authorizedEventId !== undefined },
  };
}

/** Pagamento do atendimento pago: existe, é da cliente, está de pé e não está ligado a outro agendamento. `null` = ok. */
async function conferirPagamento(executor, clientId, pedido, idAgenda) {
  const [linhas] = await executor.execute('SELECT id_cliente, status, confirmacao FROM gf_pagamentos WHERE id = ?', [pedido.paymentId]);
  const l = linhas[0];
  if (!l || l.id_cliente !== clientId) return 'O pagamento informado não existe ou é de outra cliente.';
  if (l.status === 'Cancelado' || l.confirmacao === 'A confirmar') return 'O pagamento informado ainda não está confirmado.';
  const [usos] = await executor.execute("SELECT entidade_id FROM gf_auditoria WHERE acao = 'lilly.schedule' AND motivo = ?", [`payment:${pedido.paymentId}`]);
  return usos.some((u) => u.entidade_id !== idAgenda) ? 'Este pagamento já está ligado a outro agendamento.' : null;
}

async function agendamentoAberto(executor, clientId) {
  const [linhas] = await executor.execute('SELECT id, id_tarologo FROM gf_agenda WHERE id_cliente = ? AND agenda_outcome IS NULL ORDER BY numero_publico', [clientId]);
  return linhas[0] || null;
}

async function restrita(executor, clientId, tarologistId) {
  if (`${process.env.GF_FATIA_RESTRICOES || ''}`.trim().toLowerCase() !== 'true' || tarologistId === FILA_GERAL) return false;
  const [l] = await executor.execute('SELECT id FROM gf_restricoes WHERE id_cliente = ? AND id_tarologo = ? AND ativa = true LIMIT 1', [clientId, tarologistId]);
  return Boolean(l[0]);
}

function registrarSchedule() {
  registrar('schedule', {
    async validar(acao) {
      const { pedido, motivo } = normalizar(acao);
      if (motivo) return nao(motivo);
      const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirTarologo: true, exigirConta: true });
      if (recusa) return recusa;
      if (pedido.comProposta) { const a = await provarAutorizacao(avulso, acao); if (a.motivo) return nao(a.motivo); }
      const aberto = await agendamentoAberto(avulso, `${acao.clientId}`);
      if (aberto) return nao('A cliente já tem um agendamento em aberto.');
      if (await restrita(avulso, `${acao.clientId}`, pedido.tarologistId)) return nao('Esta cliente não pode ser agendada com este tarólogo (restrição ativa).');
      if (pedido.paymentId) { const m = await conferirPagamento(avulso, `${acao.clientId}`, pedido, ''); if (m) return nao(m); }
      return permitido(acao);
    },
    async executar(acao, { executor, chave }) {
      const { pedido, motivo, code } = normalizar(acao);
      if (motivo) recusar(code || 'INVALID_INPUT', motivo);
      const clientId = `${acao.clientId}`;
      await executor.execute('SELECT pg_advisory_xact_lock(hashtext(?))', [`gf_lilly:agenda:${clientId}`]);
      const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirTarologo: true, exigirConta: true, executor });
      if (recusa) recusar('LILLY_SCHEDULE_NOT_ALLOWED', recusa.reason);
      if (pedido.comProposta) { const a = await provarAutorizacao(executor, acao); if (a.motivo) recusar('LILLY_AUTHORIZATION_MISSING', a.motivo); }
      const id = `AG-${sha(chave.interna).slice(0, 40)}`;
      const aberto = await agendamentoAberto(executor, clientId);
      if (aberto && aberto.id !== id) recusar('LILLY_APPOINTMENT_EXISTS', `A cliente já tem um agendamento em aberto (${aberto.id}).`, 409);
      if (pedido.paymentId) { const m = await conferirPagamento(executor, clientId, pedido, id); if (m) recusar('LILLY_PAYMENT_NOT_USABLE', m, 409); }
      let resposta = null;
      if (!aberto) {
        const set = { observation: 'Sem observações.', ...(pedido.channel ? { channel: pedido.channel } : {}), ...(pedido.minutes ? { requestedMinutes: pedido.minutes } : {}) };
        resposta = await chamarServico(async () => agenda.criar(pedidoDeServico({
          body: { operationKey: chaveDaOperacao(chave, 'agenda'), id, tarotId: pedido.tarologistId, clientId, client: await rotuloDaCliente(clientId), date: pedido.date, set },
        })));
      }
      const posicao = await posicaoNatural(executor, { id, tarotId: pedido.tarologistId, hoje: pedido.hoje }) ?? (resposta && resposta.agenda[0].position);
      await auditar(executor, chave, {
        acao: 'schedule', entidade: 'agenda', entidadeId: id, motivo: pedido.paymentId ? `payment:${pedido.paymentId}` : undefined,
        depois: { tarologistId: pedido.tarologistId, date: pedido.date, position: posicao, reason: pedido.reason, confirmed: pedido.confirmed, intakeId: pedido.intakeId, paymentId: pedido.paymentId, conversationId: acao.conversationId },
      });
      return { id, position: posicao, clientId, tarologistId: pedido.tarologistId };
    },
  });
}

module.exports = { registrarSchedule, normalizar };
