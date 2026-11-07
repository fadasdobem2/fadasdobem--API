'use strict';

/** Erros do `events/resolve`. Recusa conhecida = 4xx (a Lilly não repete); falha da verificação externa = 503 (a Lilly tenta de novo, até 5 vezes). */

class EventoRecusadoError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.name = 'EventoRecusadoError';
    this.code = code;
    this.status = status;
  }
}

class VerificacaoIndisponivelError extends EventoRecusadoError {
  constructor(message = 'Não foi possível verificar o evento agora.', code = 'LILLY_VERIFICATION_UNAVAILABLE') {
    super(code, message, 503);
    this.name = 'VerificacaoIndisponivelError';
  }
}

module.exports = { EventoRecusadoError, VerificacaoIndisponivelError };
