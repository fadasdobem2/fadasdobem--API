'use strict';

/** Relógio fixo (2026-11-09 12:00 em Brasília) para o ouro do pedido de agendamento ser o mesmo hoje e daqui a um mês. */
const AGORA = Date.parse('2026-11-09T15:00:00.000Z');
const fixar = () => { Date.now = () => AGORA; };

module.exports = { AGORA, fixar };
