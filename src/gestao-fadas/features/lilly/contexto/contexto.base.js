'use strict';

/**
 * Envelope do snapshot `POST /lilly/context` (Maturacao/59, seção 3). Só o que é do próprio servidor: relógio, dia operacional
 * (06h-06h, `_comum/dia-operacional`) e a marca de cobertura. Os arrays entram em montadores próprios, um por assunto.
 * `complete:false` com arrays vazios significa "não consegui verificar", nunca "não existe".
 */

const { hojeOperacional } = require('../../../_comum/dia-operacional');

const HORA_INICIO_DO_DIA = 6;

function envelope(agora = new Date()) {
  return {
    now: agora.toISOString(),
    operationalDate: hojeOperacional(agora),
    operationalStartHour: HORA_INICIO_DO_DIA,
    complete: false,
  };
}

module.exports = { envelope, HORA_INICIO_DO_DIA };
