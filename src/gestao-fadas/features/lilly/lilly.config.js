'use strict';

/**
 * Configuração da fatia Lilly (Maturacao/59). Tudo por ambiente, lido na hora da chamada (nada em cache de módulo).
 *  - GF_FATIA_LILLY=true       liga as rotas `/lilly/*` (desligada: 404, como as outras fatias).
 *  - LILLY_SERVICE_TOKEN       segredo do serviço Lilly (mínimo 24 caracteres). Sem ele as rotas respondem 503.
 *  - GF_LILLY_ACOES_ENABLED    libera `POST /lilly/actions`. Desligado: a ação é recusada (403), nunca executada.
 */

const ligado = (nome, env = process.env) => `${env[nome] || ''}`.trim().toLowerCase() === 'true';

const lillyLigada = (env = process.env) => ligado('GF_FATIA_LILLY', env);
const acoesLiberadas = (env = process.env) => ligado('GF_LILLY_ACOES_ENABLED', env);
const tokenDeServico = (env = process.env) => `${env.LILLY_SERVICE_TOKEN || ''}`.trim();

const TOKEN_MINIMO = 24;

module.exports = { lillyLigada, acoesLiberadas, tokenDeServico, TOKEN_MINIMO };
