'use strict';

/** Recusa de regra da gravação (`Refusal`/`FinanceStoreError` da B). `existente` não é usado nas rotas portadas. */
class RepasseStoreError extends Error {
  constructor(codigo, existente) {
    super(`repasse store: ${codigo}`);
    this.name = 'RepasseStoreError';
    this.codigo = codigo;
    if (existente !== undefined) this.existente = existente;
  }
}

module.exports = { RepasseStoreError };
