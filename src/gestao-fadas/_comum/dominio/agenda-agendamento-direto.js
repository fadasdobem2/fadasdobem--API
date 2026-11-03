'use strict';

/**
 * Agenda, agendamento DIRETO e edição (domínio puro, Maturacao/56 "Correções da onda 1 - grupo C", C1). Porte versionado do que o front decide
 * ao salvar o formulário "Agendar cliente" (`agenda/agenda-experience.tsx`, `submitSchedule`, caminho que não vem da Fila Geral, e
 * `clientes/client-create-booking.ts`, que roda a mesma admissão): as mesmas frases, na mesma ordem de checagem.
 *   1. identidade (`agenda/agenda-history.ts:agendaClientChangeError`);
 *   2. restrição cliente x tarólogo, "Indisponível" (`restricoes/restriction-model.ts:isAttendanceRestricted`), só para agendamento novo ou
 *      cliente, tarólogo ou dia mudados;
 *   3. tarólogo conhecido e ativo (a lista da tela só oferece tarólogos do cadastro; a frase é a de `validateGeneralDestination`);
 *   4. horário marcado válido (`shared/time-input.tsx:validClock`);
 *   5. agenda fechada e cadastro inativo (`intakeAdmissionError` e `presenceAdmissionError`, já portados em `admissao.js`);
 *   6. solicitação da taróloga (`requestAppointment`) e "Se der hoje";
 *   7. edição: consulta em andamento e "Próximo turno" (`scheduleNextShift`) não aceita data passada.
 * O aviso de disponibilidade (`scheduleAvailabilityNotice`) continua AVISO: pede confirmação no navegador, não vira erro aqui.
 * Relógio injetado: `entrada.now` (ms) e `entrada.date` (dia operacional). Lança `RegraDoPainelError`.
 */

const { encerrado, ativoNoDia, contatoDe, limpar } = require('./agenda-contato');
const { lerPlano } = require('./agenda-etiqueta');
const { estaRestrita } = require('./restricoes');
const adm = require('./admissao');
const { RegraDoPainelError, } = require('./painel-validacao');
const { planoNormalizado } = require('./painel-agendamento');

const recusar = (mensagem) => { throw new RegraDoPainelError(mensagem); };
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const CAMPOS_DE_COBERTURA = ['paymentPending', 'paymentExpectedAmount', 'paymentAmount', 'unlinkedPaymentAmount'];
const FORA_DO_PADRAO = 'Confira os dados informados e tente novamente.';

/** `requestAppointment`/`linkedRequestAppointment` (agenda-intake-model.ts:84-89), sobre os agendamentos abertos que o servidor conhece. */
function agendamentoDaSolicitacao(pedido, agenda) {
  const ligado = agenda.find((i) => i.requestId === pedido.id || i.id === pedido.agendaId);
  return ligado || agenda.find((i) => i.tarotId === pedido.tarotId && i.clientId === pedido.clientId && !encerrado(i)
    && (ativoNoDia(i, pedido.date, pedido.date) || (i.date || pedido.date) >= pedido.date));
}

function planoMudou(antes, depois) {
  try {
    const n = (item) => JSON.stringify(limpar(planoNormalizado(item.contactPlan || lerPlano(item))));
    return n(antes) !== n(depois);
  } catch (_e) { return true; }
}

/**
 * @param {object} entrada `{ agenda, consultations, profiles, intakeEvents, restrictions, now, date, catalogoLido }`
 * @param {object} d `{ antes?, depois: { clientId, tarotId, date, standbyDate?, scheduledTime?, contact?, contactPlan, ... }, id, solicitacao? }`
 */
function validarAgendamentoDireto(entrada, d) {
  const { antes, depois } = d;
  const hoje = entrada.date;
  const clientId = `${depois.clientId}`.trim();
  const data = depois.date;
  // 1. a identidade do agendamento conserva seus contatos, pagamentos e consultas
  if (antes && antes.clientId !== clientId) recusar('Para outra cliente, cancele este agendamento e crie um novo.');
  // 2. restrição, só quando o agendamento é novo ou muda cliente, tarólogo ou dia
  if ((!antes || antes.clientId !== clientId || antes.tarotId !== depois.tarotId || (antes.date || hoje) !== data) && estaRestrita(entrada.restrictions || [], clientId, depois.tarotId)) recusar('Indisponível');
  // 3. tarólogo do cadastro (a Fila Geral não está nele)
  const perfil = entrada.profiles.find((r) => r.id === depois.tarotId);
  if (d.tarologoDesconhecido) recusar('Selecione um tarólogo ativo.');
  // 4. horário marcado: relógio válido ou em branco
  const marcado = depois.scheduledTime || '';
  if (marcado && !HORARIO.test(marcado)) recusar('Digite um horário válido, como 21:30, ou deixe em branco.');
  // 5. agenda fechada e cadastro inativo (o alvo leva o horário marcado como a tela o envia)
  const alvo = { tarotId: depois.tarotId, date: data, clientId, standbyDate: depois.standbyDate, scheduledTime: marcado };
  const erro = adm.erroDeAdmissao(adm.admissaoVigente(entrada.intakeEvents || [], depois.tarotId, depois.standbyDate || data, entrada.now), antes, alvo, entrada.now)
    || adm.erroDeAdmissaoPorPresenca(perfil, antes, alvo);
  if (erro) recusar(erro);
  // 6. solicitação da taróloga e "Se der hoje"
  const pedido = d.solicitacao;
  if (pedido && ((!antes && pedido.tarotId !== depois.tarotId) || pedido.clientId !== clientId)) recusar('Esta solicitação pertence à cliente e ao tarólogo informados. Abra um novo agendamento para outra pessoa.');
  if (pedido && !antes && agendamentoDaSolicitacao(pedido, entrada.agenda)) recusar('Esta solicitação já tem um agendamento. Abra o registro existente.');
  if (depois.standbyDate && depois.standbyDate !== data) recusar('Se der hoje pertence à agenda de hoje. Confira a data.');
  if (!antes) return;
  // 7. edição
  const mudaDestino = antes.tarotId !== depois.tarotId || (antes.date || hoje) !== data;
  const proximoTurno = contatoDe(antes).tags.includes('Próximo turno') && depois.tarotId === antes.tarotId;
  const mudouAcordo = mudaDestino || planoMudou(antes, depois);
  if ((mudaDestino || mudouAcordo || proximoTurno) && (entrada.consultations || []).some((c) => c.agendaItemId === d.id && c.status === 'Em curso')) recusar('Finalize a consulta em andamento antes de mudar o agendamento.');
  if (mudaDestino && proximoTurno && data < hoje) recusar('Escolha hoje ou uma data futura para o próximo turno.');
}

/**
 * Cobertura de pagamento (`paymentPending`, `paymentExpectedAmount`, `paymentAmount`, `unlinkedPaymentAmount`). O formulário do front nunca grava os
 * valores: eles nascem do servidor (`schedule-general`, consulta) e só são APAGADOS pela edição. Então o servidor recusa valor de cobertura vindo do
 * navegador no agendamento novo (exceto `paymentPending`, que o cadastro de cliente novo calcula com o recibo da tela: Maturacao/56, pendência) e
 * na edição, onde só vale repetir o que já está gravado.
 */
function conferirCobertura(antes, set) {
  for (const campo of CAMPOS_DE_COBERTURA) {
    if (!(campo in set)) continue;
    if (!antes && campo === 'paymentPending') continue;
    if (JSON.stringify(set[campo]) !== JSON.stringify(antes ? antes[campo] : undefined)) throw new RegraDoPainelError(FORA_DO_PADRAO);
  }
}

module.exports = { validarAgendamentoDireto, conferirCobertura, agendamentoDaSolicitacao, CAMPOS_DE_COBERTURA };
