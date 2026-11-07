'use strict';

/**
 * Contato do pedido de agendamento (domínio puro), v706 da Nice. Enquanto o pedido não vira agendamento, ele usa o mesmo estado de contato da
 * Agenda (tentativa, etiquetas, retorno). Porte de `consultation-request-contact.ts`, `request-client-link-undo.ts` e
 * `consultation-request-time.ts`. Ouro: scripts/gerar-ouro-gf-agenda-pedido.js.
 */

const { contatoDe, encerrado } = require('./agenda-contato');
const { lerPlano } = require('./agenda-etiqueta');
const { etapaDoPedido, agendamentoLigado } = require('./agenda-pedido-registro');

const CONTATADAS = ['Avisada', 'Avisar de novo', 'Pode agora', 'Não respondeu', 'Vai pagar', 'Não pode agora', 'Cliente vai chamar', 'Chama depois', 'Não voltou', 'Próximo turno'];
/** `agendaHasPreviousContact` (agenda-contact.ts:21). */
const temContatoAnterior = (item) => contatoDe(item).tags.some((t) => CONTATADAS.includes(t)) || Boolean((item.contactHistory || []).some((e) => e.active && CONTATADAS.includes(e.tag)));

const ETIQUETAS_DO_PEDIDO = Object.freeze(['Avisada', 'Pode agora', 'Não respondeu', 'Não voltou', 'Não pode agora', 'Cliente vai chamar']);

/** A projeção nunca entra na fila: só alimenta os controles de contato compartilhados. */
function itemDeContatoDoPedido(pedido, agenda) {
  const ligado = agendamentoLigado(pedido, agenda);
  if (ligado) return ligado;
  return {
    id: `request:${pedido.id}`, requestId: pedido.id, tarotId: pedido.tarotId, clientId: pedido.clientId, leadId: pedido.clientId ? undefined : pedido.contactId,
    client: pedido.client || (pedido.submittedIdentity && pedido.submittedIdentity.name) || 'Nome a confirmar', date: pedido.date, time: pedido.requestedTime || '',
    requestedTime: pedido.requestedTime, position: 0, channel: pedido.channel || '', requestedMinutes: pedido.requestedMinutes, observation: pedido.note, response: 'Aguardando resposta',
    contact: pedido.contact ?? { attempt: 1, date: pedido.date, tags: ['asked', 'confirmed'].includes(etapaDoPedido(pedido)) ? ['Avisada'] : [] },
    contactHistory: pedido.contactHistory, contactPlan: pedido.contactPlan, contactReturn: pedido.contactReturn, contactReturnHistory: pedido.contactReturnHistory,
  };
}

function etapaDeContato(pedido, item) {
  const etapa = etapaDoPedido(pedido);
  if (etapa === 'confirmed' || etapa === 'descheduled') return etapa;
  return temContatoAnterior(item) && contatoDe(item).tags.some((t) => !['Chamar cliente', 'Avisar de novo'].includes(t)) ? 'asked' : 'ask';
}

const camposDeContato = (item) => ({ contact: item.contact, contactHistory: item.contactHistory, contactPlan: item.contactPlan, contactReturn: item.contactReturn, contactReturnHistory: item.contactReturnHistory });

/** Leva o contato uma única vez ao vincular o agendamento real; depois, o agendamento é a fonte canônica. */
function adotarContatoDoPedido(item, pedido) {
  if (encerrado(item) || (item.contactHistory || []).length || contatoDe(item).tags.length) return item;
  const origem = itemDeContatoDoPedido(pedido, []);
  if (!(origem.contactHistory || []).length && !origem.contact.tags.length) return item;
  return { ...item, ...camposDeContato(origem), contactPlan: origem.contactPlan ? { ...lerPlano(item), who: origem.contactPlan.who, callback: origem.contactPlan.callback } : item.contactPlan };
}

/** Falta de ID de cliente não prova que a equipe não encontrou a pessoa. */
const semIdentidadeLocalizada = (pedido) => !pedido.clientId && etapaDoPedido(pedido) === 'ask' && (pedido.identityNotFound === true || pedido.readerInquiry === 'not_located');
function erroDeConsultaAoTarologo(pedido, situacao) {
  if (pedido.clientId || etapaDoPedido(pedido) !== 'ask') return 'A identificação com o tarólogo só está disponível antes de Perguntamos.';
  if (situacao && situacao !== 'not_located' && !semIdentidadeLocalizada(pedido)) return 'Marque Não encontrada antes de perguntar ao tarólogo.';
  return undefined;
}
const pedidoPodeConfirmar = (pedido) => Boolean(pedido.clientId) && ['asked', 'confirmed'].includes(etapaDoPedido(pedido));

/** Desfazer a identificação nunca move pagamento nem consulta existente para um contato. */
function erroAoDesfazerVinculo(contato, agenda, consultas, pagamentos, clientIdEsperado) {
  const foto = contato.clientLinkSnapshot;
  if (!contato.clientId || !foto) return 'Este vínculo não possui uma identificação anterior que possa ser restaurada.';
  if (foto.clientId !== contato.clientId || (clientIdEsperado && clientIdEsperado !== contato.clientId)) return 'O vínculo mudou. Confira o cadastro antes de desfazer.';
  const ligados = agenda.filter((r) => r.sourceLeadId === contato.id || foto.agendaIds.includes(r.id));
  if (ligados.some((r) => r.clientId !== contato.clientId || r.leadId || r.sourceLeadId !== contato.id)) return 'A identificação da agenda mudou. Confira o vínculo antes de desfazer.';
  const ids = new Set([...foto.agendaIds, ...ligados.map((r) => r.id)]);
  if (consultas.some((r) => r.agendaItemId && ids.has(r.agendaItemId))) return 'Já existe uma consulta vinculada a este agendamento. A equipe precisa conferir a identificação; o vínculo não pode ser desfeito aqui.';
  if (ligados.some((r) => r.resolvedByConsultationId || r.workflowStatus === 'Em consulta' || r.paymentAmount || r.paymentPending || r.unlinkedPaymentAmount || r.refundRequest)
    || pagamentos.some((r) => (r.movements || []).some((m) => m.agendaItemId && ids.has(m.agendaItemId)))) return 'Este agendamento já possui uma operação financeira ou uma consulta. Confira a identificação antes de desfazer o vínculo.';
  return '';
}

/** Completa uma hora cheia só ao terminar de editar, nunca enquanto digita os minutos. */
function normalizarHorarioDoPedido(valor) {
  const t = valor.trim();
  if (/^\d{1,2}$/.test(t) && Number(t) <= 23) return `${t.padStart(2, '0')}:00`;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (m && Number(m[1]) <= 23 && Number(m[2]) <= 59) return `${m[1].padStart(2, '0')}:${m[2]}`;
  return t;
}

/** Máscara do campo de horário: só dígitos, HH:MM. */
function mascararHorarioDoPedido(valor) {
  const d = valor.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}

module.exports = { mascararHorarioDoPedido, ETIQUETAS_DO_PEDIDO, temContatoAnterior, itemDeContatoDoPedido, etapaDeContato, camposDeContato, adotarContatoDoPedido, semIdentidadeLocalizada, erroDeConsultaAoTarologo, pedidoPodeConfirmar, erroAoDesfazerVinculo, normalizarHorarioDoPedido };
