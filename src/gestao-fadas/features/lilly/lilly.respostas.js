'use strict';

/**
 * Respostas da Lilly. Regra do contrato (Maturacao/59, D3 e D7): para a Lilly, 4xx é recusa DEFINITIVA e 5xx (ou rede) em POST é
 * "incerto", que ela nunca repete sozinha. Por isso toda recusa conhecida sai como 4xx e o 5xx fica só para falha de verdade.
 */

const { enviarJson } = require('../../gate/http');

const falha = (res, status, code, message, extra = {}) => enviarJson(res, status, { error: { code, message }, ...extra });
const sucesso = (res, corpo, status = 200) => enviarJson(res, status, corpo);

module.exports = { falha, sucesso };
