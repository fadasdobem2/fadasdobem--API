'use strict';

/** Porta única dos prazos de atendimento (Maturacao/56 grupo D): espera de contato/pagamento (5 e 10 min), mais tempo, relógio do painel e fim de turno (15 min). */
module.exports = { ...require('./prazos-espera'), ...require('./prazos-painel'), ...require('./prazos-turno') };
