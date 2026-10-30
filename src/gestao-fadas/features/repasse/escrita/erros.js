'use strict';

/** Recusas do store e falhas de infraestrutura traduzidas para a resposta da B (`recorded` e `unavailable`). */

const AppError = require('../../../../utils/AppError');
const { erroOperacao } = require('../../../_comum/politica-acesso');
const { traduzirErro } = require('../../../_comum/legado');
const { RepasseStoreError } = require('./erro');
const { EscritaLegadoError } = require('../../../../models/legado/escrita'); // BancoNovoError (novo/banco-novo.js) herda dela

// As recusas de regra do store viram 400; a mesma chave com outro corpo, 409; a abertura inexistente, 404.
const RECUSAS = new Set([
  'invalid-input', 'legacy-id-missing', 'settled-after-cut', 'installments-mismatch', 'draft-exists', 'opening-exists', 'not-a-draft', 'not-latest', 'not-valid',
]);

function traduzirErroEscrita(erro) {
  if (erro instanceof AppError) return erro;
  if (erro instanceof RepasseStoreError) {
    if (erro.codigo === 'operation-key-conflict') {
      return new AppError('Esta operação já foi registrada com outros dados. Atualize a página e confira.', 409, { codigo: 'OPERATION_KEY_CONFLICT' });
    }
    if (erro.codigo === 'not-found') return new AppError('Não encontrado.', 404, { codigo: 'NOT_FOUND' });
    if (RECUSAS.has(erro.codigo)) return erroOperacao('INVALID_INPUT', true);
    if (erro.codigo === 'actor-account-missing') {
      return new AppError('Gravação indisponível: conta de auditoria não encontrada.', 503, { codigo: 'ESCRITA_CONTA_AUSENTE' });
    }
  }
  if (erro instanceof EscritaLegadoError) return new AppError(erro.message, erro.statusCode || 503, { codigo: erro.codigo });
  const traduzido = traduzirErro(erro);
  if (traduzido instanceof AppError) return traduzido;
  // Sem texto SQL nem valor gravado na resposta; o detalhe fica só no log do servidor.
  console.error(`[repasse.escrita] indisponível: ${(erro && (erro.code || erro.name)) || 'erro'}`);
  return new AppError('Serviço indisponível no momento. Tente novamente.', 503, { codigo: 'SERVICE_UNAVAILABLE' });
}

module.exports = { traduzirErroEscrita, RECUSAS };
