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
 * v706 (Nice): a ordem agora segue `submitSchedule` da v706 (agenda-experience.tsx:1185-1230): minutos pedidos e meio de consulta, identidade
 * cliente OU contato (`agenda-identidade.js`; "Para outra cliente, cancele..." foi SUBSTITUÍDA por "A identificação deste agendamento mudou..."),
 * restrição, WhatsApp do contato, horário, admissão (mesma identidade), solicitação (`requestAppointment` só aceita UM agendamento aberto da mesma
 * pessoa no dia do pedido) e contato já agendado na data. O meio de consulta só é exigido com `entrada.exigirModalidade` (flag
 * GF_AGENDA_MODALIDADE_OBRIGATORIA, desligada por padrão: os dados antigos têm "WhatsApp" e continuam legíveis).
 * O aviso de disponibilidade (`scheduleAvailabilityNotice`) continua AVISO: pede confirmação no navegador, não vira erro aqui.
 * Relógio injetado: `entrada.now` (ms) e `entrada.date` (dia operacional). Lança `RegraDoPainelError`.
 */

const { encerrado, contatoDe, limpar, ehDataCivil } = require('./agenda-contato');
const { chaveDeIdentidade, mesmaIdentidade, erroDeIdentidade, identidadeDoPedido } = require('./agenda-identidade');
const { agendamentoDoPedido } = require('./agenda-pedido-registro');
const { normalizarWhatsapp } = require('./agenda-pedido-identidade');
const { lerPlano } = require('./agenda-etiqueta');
const { estaRestrita } = require('./restricoes');
const adm = require('./admissao');
const { RegraDoPainelError, } = require('./painel-validacao');
const { planoNormalizado } = require('./painel-agendamento');
const { exigirSemDuplicidade, DuplicidadeDeAgendaError } = require('./agenda-duplicidade');

const recusar = (mensagem) => { throw new RegraDoPainelError(mensagem); };
const HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;
const CAMPOS_DE_COBERTURA = ['paymentPending', 'paymentExpectedAmount', 'paymentAmount', 'unlinkedPaymentAmount'];
const FORA_DO_PADRAO = 'Confira os dados informados e tente novamente.';

const MODALIDADES = Object.freeze(['WhatsApp Áudio', 'PABX', 'WhatsApp Ligação', 'WhatsApp Texto', 'WhatsApp Texto/Áudio']);
/** `validateRequestedMinutes` (consultation-channels.ts): ausente vale; se vier, inteiro seguro maior que zero. */
const erroDeMinutos = (v) => (v === undefined || (Number.isSafeInteger(v) && v > 0) ? '' : 'Informe os minutos solicitados com um número inteiro maior que zero.');

/** `requestAppointment`/`linkedRequestAppointment` (agenda-intake-model.ts, v706), sobre os agendamentos abertos que o servidor conhece. */
const agendamentoDaSolicitacao = agendamentoDoPedido;

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
  const clientId = `${depois.clientId || ''}`.trim();
  const identidade = { clientId, leadId: depois.leadId };
  const data = depois.date;
  // 1. minutos pedidos e meio de consulta (o meio só com a flag)
  const minutos = erroDeMinutos(depois.requestedMinutes);
  if (minutos) recusar(minutos);
  if (entrada.exigirModalidade && !MODALIDADES.includes(depois.channel)) recusar('Escolha um meio de consulta válido.');
  // 2. identidade: cliente OU contato; a identidade do agendamento existente não muda
  const erroId = erroDeIdentidade(identidade, entrada.contacts) || (antes && !mesmaIdentidade(antes, identidade) ? 'A identificação deste agendamento mudou. Feche e abra novamente para conferir.' : '');
  if (erroId) recusar(erroId);
  // 3. restrição, só quando o agendamento é novo ou muda cliente, tarólogo ou dia
  if ((!antes || antes.clientId !== clientId || antes.tarotId !== depois.tarotId || (antes.date || hoje) !== data) && estaRestrita(entrada.restrictions || [], clientId, depois.tarotId)) recusar('Indisponível');
  // 4. tarólogo do cadastro (a Fila Geral não está nele)
  const perfil = entrada.profiles.find((r) => r.id === depois.tarotId);
  if (d.tarologoDesconhecido) recusar('Selecione um tarólogo ativo.');
  // 5. contato: WhatsApp completo; data válida
  if (depois.leadId && !normalizarWhatsapp(((entrada.contacts || []).find((c) => c.id === depois.leadId) || {}).whatsapp || '')) recusar('Complete o WhatsApp do contato, com DDD e número.');
  if (!ehDataCivil(data)) recusar('Informe uma data válida.');
  // 6. horário marcado: relógio válido ou em branco
  const marcado = depois.scheduledTime || '';
  if (marcado && !HORARIO.test(marcado)) recusar('Digite um horário válido, como 21:30, ou deixe em branco.');
  // 7. agenda fechada e cadastro inativo (o alvo leva o horário marcado como a tela o envia)
  const alvo = { tarotId: depois.tarotId, date: data, clientId, leadId: depois.leadId, standbyDate: depois.standbyDate, scheduledTime: marcado };
  const erro = adm.erroDeAdmissao(adm.admissaoVigente(entrada.intakeEvents || [], depois.tarotId, depois.standbyDate || data, entrada.now), antes, alvo, entrada.now)
    || adm.erroDeAdmissaoPorPresenca(perfil, antes, alvo);
  if (erro) recusar(erro);
  // 8. solicitação da taróloga, "Se der hoje" e contato já agendado na data
  const pedido = d.solicitacao;
  if (pedido && ((!antes && pedido.tarotId !== depois.tarotId) || !mesmaIdentidade(identidadeDoPedido(pedido), identidade))) recusar('Esta solicitação pertence à cliente e ao tarólogo informados. Abra um novo agendamento para outra pessoa.');
  if (pedido && !antes && agendamentoDaSolicitacao(pedido, entrada.agenda)) recusar('Esta solicitação já tem um agendamento. Abra o registro existente.');
  if (depois.standbyDate && depois.standbyDate !== data) recusar('Se der hoje pertence à agenda de hoje. Confira a data.');
  // Site v710: `assertNoAgendaDuplicate` (agenda-duplicate.ts) vale para cliente E contato, novo ou editado: mesma pessoa + profissional + OCORRÊNCIA (outro horário explícito é outra consulta).
  try {
    exigirSemDuplicidade(entrada.agenda || [], { ...identidade, tarotId: depois.tarotId, date: data, scheduledTime: marcado || undefined, requestedTime: depois.requestedTime, contactPlan: depois.contactPlan, requestId: pedido && pedido.id },
      { hoje, agora: entrada.now, excluirId: (antes && antes.id) || d.id, nomeDaProfissional: perfil && perfil.name });
  } catch (e) { if (e instanceof DuplicidadeDeAgendaError) recusar(e.message); throw e; }
  if (!antes) return;
  // 9. edição
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
