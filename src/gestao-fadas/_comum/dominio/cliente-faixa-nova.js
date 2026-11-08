'use strict';

/**
 * Faixa de IDs das clientes criadas pela Lilly NO BANCO NOVO (`gf_clientes_novos`): >= 1.000.000.000, que o auto incremento do legado não alcança.
 * Um ID desta faixa só existe no banco novo e um ID abaixo dela só existe no legado (somente leitura). Função pura, sem banco.
 */

const FAIXA_INICIO = 1000000000;
const FAIXA_FIM = 2147483647;

const ehIdDaFaixaNova = (id) => typeof id === 'string' && /^[1-9]\d{9}$/.test(id) && Number(id) >= FAIXA_INICIO && Number(id) <= FAIXA_FIM;

module.exports = { FAIXA_INICIO, FAIXA_FIM, ehIdDaFaixaNova };
