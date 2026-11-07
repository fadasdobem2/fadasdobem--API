'use strict';

/**
 * Admissão do turno (domínio puro): porte versionado de `agenda/agenda-intake-model.ts` do front do suspiro (Maturacao/29 seção 11):
 * `currentIntake` (:13), `intakeExpired` (:12), `operationalTime` (:21), `intakeReturnIsOpen` (:31), `isStandbyOn` (:34),
 * `intakeAdmissionError` (:57, v706: a identidade é cliente OU contato, `mesmaIdentidade`), `intakeStartError` (:80), mais `staffPresenceChoice`/`presenceStartError`/`presenceAdmissionError`
 * (`tarologas/staff-presence-model.ts:15-27` e `:67-86`). O calendário de demonstração não existe aqui: o instante é o real.
 */

const { encerrado, dataDeOrigem, ativoNoDia } = require('./agenda-contato');
const { somarDias } = require('./horarios');
const { FILA_GERAL } = require('./fila-geral-base');
const { mesmaIdentidade } = require('./agenda-identidade');

const MODOS = Object.freeze(['open', 'no_more', 'until_end', 'on_return', 'count']);
const proximoDia = (data) => somarDias(data, 1);
const intakeExpirou = (evento, agora = Date.now()) => Boolean(evento && evento.closedUntil && Number.isFinite(Date.parse(evento.closedUntil)) && agora >= Date.parse(evento.closedUntil));
/** O evento vigente do tarólogo no dia é o ÚLTIMO; fechamento vencido volta a "aberta". */
function admissaoVigente(eventos, tarotId, data, agora = Date.now()) {
  const evento = eventos.filter((e) => e.tarotId === tarotId && e.date === data).at(-1);
  return evento && intakeExpirou(evento, agora) ? { ...evento, mode: 'open' } : evento;
}
// operationTimestamp sem calendário de demonstração (operation-calendar.ts:53)
const instanteDoRelogio = (data, relogio, fim = false) => (relogio && /^([01]\d|2[0-3]):[0-5]\d$/.test(relogio)
  ? Date.parse(new Date(`${Number(relogio.slice(0, 2)) < 6 || (fim && relogio === '06:00') ? somarDias(data, 1) : data}T${relogio}:00-03:00`).toISOString()) : NaN);
const ancora = (evento, agora) => (Number.isFinite(Date.parse(evento.at)) ? Date.parse(evento.at) : agora);
function retornoAberto(evento, agora) {
  return evento.mode === 'on_return' && agora >= instanteDoRelogio(evento.date, evento.returnTime) && agora < instanteDoRelogio(evento.date, evento.endTime, true);
}
const emEncaixe = (item, data) => item.standbyDate === data && dataDeOrigem(item, data) === data && !encerrado(item);

function erroDeAdmissao(evento, antes, alvo, agora = Date.now()) {
  if (!evento || evento.mode === 'open' || intakeExpirou(evento, agora) || evento.date !== (alvo.standbyDate || alvo.date) || evento.tarotId !== alvo.tarotId) return '';
  if (antes && antes.tarotId === alvo.tarotId && mesmaIdentidade(antes, alvo) && dataDeOrigem(antes, evento.date) === alvo.date && antes.standbyDate === alvo.standbyDate && (!evento.closeScope || (evento.agendaIds || []).includes(antes.id))) return '';
  if (evento.mode === 'no_more') {
    if (evento.closeScope === 'shift') {
      const marcado = instanteDoRelogio(alvo.date, alvo.scheduledTime);
      if (!alvo.standbyDate && marcado >= Date.parse(evento.closedUntil || '')) return '';
      return `Agenda fechada neste turno. Para outro turno hoje, informe um horário a partir de ${evento.endTime}.`;
    }
    return 'Agenda fechada, inclusive para encaixes. Escolha Amanhã ou outra data.';
  }
  if (evento.mode === 'on_return') {
    const fim = instanteDoRelogio(evento.date, evento.endTime, true);
    if (agora >= fim) return 'O turno de retorno terminou. Escolha Amanhã ou outra data.';
    if (alvo.scheduledTime && !alvo.standbyDate) {
      const marcado = instanteDoRelogio(alvo.date, alvo.scheduledTime);
      if (marcado < instanteDoRelogio(evento.date, evento.returnTime) || marcado >= fim) return `Escolha um horário entre o retorno às ${evento.returnTime} e o término às ${evento.endTime}.`;
    }
    return '';
  }
  if (alvo.standbyDate && (evento.mode !== 'until_end' || agora < instanteDoRelogio(evento.date, evento.endTime, true))) return '';
  return 'Agenda fechada para novos agendamentos hoje. Use Se der, quando permitido, ou Amanhã.';
}

/** Reservar antes do retorno não autoriza iniciar consulta antes da janela. */
function erroDeInicio(evento, antes, alvo, agora) {
  if (antes && antes.tarotId !== FILA_GERAL && antes.tarotId === alvo.tarotId && antes.clientId === alvo.clientId && emEncaixe(antes, alvo.date)) return 'Confirme o encaixe na agenda antes de lançar a consulta.';
  if (evento && evento.mode === 'no_more' && Boolean(evento.closeScope) && !intakeExpirou(evento, agora) && evento.tarotId === alvo.tarotId && evento.date === alvo.date && (!antes || !(evento.agendaIds || []).includes(antes.id))) {
    return evento.closeScope === 'shift' ? 'Este turno está fechado para novas consultas. Aguarde o próximo turno.' : 'A agenda está fechada para novas consultas hoje.';
  }
  const naFila = antes && antes.tarotId === alvo.tarotId && antes.clientId === alvo.clientId && ativoNoDia(antes, alvo.date, alvo.date);
  const erro = naFila ? '' : erroDeAdmissao(evento, antes, alvo, agora);
  if (erro) return erro;
  if (evento && evento.mode === 'on_return' && evento.date === alvo.date && evento.tarotId === alvo.tarotId && !retornoAberto(evento, agora)) return `Novas consultas no turno de retorno: ${evento.returnTime} às ${evento.endTime}. Agende para esse período.`;
  return '';
}

// staff-presence-model.ts:15-27
function escolhaDePresenca(perfil, data) {
  const estado = perfil.shiftStatus ?? (!perfil.online ? 'Offline' : perfil.status === 'Pausa' ? 'Em pausa' : 'Disponível');
  if (estado === 'Em pausa') return 'pause';
  if (estado !== 'Offline') return 'available';
  if (perfil.presenceDate === data && perfil.shiftExit === 'missing') return 'missing';
  if (perfil.presenceDate === data && perfil.shiftExit === 'ended') return 'ended';
  if (perfil.shiftExit === 'return' && (perfil.presenceDate === data || perfil.returnForecast)) return 'return';
  return 'offline';
}
// staff-presence-model.ts:80-85: iniciar ou receber consulta exige turno ativo e confirmado; agendar continua livre
function erroDeInicioPorPresenca(perfil, data) {
  if (!perfil) return '';
  if (perfil.registrationActive === false) return `${perfil.name} está com o cadastro inativo e não pode receber novas consultas.`;
  if (escolhaDePresenca(perfil, data) !== 'available' || perfil.presenceConfirmation) return `${perfil.name} precisa confirmar a disponibilidade antes de iniciar ou receber uma consulta. O agendamento pode ser feito normalmente.`;
  return '';
}
// staff-presence-model.ts:67-78: offline é só presença; cadastro inativo bloqueia nova admissão
function erroDeAdmissaoPorPresenca(perfil, antes, alvo) {
  const mesmo = antes && antes.tarotId === alvo.tarotId && antes.clientId === alvo.clientId && (antes.date || alvo.date) === alvo.date && (antes.standbyDate || '') === (alvo.standbyDate || '') && (antes.scheduledTime || '') === (alvo.scheduledTime || '');
  if (perfil && perfil.registrationActive === false && !mesmo) return `${perfil.name} está com o cadastro inativo. Selecione outro tarólogo ou reative o cadastro.`;
  return '';
}

module.exports = { MODOS, proximoDia, intakeExpirou, admissaoVigente, instanteDoRelogio, retornoAberto, emEncaixe, erroDeAdmissao, erroDeInicio, escolhaDePresenca, erroDeInicioPorPresenca, erroDeAdmissaoPorPresenca };
