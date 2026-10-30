'use strict';

/**
 * Ponto único de acesso aos models do legado para os módulos do Gestão Fadas.
 * Traduz falhas de conexão em 503: nunca devolve lista vazia quando o legado está fora (uma lista vazia seria
 * lida como "sem consultas hoje").
 */

const AppError = require('../../utils/AppError');
const { iniciarLegado, LegadoNaoConfiguradoError, LegadoSomenteLeituraError } = require('../../models/legado');

function modelos() {
  try {
    return iniciarLegado().models;
  } catch (e) {
    throw traduzirErro(e);
  }
}

const CODIGOS_REDE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', 'EPIPE', 'PROTOCOL_CONNECTION_LOST']);

function traduzirErro(e) {
  if (e instanceof AppError) return e;
  if (e instanceof LegadoNaoConfiguradoError) {
    return new AppError('Banco legado não configurado neste ambiente.', 503, { codigo: 'LEGADO_NAO_CONFIGURADO' });
  }
  if (e instanceof LegadoSomenteLeituraError) {
    return new AppError('Operação de escrita no legado é proibida.', 500, { codigo: 'LEGADO_SOMENTE_LEITURA' }, false);
  }
  if (e && e.original && e.original.code === 'ER_NO_SUCH_TABLE') {
    return new AppError('Uma tabela necessária não existe neste ambiente.', 503, { codigo: 'LEGADO_TABELA_AUSENTE' });
  }
  const nome = `${e && e.name}`;
  const codigo = `${(e && (e.code || (e.original && e.original.code))) || ''}`;
  if (nome.startsWith('SequelizeConnection') || nome === 'SequelizeDatabaseError' || nome === 'SequelizeTimeoutError' || CODIGOS_REDE.has(codigo)) {
    return new AppError('Banco legado indisponível no momento. Tente novamente.', 503, { codigo: 'LEGADO_INDISPONIVEL' });
  }
  return e;
}

/** Executa uma função de leitura traduzindo os erros do legado. */
async function lendo(fn) {
  try {
    return await fn(modelos());
  } catch (e) {
    throw traduzirErro(e);
  }
}

module.exports = { lendo, modelos, traduzirErro };
