'use strict';

/** `agenda/agenda-launch-eligibility.ts` (`agendaLaunchBlock`), Maturacao/39: só bloqueia agendamento encerrado, adiado, indisponível ou futuro. */

const { contatoDe, encerrado, ativoNoDia } = require('./agenda-contato');
const b = require('./fila-geral-base');
const { ehDeCliente } = require('./agenda-identidade');

function bloqueioDeLancamento(item, data, agora) {
  // v706: lançar consulta exige cliente cadastrada; contato (lead) ainda não pode receber consulta nem pagamento.
  if (!ehDeCliente(item)) return 'Vincule ou cadastre a cliente antes de lançar a consulta.';
  if (encerrado(item) || item.workflowStatus === 'Em consulta' || contatoDe(item).tags.includes('Em consulta')) return 'Este agendamento já foi encaminhado ou encerrado.';
  if (!ativoNoDia(item, data, data) || (b.instantePedido(item, data) ?? 0) > agora) return 'Aguarde o horário combinado deste agendamento para enviar a consulta.';
  if (b.turnoEncerrado(item, data, agora)) return 'O turno combinado terminou. Reagende o contato antes de lançar a consulta.';
  if ((item.contactPlan && item.contactPlan.who) === 'client' || b.temEstadoDeRetorno(item) || contatoDe(item).tags.some((x) => ['Não respondeu', 'Não voltou', 'Não pode agora', 'Não pode'].includes(x))) {
    return 'Retome o atendimento desta cliente na Agenda antes de lançar a consulta.';
  }
  return undefined;
}

module.exports = { bloqueioDeLancamento };
