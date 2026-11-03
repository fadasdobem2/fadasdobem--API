'use strict';

/**
 * O rótulo da cliente na Agenda (Maturacao/56, C2): o que o front chama `name` da ficha (`usuarios.nome_id`, com a edição da ficha por cima),
 * NUNCA o nome civil. O servidor o lê do legado (SOMENTE LEITURA) e grava no agendamento; o `client` que vem do navegador é ignorado.
 * Sem rótulo (cadastro sem `nome_id`) o front não deixa agendar ("Busque e confirme o nome da cliente."): o servidor repete a recusa.
 */

const { lendo } = require('../../_comum/legado');
const AppError = require('../../../utils/AppError');

const SEM_NOME = 'Busque e confirme o nome da cliente.';

/** Trocável nos testes, onde o legado não está configurado. Devolve o texto ou null. */
let lerRotulo = async (clientId) => {
  const extensao = require('../clientes/helpers/extensao');
  const linha = await lendo(async (m) => (await m.LegadoUsuario.findAll({ attributes: ['id', 'nome_id'], where: { nivel: 0, id: Number(clientId) }, raw: true }))[0]);
  if (!linha) return null;
  const efetiva = extensao.sobrepor(linha, (await extensao.extensoesPorId([String(clientId)])).get(String(clientId)));
  const texto = typeof efetiva.nome_id === 'string' ? efetiva.nome_id.trim() : '';
  return texto || null;
};
const definirLeitorDeRotulo = (fn) => { lerRotulo = fn; };

/** O rótulo ou 422 com a frase do front. */
async function rotuloDaCliente(clientId) {
  const rotulo = await lerRotulo(clientId);
  if (!rotulo) throw new AppError(SEM_NOME, 422, { codigo: 'RULE_VIOLATION' }, true);
  return rotulo.slice(0, 160);
}

module.exports = { rotuloDaCliente, definirLeitorDeRotulo, SEM_NOME };
