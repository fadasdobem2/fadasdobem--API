'use strict';

/**
 * Regras que a API confere em cada comando da Agenda (mensagens iguais às `throw new Error` do front, para a tela mostrar o
 * mesmo texto). Funções puras: recebem o item de antes e o que o comando traz e lançam `ErroDeRegra` (422) ou `ErroDeVersao` (409).
 * Origem de cada regra, no front: contato `agenda/agenda-contact.ts`; observações `agenda/agenda-observations.ts:38-61`;
 * prazo combinado `agenda/agenda-requested-wait.ts:69-83`; saídas `agenda/agenda-transitions.ts:5-14`; plano de contato
 * `agenda/agenda-contact-plan.ts:25-37`; resolução `agenda/agenda-consultation-resolution.ts`.
 */

const { ETIQUETAS, ehDataCivil, contatoDe, encerrado, mesmoContato, limpar } = require('./agenda-contato');

class ErroDeRegra extends Error {}
class ErroDeVersao extends Error {}
const regra = (m) => new ErroDeRegra(m);

const MOTIVOS_CANCELAR = ['Desistiu', 'Sem resposta', 'Não quis esperar', 'Não pôde esperar', 'Recusou amanhã', 'Pediu estorno', 'Erramos o tarólogo'];
const MOTIVOS_TRANSFERIR = ['Pediu outro tarólogo', 'Não quis esperar', 'Não pôde esperar', 'Erramos o tarólogo', 'Desistiu'];
const MOTIVOS_TODOS = ['Desistiu', 'Sem resposta', 'Pediu outro tarólogo', 'Não quis esperar', 'Não pôde esperar', 'Recusou amanhã', 'Remarcou amanhã', 'Reagendou', 'Erramos o tarólogo', 'Pediu estorno'];
const INCIDENTES = ['Sem retorno', 'Ausente', 'Saiu cedo', 'Cliente desistiu/não podia', 'Lançamento errado', 'Não deu tempo', 'Tarólogo não respondeu', 'Tarólogo faltou'];
const RESOLUCOES_MANUAIS = ['Correspondência ignorada', 'Agendamento mantido', 'Agendamento editado', 'Restaurada na agenda', 'Correspondência invalidada'];

/** `normalizeAgendaClock` (agenda-contact-plan.ts:7): só relógio válido; texto livre nunca vira meia-noite. */
function relogio(bruto) {
  const m = `${bruto ?? ''}`.trim().match(/^(\d{1,2})(?:(?::|h)(\d{1,2})?)?$/i);
  if (!m) return null;
  const h = Number(m[1]); const mi = Number(m[2] || 0);
  return h <= 23 && mi <= 59 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}

/** `normalizedAgendaContactPlan` (agenda-contact-plan.ts:25): o combinado de contato, validado e limpo. */
function planoDeContato(plano) {
  if (!plano || typeof plano !== 'object' || !['staff', 'client'].includes(plano.who) || !['none', 'exact', 'approximate', 'after', 'shift'].includes(plano.timing)) throw regra('Confira o combinado de contato.');
  const saida = { who: plano.who, timing: plano.timing, ...(plano.callback ? { callback: true } : {}) };
  if (['exact', 'approximate', 'after'].includes(plano.timing)) {
    const hora = relogio(plano.time);
    if (!hora) throw regra('Informe um horário válido, como 20:00.');
    saida.time = hora;
  } else if (plano.timing === 'shift') {
    const ini = relogio(plano.shift && plano.shift.start); const fim = relogio(plano.shift && plano.shift.end);
    if (!ini || !fim || !(plano.shift.label || '').trim() || ini === fim) throw regra('Escolha um turno válido da profissional.');
    saida.shift = { label: plano.shift.label.trim(), start: ini, end: fim };
  }
  return saida;
}

/** O plano que o front guarda: validado como `normalizedAgendaContactPlan`, mas guardado COMO FOI enviado (o front também guarda o plano sem
 * normalizar quando só uma etiqueta muda, ex. `callback: false`); só as chaves do plano passam. */
function planoGuardado(plano) {
  planoDeContato(plano);
  const saida = { who: plano.who, timing: plano.timing };
  if (typeof plano.callback === 'boolean') saida.callback = plano.callback;
  if (typeof plano.time === 'string') saida.time = plano.time;
  if (plano.shift && typeof plano.shift === 'object') saida.shift = { label: plano.shift.label, start: plano.shift.start, end: plano.shift.end };
  return saida;
}

const listaDeEtiquetas = (v) => Array.isArray(v) && v.every((t) => ETIQUETAS.includes(t));

/** Evento novo de contato: etiqueta conhecida, tentativa e dia válidos, listas de antes e depois de etiquetas conhecidas. */
function eventoDeContato(e) {
  if (!(ETIQUETAS.includes(e.tag) || e.tag === 'Pago') || typeof e.active !== 'boolean' || !Number.isInteger(e.attempt) || e.attempt < 1 || !ehDataCivil(e.date)
    || !listaDeEtiquetas(e.before) || !listaDeEtiquetas(e.after)) throw regra('Não foi possível registrar o contato.');
}

/**
 * O contato vigente novo precisa seguir o antigo e ser coerente como o front o produz (`toggleAgendaTag`, `removeAgendaTag`,
 * `restoreAgendaContact`, `applyAgendaContactPlan`; provado com ouro nos 7.856 comandos de Maturacao/44):
 * tentativa nunca volta e sobe no máximo 1 por evento mais 1 (a restauração do contato não grava evento; editar movendo a conta duas vezes), etiquetas conhecidas e sem repetição, dia válido;
 * `agendaOutcome` é Concluída/Cancelada exatamente quando a etiqueta está no contato (e então há `resolvedAt`);
 * "Em consulta" no fluxo só com a etiqueta; o `after` do último evento é o contato novo.
 */
function contatoNovo(antes, depois, eventos = []) {
  const alvo = depois.contact;
  const c = contatoDe({ ...antes, contact: alvo });
  const subiu = alvo && Number.isInteger(alvo.attempt) ? alvo.attempt - contatoDe(antes).attempt : -1;
  if (!Number.isInteger(alvo && alvo.attempt) || subiu < 0 || subiu > eventos.length + 1 || !ehDataCivil(alvo.date) || !listaDeEtiquetas(alvo.tags) || c.tags.length > 12 || new Set(alvo.tags).size !== alvo.tags.length) throw regra('Não foi possível registrar o contato.');
  const desfecho = alvo.tags.includes('Concluída') ? 'Concluída' : alvo.tags.includes('Cancelada') ? 'Cancelada' : undefined;
  if (depois.agendaOutcome !== desfecho || (desfecho && !depois.resolvedAt) || (depois.workflowStatus === 'Em consulta') !== alvo.tags.includes('Em consulta')) throw regra('Não foi possível registrar o contato.');
  const ultimo = [...eventos].reverse().find((e) => e.tag !== 'Pediu estorno');
  if (ultimo && JSON.stringify([...ultimo.after].sort()) !== JSON.stringify([...alvo.tags].sort())) throw regra('Não foi possível registrar o contato.');
}

/** `applyAgendaContactPlan` (agenda-contact-plan.ts): com consulta em andamento o combinado não muda sem uma etiqueta nova (a mudança sem evento vem do combinado). */
function conferirPlanoEmConsulta(antes, novoPlano, eventosDeContato) {
  const emConsulta = antes.workflowStatus === 'Em consulta' || contatoDe(antes).tags.includes('Em consulta');
  if (!emConsulta || eventosDeContato.length) return;
  const atual = antes.contactPlan || planoLido(antes);
  const igual = (a, b) => JSON.stringify(limpar(planoDeContato(a))) === JSON.stringify(limpar(planoDeContato(b)));
  if (!igual(atual, novoPlano)) throw regra('Finalize a consulta em andamento antes de alterar o agendamento.');
}

/** `readAgendaContactPlan` (agenda-contact-plan.ts:18) para um item sem combinado. */
function planoLido(item) {
  const tags = (item.contact && item.contact.tags) || [];
  const exato = relogio(item.scheduledTime || ''); const aprox = relogio(item.requestedTime || '');
  return { who: tags.includes('Cliente vai chamar') ? 'client' : 'staff', timing: exato ? 'exact' : aprox ? 'approximate' : 'none', ...(exato || aprox ? { time: exato || aprox } : {}), callback: tags.includes('Chama depois') || tags.includes('Cliente vai chamar') };
}

const ETIQUETAS_DO_PLANO = ['Chamar cliente', 'Cliente vai chamar', 'Chama depois'];
function conferirContato(antes, eventos, esperado, grupo, mudouPlano = false) {
  if (esperado !== undefined && !mesmoContato(esperado, antes)) throw new ErroDeVersao('contact');
  // Item encerrado: só "Pediu estorno"; o combinado de contato (`applyAgendaContactPlan`) também mexe nas etiquetas do plano, e o front não o bloqueia.
  const permitida = (e) => e.tag === 'Pediu estorno' || (mudouPlano && ETIQUETAS_DO_PLANO.includes(e.tag));
  if (grupo === 'contato' && encerrado(antes) && eventos.some((e) => !permitida(e))) throw regra('Este agendamento já foi encerrado.');
  eventos.forEach(eventoDeContato);
}

/** Observações: máquina de estados de `changeAgendaObservation` (agenda-observations.ts:38-61). */
function conferirObservacoes(antes, depois, eventos) {
  const velhas = new Map((antes.observations || []).map((n) => [n.id, n]));
  const novas = new Map((depois.observations || []).map((n) => [n.id, n]));
  for (const [id, n] of velhas) if (!novas.has(id) || novas.get(id).id !== n.id) throw regra('Esta observação mudou. Confira o texto atualizado antes de salvar.');
  for (const e of eventos) {
    const nota = novas.get(e.observationId); const velha = velhas.get(e.observationId);
    if (!['add', 'edit', 'delete', 'restore'].includes(e.action) || !nota) throw regra('Não foi possível identificar esta alteração.');
    if (e.action === 'add') { if (velha) throw regra('Esta observação já existe.'); if (!`${nota.text || ''}`.trim()) throw regra('Escreva a observação antes de salvar.'); continue; }
    if (!velha) throw regra('Esta observação mudou. Confira o texto atualizado antes de salvar.');
    if (e.action === 'restore' ? !velha.deletedAt : Boolean(velha.deletedAt)) throw regra('Esta observação já mudou.');
    if (e.action === 'edit' && !`${nota.text || ''}`.trim()) throw regra('Escreva a observação antes de salvar.');
  }
  for (const n of novas.values()) if (typeof n.text !== 'string' || n.text.length > 8000) throw regra('Confira o texto da observação.');
}

/** Prazo combinado (agenda-requested-wait.ts:69-83): 1 a 1440 min, só acrescenta, item aberto, `expectedLatestId` confere. */
function conferirPrazo(antes, eventos, ultimoEsperado) {
  if (eventos.length !== 1) throw regra('Informe entre 1 e 1440 minutos.');
  const [e] = eventos;
  if (!Number.isSafeInteger(e.minutes) || e.minutes < 1 || e.minutes > 1440) throw regra('Informe entre 1 e 1440 minutos.');
  if (encerrado(antes) || antes.workflowStatus === 'Em consulta') throw regra('Este agendamento não está mais aguardando.');
  const historia = antes.requestedWaitHistory || [];
  const ultimo = historia.length ? historia[historia.length - 1].id : undefined;
  if (ultimo !== ultimoEsperado) throw new ErroDeVersao('requestedWait');
}

/** Saídas (agenda-transitions.ts): ação, motivo e incidente da lista do front; transferência leva o tarólogo novo, remarcação o dia novo. */
function conferirSaidas(antes, depois, eventos) {
  for (const d of eventos) {
    if (!['transfer', 'reschedule', 'cancel'].includes(d.action) || !MOTIVOS_TODOS.includes(d.reason) || (d.incident !== undefined && !INCIDENTES.includes(d.incident))) throw regra('Escolha o resultado do cancelamento.');
    if (d.action === 'cancel' && !MOTIVOS_CANCELAR.includes(d.reason)) throw regra('Escolha o resultado do cancelamento.');
    if (d.action === 'transfer' && (!MOTIVOS_TRANSFERIR.includes(d.reason) || !d.targetTarotId)) throw regra('Escolha o que o tarólogo verá.');
    if (d.action === 'reschedule' && !ehDataCivil(d.targetDate)) throw regra('Escolha uma data válida.');
    if (d.targetDate !== undefined && !ehDataCivil(d.targetDate)) throw regra('Escolha uma data válida.');
  }
  if (eventos.some((d) => d.action === 'cancel') && depois.agendaOutcome !== 'Cancelada' && !encerrado({ ...antes, ...depois })) throw regra('Este agendamento mudou. Feche e abra novamente para conferir.');
}

/** Resolução: só as decisões manuais; as que nascem da consulta dependem da fatia da Consulta. */
function conferirResolucao(eventos) {
  for (const e of eventos) {
    if (!RESOLUCOES_MANUAIS.includes(e.action)) throw regra('Esta resolução depende da consulta e ainda não está disponível.');
    if (typeof e.consultationId !== 'string' || typeof e.detail !== 'string') throw regra('Confira a decisão registrada.');
  }
}

module.exports = { ErroDeRegra, ErroDeVersao, MOTIVOS_CANCELAR, MOTIVOS_TRANSFERIR, MOTIVOS_TODOS, INCIDENTES, RESOLUCOES_MANUAIS, relogio, planoDeContato, planoGuardado, contatoNovo, conferirPlanoEmConsulta, conferirContato, conferirObservacoes, conferirPrazo, conferirSaidas, conferirResolucao };
