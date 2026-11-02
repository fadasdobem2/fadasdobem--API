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

/**
 * Falha ao ABRIR/obter a conexão (rede, reset, pool): transitória, vale uma nova tentativa. Erro de consulta
 * (`SequelizeDatabaseError`) e tempo esgotado de consulta (`SequelizeTimeoutError`) NÃO se repetem, para não dobrar carga.
 */
function falhaDeConexao(e) {
  const nome = `${e && e.name}`;
  const codigo = `${(e && (e.code || (e.original && e.original.code))) || ''}`;
  return nome.startsWith('SequelizeConnection') || CODIGOS_REDE.has(codigo);
}

const espera = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executa uma função de leitura traduzindo os erros do legado. O pool fecha conexões ociosas e o servidor compartilhado
 * da KingHost às vezes recusa a reabertura: a primeira leitura depois de um tempo parado ganhava 503. Só leitura: uma nova
 * tentativa é segura. O motivo real vai ao log (nome e código, nunca dado).
 */
async function lendo(fn) {
  for (let tentativa = 0; ; tentativa += 1) {
    try {
      return await fn(modelos());
    } catch (e) {
      if (tentativa === 0 && falhaDeConexao(e)) {
        console.warn(`[legado] falha de conexão na leitura (${e.name}/${(e.original && e.original.code) || e.code || '-'}); repetindo uma vez.`);
        await espera(300);
        continue;
      }
      if (e && !(e instanceof AppError)) console.warn(`[legado] leitura recusada (${e.name}/${(e.original && e.original.code) || e.code || '-'}).`);
      throw traduzirErro(e);
    }
  }
}

module.exports = { lendo, modelos, traduzirErro };
