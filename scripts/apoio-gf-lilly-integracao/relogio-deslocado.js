'use strict';

/**
 * Relógio DESLOCADO: o banco é semeado no dia operacional de referência (AGORA = 2026-11-07 12:00 em São Paulo), mas o router da Lilly lê o
 * relógio real. Aqui o relógio anda normalmente, só que começando em AGORA; assim o ouro não depende do dia em que o verificador roda.
 */

function deslocar(agora) {
  const RealDate = Date;
  const deslocamento = agora.getTime() - RealDate.now();
  class DataDeslocada extends RealDate {
    constructor(...args) { if (args.length === 0) super(RealDate.now() + deslocamento); else super(...args); }
    static now() { return RealDate.now() + deslocamento; }
  }
  global.Date = DataDeslocada;
}

module.exports = { deslocar };
