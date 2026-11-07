'use strict';

/**
 * `remove_appointment` e `reschedule` (Maturacao/59, 5.1 itens 8 e 9), pelos comandos EXISTENTES da agenda, sempre com `expectedVersion`
 * lido na hora e a autorização humana provada (`autorizacao.js`):
 *  - `remove_appointment` -> `POST /agenda/:id/departures` com saída `cancel` (fecha o item como Cancelada e PRESERVA o histórico;
 *    o `preserveHistory:true` é obrigatório). NÃO RESPONDIDO: o motivo do cancelamento; usa "Desistiu" (um dos motivos do painel);
 *  - `reschedule` -> `PATCH /agenda/:id` mudando o dia (posição nova calculada pelo servidor e ordem manual limpa; admissão do dia
 *    repetida pela agenda). Devolve `{ date, position }`, a posição natural real.
 * O agendamento tem de ser da cliente e do tarólogo da ação e estar aberto.
 */

const agenda = require('../../agenda/agenda.service');
const store = require('../../agenda/agenda.store');
const { contatoDe, encerrado, proximaPosicao } = require('../../../_comum/dominio/agenda-contato');
const { hojeOperacional } = require('../../../_comum/dia-operacional');
const { registrar } = require('../acoes/acoes.registro');
const { provarAutorizacao } = require('./autorizacao');
const { posicaoNatural } = require('./posicao');
const { conferirBaseComVinculo, permitido, nao } = require('./validacao.base');
const { recusar, ehObjeto, texto, sha, chaveDaOperacao, pedidoDeServico, chamarServico, auditar } = require('./executores.comum');
const { avulso } = require('../dados/executor');

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Agendamento sem trava (o serviço da agenda trava na própria transação). */
async function lerAgendamento(executor, id) {
  const [linhas] = await executor.execute('SELECT id, numero_publico, item, version FROM gf_agenda WHERE id = ?', [id]);
  return linhas[0] ? { item: store.paraItem(linhas[0]), version: Number(linhas[0].version) } : null;
}

/** Normaliza o payload; `{ motivo }` é a recusa. */
function normalizar(acao, kind, agora = new Date()) {
  const p = ehObjeto(acao.payload) ? acao.payload : null;
  if (!p) return { motivo: 'A ação não traz os dados do agendamento.' };
  const appointmentId = texto(p.appointmentId);
  if (!/^[A-Za-z0-9._:-]{1,64}$/.test(appointmentId)) return { motivo: 'Informe o agendamento.' };
  if (p.preserveHistory !== true) return { motivo: 'A retirada e a remarcação precisam preservar o histórico.' };
  const hoje = hojeOperacional(agora);
  if (kind === 'reschedule') {
    if (typeof p.date !== 'string' || !DATA.test(p.date) || Number.isNaN(Date.parse(`${p.date}T12:00:00Z`))) return { motivo: 'Informe a nova data (AAAA-MM-DD).' };
    if (p.date < hoje) return { motivo: 'A nova data já passou. Escolha hoje ou uma data futura.', code: 'LILLY_DATE_STALE' };
  }
  return { appointmentId, date: p.date, hoje };
}

/** O agendamento existe, é da cliente/tarólogo da ação e está aberto. `{ motivo }` ou `{ reg }`. */
async function conferirAgendamento(executor, acao, appointmentId) {
  const reg = await lerAgendamento(executor, appointmentId);
  if (!reg) return { motivo: 'Agendamento não encontrado.', status: 404 };
  if (reg.item.clientId !== `${acao.clientId}`) return { motivo: 'O agendamento é de outra cliente.' };
  if (acao.tarologistId && reg.item.tarotId !== `${acao.tarologistId}`) return { motivo: 'O agendamento é de outro tarólogo ou fila.' };
  if (encerrado(reg.item)) return { motivo: 'Este agendamento já foi encerrado.', status: 409 };
  return { reg };
}

const comando = (nome, kind) => ({
  async validar(acao) {
    const n = normalizar(acao, kind); if (n.motivo) return nao(n.motivo);
    const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirConta: true });
    if (recusa) return recusa;
    const a = await provarAutorizacao(avulso, acao); if (a.motivo) return nao(a.motivo);
    const c = await conferirAgendamento(avulso, acao, n.appointmentId); if (c.motivo) return nao(c.motivo);
    return permitido(acao);
  },
  async executar(acao, { executor, chave }) {
    const n = normalizar(acao, kind); if (n.motivo) recusar(n.code || 'INVALID_INPUT', n.motivo);
    const { recusa } = await conferirBaseComVinculo(acao, { exigirCliente: true, exigirVinculo: true, exigirConta: true, executor });
    if (recusa) recusar('LILLY_APPOINTMENT_NOT_ALLOWED', recusa.reason);
    const a = await provarAutorizacao(executor, acao); if (a.motivo) recusar('LILLY_AUTHORIZATION_MISSING', a.motivo);
    const c = await conferirAgendamento(executor, acao, n.appointmentId); if (c.motivo) recusar('LILLY_APPOINTMENT_NOT_ALLOWED', c.motivo, c.status || 422);
    const { item, version } = c.reg;
    const operationKey = chaveDaOperacao(chave, nome);
    const agora = new Date().toISOString();
    let resultado;
    if (kind === 'remove_appointment') {
      const c0 = contatoDe(item);
      const saida = { id: `dep-${sha(chave.interna).slice(0, 24)}`, tarotId: item.tarotId, date: item.date, originDate: item.date, action: 'cancel', reason: 'Desistiu', actor: 'Lilly', at: agora };
      await chamarServico(() => agenda.comando(pedidoDeServico({
        params: { id: item.id }, body: { operationKey, expectedVersion: version, set: { agendaOutcome: 'Cancelada', resolvedAt: agora, contact: { attempt: c0.attempt + 1, date: c0.date, tags: ['Cancelada'] }, workflowStatus: 'Concluída' }, append: { departures: [saida] } },
      }), 'saidas'));
      resultado = { id: item.id, removed: true, preservedHistory: true };
    } else {
      const c0 = contatoDe(item);
      const abertos = await store.abertosDe(executor, [item.tarotId]);
      const position = proximaPosicao(abertos.filter((i) => i.id !== item.id), item.tarotId, n.date, n.hoje);
      const historia = { id: `sh-${sha(chave.interna).slice(0, 24)}`, actor: 'Lilly', at: agora, before: { date: item.date }, after: { date: n.date } };
      await chamarServico(() => agenda.comando(pedidoDeServico({
        params: { id: item.id }, body: { operationKey, expectedVersion: version, set: { date: n.date, position, contact: { attempt: c0.attempt, date: n.date, tags: [] } }, unset: ['positionOverrides'], append: { scheduleHistory: [historia] } },
      }), 'agendamento'));
      resultado = { id: item.id, date: n.date, position: await posicaoNatural(executor, { id: item.id, tarotId: item.tarotId, hoje: n.hoje }) ?? position };
    }
    await auditar(executor, chave, {
      acao: kind, entidade: 'agenda', entidadeId: item.id, antes: { version, date: item.date }, depois: { ...resultado, ...a.dados, conversationId: acao.conversationId },
    });
    return resultado;
  },
});

function registrarAlteracoesDeAgenda() {
  registrar('remove_appointment', comando('remocao', 'remove_appointment'));
  registrar('reschedule', comando('remarcacao', 'reschedule'));
}

module.exports = { registrarAlteracoesDeAgenda, normalizar, lerAgendamento };
