'use strict';

/**
 * Rótulo da cliente no lançamento do pagamento. É o `nome_id` (como na Agenda). Cadastro pendente da Lilly v708 pode estar com os nomes VAZIOS
 * (quem pagou sem passar os dados): o pagamento não pode ficar bloqueado por isso, então o rótulo é "ID <n>", a MESMA apresentação que a Lilly usa.
 * Isso vai só ao registro do pagamento; nenhum campo de nome do cadastro recebe esse texto.
 */

const { rotuloDaCliente, SEM_NOME } = require('../../agenda/agenda-cliente');
const { lerSituacao } = require('./cliente.extensao');
const { avulso } = require('../dados/executor');

async function rotuloParaPagamento(clientId) {
  try {
    return await rotuloDaCliente(clientId);
  } catch (e) {
    if (e && e.message === SEM_NOME && e.statusCode === 422) {
      const s = await lerSituacao(avulso, `${clientId}`);
      if (s && s.situacao === 'dados_pendentes') return `ID ${clientId}`;
    }
    throw e;
  }
}

module.exports = { rotuloParaPagamento };
