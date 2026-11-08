'use strict';

/** Só mensagens escritas de propósito saem do serviço de e-mails. Nunca repasse erro de provedor, SMTP ou SQL. */
class EmailErro extends Error {
  constructor(mensagem, status = 409) {
    super(mensagem);
    this.name = 'EmailErro';
    this.status = status;
  }
}
const entrada = (mensagem, status = 400) => new EmailErro(mensagem, status);

module.exports = { EmailErro, entrada };
