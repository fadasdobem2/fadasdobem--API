class AppError extends Error {
  constructor(mensagem, statusCode = 500, dados = null, isOperational = true) {
    super(mensagem);
    /** HTTP status real enviado ao cliente */
    this.statusCode = statusCode;
    /** Erros tratados são operacionais; bugs inesperados marcam como false antes de propagar. */
    this.isOperational = isOperational;
    /** Corpo opcional em `sucesso:false` */
    this.dados = dados;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
