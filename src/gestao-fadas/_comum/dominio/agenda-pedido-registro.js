'use strict';

/**
 * Registro do pedido de agendamento (domínio puro), v706 da Nice. Porte de `features/agenda/agenda-intake-model.ts`:
 * `agendaRequestStage`, `agendaRequestPending`, `validIntakeTime`, `validIntakeDate`, `normalizeAgendaIntakeRecord`,
 * `agendaRequestChangeProvenance`, `linkedRequestAppointment`, `requestAppointment`, `eligibleRequestAppointment`.
 * Ouro: scripts/gerar-ouro-gf-agenda-pedido.js. Etapas do pedido: ask (Perguntar) -> asked (Perguntamos) -> confirmed; descheduled é o resultado de Desagendar.
 */

const { encerrado, ativoNoDia } = require('./agenda-contato');
const { pedidoCombinaComIdentidade } = require('./agenda-identidade');
const { mesmaOcorrencia } = require('./agenda-ocorrencia');
const { normalizarWhatsapp, proximoCodigoDeContato, contatoAtivo } = require('./agenda-pedido-identidade');

const ETAPAS = Object.freeze(['ask', 'asked', 'confirmed', 'descheduled']);
const etapaDoPedido = (pedido) => pedido.stage ?? 'ask';
const pedidoPendente = (pedido) => ['ask', 'asked'].includes(etapaDoPedido(pedido));
const horarioValido = (v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const dataValida = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const NOTA_DE_EXEMPLO = 'Exemplo de demonstração: pedido de consulta informado por Osíris.';

/** Recupera contatos sem dono, sem reabrir um arquivado de propósito; a identidade enviada nunca é trocada. */
function normalizarRegistro(valor) {
  const contatos = (Array.isArray(valor.contacts) ? valor.contacts : []).map((c) => ({
    ...c, history: c.history || [],
    archived: Boolean(c.clientId || (c.archived && (c.archiveReason || c.archivedAt || (c.referral === true && c.classification !== 'identification_pending')))),
  }));
  const pedidos = valor.requests.map((pedido) => {
    let contato = contatos.find((c) => c.id === pedido.contactId);
    if (!contato && pedido.clientId) contato = contatos.find((c) => c.clientId === pedido.clientId);
    const clientId = pedido.clientId || (contato && contato.clientId) || '';
    if (contato && clientId) { contato.clientId = contato.clientId || clientId; contato.classification = 'client'; contato.archived = true; }
    const enviada = pedido.submittedIdentity;
    const submittedIdentity = { clientId: (enviada && enviada.clientId) ?? pedido.clientId ?? '', name: (enviada && enviada.name) || pedido.client || (contato && contato.name) || '', whatsapp: (enviada && enviada.whatsapp) || (contato && contato.whatsapp) || '' };
    if (!contato && !clientId && etapaDoPedido(pedido) !== 'descheduled') {
      const fone = normalizarWhatsapp(submittedIdentity.whatsapp);
      const iguais = fone ? contatos.filter((c) => contatoAtivo(c) && normalizarWhatsapp(c.whatsapp) === fone) : [];
      if (iguais.length === 1) contato = iguais[0];
      else if (fone && iguais.length === 0 && submittedIdentity.name.trim()) {
        contato = { id: pedido.contactId || `intake-contact:request:${pedido.id}`, name: submittedIdentity.name.trim(), whatsapp: fone, source: 'reader_request', sourceTarotId: pedido.tarotId, referral: pedido.referral === true, createdAt: pedido.at, classification: pedido.referral ? 'lead' : 'identification_pending', history: [{ id: `${pedido.id}:submitted`, action: 'Pedido recebido', at: pedido.at, by: 'Registro anterior', requestId: pedido.id }], archived: false };
        contatos.push(contato);
      }
    }
    return {
      ...pedido, ...(pedido.note === NOTA_DE_EXEMPLO ? { note: '' } : {}), clientId, submittedIdentity, contactId: contato ? contato.id : pedido.contactId,
      identityStatus: clientId ? 'client' : contato && contatoAtivo(contato) ? 'contact' : 'pending', stage: etapaDoPedido(pedido),
      history: pedido.history ?? [{ id: `${pedido.id}:submitted`, action: 'submitted', at: pedido.at, by: 'Registro anterior' }],
    };
  });
  for (const c of contatos.filter(contatoAtivo).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) if (!c.displayCode) c.displayCode = proximoCodigoDeContato(contatos);
  return {
    ...valor, contacts: contatos,
    requests: pedidos.map((pedido) => { const c = contatos.find((x) => x.id === pedido.contactId); return { ...pedido, contactCode: pedido.clientId ? undefined : c && contatoAtivo(c) ? c.displayCode : undefined }; }),
  };
}

/** O observador registra o autor e o instante da agenda; abrir a página nunca o torna autor. */
function procedenciaDaMudanca(item, acao, observadoEm) {
  const ativos = (item.departures || []).filter((e) => !e.restored);
  const eventos = acao === 'descheduled' ? ativos.filter((e) => e.action === 'cancel').map((e) => ({ actor: e.actor, at: e.at }))
    : acao === 'rescheduled' ? [...(item.scheduleHistory || []).map((e) => ({ actor: e.actor, at: e.at })), ...ativos.filter((e) => ['reschedule', 'transfer'].includes(e.action)).map((e) => ({ actor: e.actor, at: e.at }))]
      : acao === 'agenda_closed' ? (item.resolutionHistory || []).filter((e) => ['Agendamento concluído', 'Consulta gerada'].includes(e.action)).map((e) => ({ actor: e.actor, at: e.createdAt }))
        : item.createdAt ? [{ actor: item.createdBy || 'Sistema', at: item.createdAt }] : [];
  const ultimo = eventos.filter((e) => Number.isFinite(Date.parse(e.at))).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  return { by: (ultimo && ultimo.actor) || 'Sistema', at: (ultimo && ultimo.at) || observadoEm };
}

const agendamentoLigado = (pedido, agenda) => agenda.find((i) => i.requestId === pedido.id || i.id === pedido.agendaId);

/** Sem vínculo explícito, só vale um único agendamento aberto da mesma pessoa e profissional no dia do pedido. */
function agendamentoDoPedido(pedido, agenda, agora = Date.now()) {
  const explicito = agendamentoLigado(pedido, agenda);
  if (explicito) return explicito;
  const iguais = agenda.filter((i) => i.tarotId === pedido.tarotId && pedidoCombinaComIdentidade(pedido, i) && !encerrado(i) && ativoNoDia(i, pedido.date, pedido.date) && mesmaOcorrencia(i, pedido, pedido.date, agora));
  return iguais.length === 1 ? iguais[0] : undefined;
}

/** Conciliar a identidade pode anexar um agendamento existente, nunca criar nem mover um. */
function agendamentoElegivel(pedido, agenda, consultas = [], agora = Date.now()) {
  const explicito = agendamentoLigado(pedido, agenda);
  if (explicito) return pedidoCombinaComIdentidade(pedido, explicito) ? explicito : undefined;
  if (etapaDoPedido(pedido) === 'descheduled') return undefined;
  const iguais = agenda.filter((i) => pedidoCombinaComIdentidade(pedido, i) && i.tarotId === pedido.tarotId && !encerrado(i) && ativoNoDia(i, pedido.date, pedido.date) && mesmaOcorrencia(i, pedido, pedido.date, agora));
  if (iguais.length !== 1) return undefined;
  const c = iguais[0];
  if (c.workflowStatus === 'Em consulta' || consultas.some((v) => v.agendaItemId === c.id && v.status === 'Em curso')) return undefined;
  return c;
}

module.exports = { ETAPAS, etapaDoPedido, pedidoPendente, horarioValido, dataValida, normalizarRegistro, procedenciaDaMudanca, agendamentoLigado, agendamentoDoPedido, agendamentoElegivel };
