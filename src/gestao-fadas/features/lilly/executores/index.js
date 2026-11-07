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

function registrarTodos() {
  registrarSchedule();
  registrarAlteracoesDeAgenda();
  registrarStartConsultation();
  registrarPagamento();
  registrarCliente();
  registrarNotaHorario();
  registrarSoUmbler();
}

registrarTodos();

module.exports = { registrarTodos };
