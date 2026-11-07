'use strict';

/** Recusa do ponto: o front lê `{ error: <frase> }` (texto, não objeto), então a frase já sai pronta para a tela. */
class PontoErro extends Error {
  constructor(mensagem, status) {
    super(mensagem);
    this.name = 'PontoErro';
    this.status = status;
  }
}

module.exports = { PontoErro };
