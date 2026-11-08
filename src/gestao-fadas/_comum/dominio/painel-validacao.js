'use strict';

/**
 * Painel, validações de destino (domínio puro, Maturacao/39). Porte versionado do CÓDIGO do front `painel/panel-flow-model.ts`:
 * `validateGeneralMatch` (:252), `validateGeneralConsultationLaunch` (:257), `validateGeneralDestination` (:267) e `validateGeneralScheduling`
 * (:311), mais `agenda/agenda-launch-eligibility.ts` (`agendaLaunchBlock`). As mensagens são as do front, na mesma ordem de checagem.
 * Lança `RegraDoPainelError` (o serviço a traduz em 422). Relógio injetado: `entrada.now`.
 * Entrada: a de `fluxoDoPainel` mais `restrictions` (linhas ativas `{ active, clientId, tarotId }`).
 */

const { contatoDe, encerrado, ativoNoDia } = require('./agenda-contato');
const { mesmaIdentidade } = require('./agenda-identidade');
const b = require('./fila-geral-base');
const adm = require('./admissao');
const c = require('./consulta-comum');
const { estaRestrita } = require('./restricoes');
const q = require('./painel-fila-geral');
const t = require('./painel-tempo');
const { fluxoDoPainel } = require('./painel-fluxo');
const { bloqueioDeLancamento } = require('./painel-bloqueio');
const { equipeDePresenca } = require('./painel-presenca');
const { exigirSemDuplicidade, DuplicidadeDeAgendaError } = require('./agenda-duplicidade');
const { exigirSemConflitoDaFilaGeral, ConflitoDaFilaGeralError } = require('./fila-geral-conflitos');

class RegraDoPainelError extends Error { constructor(mensagem) { super(mensagem); this.name = 'RegraDoPainelError'; } }
const recusar = (mensagem) => { throw new RegraDoPainelError(mensagem); };

/** `assertNoAgendaDuplicate` + `assertNoGeneralQueueConflict` (Site v710): a mensagem é a do front; o erro vira `RegraDoPainelError`. */
function exigirDestinoLivre(entrada, item, candidato, nomeDaProfissional) {
  const opcoes = { hoje: entrada.date, agora: entrada.now };
  try {
    exigirSemDuplicidade(entrada.agenda, candidato, { ...opcoes, excluirId: item.id, nomeDaProfissional: nomeDaProfissional(candidato.tarotId) });
    exigirSemConflitoDaFilaGeral(entrada.agenda, item, candidato, { ...opcoes, nomeDaProfissional });
  } catch (e) { if (e instanceof DuplicidadeDeAgendaError || e instanceof ConflitoDaFilaGeralError) recusar(e.message); throw e; }
}
const nomeDoPerfil = (entrada) => (id) => { const p = (entrada.profiles || []).find((r) => r.id === id); return p ? p.name : undefined; };

/** `validateGeneralDestination`: `lancamentoDaEquipe` = `staffLaunch`. */
function validarDestinoGeral(entrada, itemId, tarotId, aprovacao, lancamentoDaEquipe) {
  const { date: data, now: agora } = entrada;
  const item = entrada.agenda.find((i) => i.id === itemId);
  if (estaRestrita(entrada.restrictions || [], item && item.clientId, tarotId)) recusar('Indisponível');
  const liberadas = aprovacao && item && aprovacao.clientId === item.clientId && aprovacao.tarotId === tarotId
    ? new Set(entrada.consultations.filter((v) => v.status === 'Em curso' && !v.tarologistFinishReport && (aprovacao.consultationIds || []).includes(v.id)).map((v) => v.id)) : new Set();
  const fluxo = fluxoDoPainel(entrada, liberadas);
  if (!item || ![...fluxo.generalAll, ...fluxo.futureGeneral].some((r) => r.id === itemId)) recusar('Esta cliente não está mais disponível na Fila Geral.');
  const tempo = q.temporizacao(item, data, agora);
  if (lancamentoDaEquipe && tempo.future) recusar(`${tempo.label}. Aguarde o horário combinado para encaminhar.`);
  if (['after', 'shift'].includes((item.contactPlan && item.contactPlan.timing) ?? '') && !b.planoPermiteContato(item, data, agora)) recusar('Aguarde o período combinado com a cliente ou reagende antes de reservar.');
  if (lancamentoDaEquipe && b.recessoComum(item)) recusar('Retome o contato com a cliente antes de reservar ou encaminhar.');
  if (lancamentoDaEquipe && q.grupo(item, data, agora) === 'callback') recusar('Retome o atendimento desta cliente antes de reservar ou lançar a consulta.');
  const leitora = fluxo.team.find((r) => r.id === tarotId);
  if (!leitora) recusar('Selecione um tarólogo ativo.');
  if (leitora.reservation && leitora.reservation.id !== item.id) recusar(`${leitora.name} já está reservada para ${leitora.reservation.clientId} · ${leitora.reservation.client}. Escolha outra taróloga.`);
  if (!lancamentoDaEquipe && !leitora.freeNow) recusar('A disponibilidade mudou. Confira os tarólogos livres novamente.');
  exigirDestinoLivre(entrada, item, { ...item, tarotId, date: data, scheduledTime: undefined, requestedTime: undefined, contactPlan: { who: 'staff', timing: 'none' } }, nomeDoPerfil(entrada));
  const admissao = adm.admissaoVigente(entrada.intakeEvents || [], tarotId, data, agora);
  const alvo = { tarotId, date: data, clientId: item.clientId };
  const perfil = entrada.profiles.find((r) => r.id === tarotId);
  const erro = (lancamentoDaEquipe ? adm.erroDeInicio(admissao, item, alvo, agora) : adm.erroDeAdmissao(admissao, item, alvo, agora)) || adm.erroDeInicioPorPresenca(perfil, data);
  if (erro) recusar(erro);
  return { item, reader: leitora };
}

/** `validateGeneralMatch`: reservar e encaminhar a fila. */
const validarEncaminhamento = (entrada, itemId, tarotId, aprovacao) => validarDestinoGeral(entrada, itemId, tarotId, aprovacao, false);

/** `validateGeneralConsultationLaunch`: o lançamento da atendente usa as decisões explícitas do formulário. */
function validarLancamento(entrada, itemId, tarotId, aprovacao) {
  const { item, reader } = validarDestinoGeral(entrada, itemId, tarotId, aprovacao, true);
  const bloqueio = bloqueioDeLancamento(item, entrada.date, entrada.now);
  if (bloqueio) recusar(bloqueio);
  const conflito = c.conflitosDeOcupacao(entrada.consultations, tarotId, item.clientId, undefined, false, aprovacao)[0];
  if (conflito) recusar(`${conflito.tarot} já está em consulta com ${conflito.client}. Marque Lançar mesmo assim ou finalize a consulta anterior.`);
  const reserva = b.conflitoDeContinuacao(entrada.consultations, tarotId);
  if (reserva) recusar(`O tarólogo está reservado para a continuação de ${reserva.client}. Resolva ou libere esse pedido na Agenda antes de enviar outra consulta.`);
  return { item, reader };
}

/** `validateGeneralScheduling`: agendar a cliente da fila geral para uma taróloga (a abertura do formulário preserva o destino). */
function validarAgendamento(entrada, itemId, tarotId, data = entrada.date, horarioMarcado, plano, horarioPedido) {
  const item = entrada.agenda.find((r) => r.id === itemId);
  if (item && estaRestrita(entrada.restrictions || [], item.clientId, tarotId)) recusar('Indisponível');
  if (!item || !fluxoDoPainel(entrada).general.some((r) => r.id === itemId)) recusar('Esta cliente não está mais disponível na Fila Geral.');
  // Sem plano novo, o agendamento mantém o plano de origem; o "Se der hoje" sempre sai ao salvar (as duas guardas olham a mesma data resultante).
  exigirDestinoLivre(entrada, item, { ...item, tarotId, date: data, scheduledTime: horarioMarcado, requestedTime: horarioPedido, contactPlan: plano ?? item.contactPlan, standbyDate: undefined }, nomeDoPerfil(entrada));
  const equipe = equipeDePresenca(entrada.profiles, entrada.overrides || {}, entrada.accounts || [], entrada.consultations, data, { hoje: t.hojeDe(entrada.now), proprioId: entrada.selfId, proprioEstado: entrada.selfStatus });
  const leitora = equipe.find((r) => r.id === tarotId);
  if (!leitora) recusar('Escolha a taróloga para o agendamento.');
  const alvo = { tarotId, date: data, clientId: item.clientId, scheduledTime: horarioMarcado };
  const perfil = entrada.profiles.find((r) => r.id === tarotId);
  const erro = adm.erroDeAdmissao(adm.admissaoVigente(entrada.intakeEvents || [], tarotId, data, entrada.now), item, alvo, entrada.now) || adm.erroDeAdmissaoPorPresenca(perfil, item, alvo);
  if (erro) recusar(erro);
  return { item, reader: leitora };
}

/** `validateGeneralSchedulingOpening`: abrir o formulário não apaga o horário gravado; salvar e encaminhar revalidam a proposta real. */
function validarAberturaDoAgendamento(entrada, itemId, tarotId, data = entrada.date) {
  const item = entrada.agenda.find((r) => r.id === itemId);
  return validarAgendamento(entrada, itemId, tarotId, data, item && item.scheduledTime, item && item.contactPlan, item && item.requestedTime);
}

module.exports = { validarAberturaDoAgendamento, RegraDoPainelError, bloqueioDeLancamento, validarDestinoGeral, validarEncaminhamento, validarLancamento, validarAgendamento };
