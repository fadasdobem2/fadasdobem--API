'use strict';

/**
 * Registra TODOS os executores/validadores das ações da Lilly no registro (`acoes/acoes.registro.js`). Carregado por `acoes.servico.js`.
 * Um arquivo por assunto; nenhum registra duas vezes (o registro troca a definição do mesmo `kind`).
 */

const { registrarSchedule } = require('./agenda.schedule');
const { registrarAlteracoesDeAgenda } = require('./agenda.alterar');
const { registrarStartConsultation } = require('./consulta.start');
const { registrarPagamento } = require('./pagamento');
const { registrarCliente } = require('./cliente');
const { registrarNotaHorario } = require('./nota-horario');
const { registrarSoUmbler } = require('./so-umbler');
const { registrarMaisTempo } = require('./mais-tempo');
const { registrarTeamReply } = require('./team-reply');
const { registrarReserva } = require('./reserva');
const { registrarFecharConsulta } = require('./consulta.fechar');
const { registrarContinuacao } = require('./consulta.continuar');
const { registrarReordenar } = require('./posicao.reordenar');

function registrarTodos() {
  registrarSchedule();
  registrarAlteracoesDeAgenda();
  registrarStartConsultation();
  registrarPagamento();
  registrarCliente();
  registrarNotaHorario();
  registrarSoUmbler();
  registrarMaisTempo();
  registrarTeamReply();
  registrarReserva();
  registrarFecharConsulta();
  registrarContinuacao();
  registrarReordenar();
}

registrarTodos();

module.exports = { registrarTodos };
