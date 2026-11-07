'use strict';

/**
 * Erros das ações da Lilly. Regra do contrato (Maturacao/59, D3/D7): recusa conhecida = 4xx (definitiva); 5xx só para falha real,
 * porque a Lilly trata 5xx em POST como "incerto" e passa a conciliar.
 */

/** Recusa DEFINITIVA de negócio: o efeito não aconteceu e não deve ser repetido com a mesma chave. Sai como 4xx e fica guardada. */
class AcaoRecusadaError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'AcaoRecusadaError';
    this.code = code;
    this.status = status;
  }
}

/** A mesma chave chegou com outro corpo (409, recusa definitiva). */
class AcaoConflitoError extends AcaoRecusadaError {
  constructor() {
    super('OPERATION_KEY_CONFLICT', 'A chave de idempotência já foi usada com outra ação.', 409);
    this.name = 'AcaoConflitoError';
  }
}

/** Outra tentativa da mesma chave ainda está em andamento (ou morreu no meio): 503, a Lilly concilia pelo GET. */
class AcaoEmAndamentoError extends Error {
  constructor() {
    super('A ação com esta chave está em andamento ou ficou incerta.');
    this.name = 'AcaoEmAndamentoError';
    this.code = 'LILLY_ACTION_IN_PROGRESS';
    this.status = 503;
  }
}

module.exports = { AcaoRecusadaError, AcaoConflitoError, AcaoEmAndamentoError };
