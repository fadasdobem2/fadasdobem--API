'use strict';

/**
 * Onde o Gestão Fadas grava os dados NOVOS (`GF_NOVOS_DADOS`):
 *   - `postgres` (padrão, decisão do produto de 29/10): tabelas `gf_*` no PostgreSQL da A; o legado MySQL nunca é escrito;
 *   - `mysql`: alternativa que mantém o que existia antes (tabelas `gf_*` no banco do suspiro, conta em `gf_auth_accounts`).
 * Valor ausente ou desconhecido vale `postgres`.
 */

function modoNovosDados(env = process.env) {
  return `${env.GF_NOVOS_DADOS || ''}`.trim().toLowerCase() === 'mysql' ? 'mysql' : 'postgres';
}

const novosDadosNoPostgres = (env = process.env) => modoNovosDados(env) === 'postgres';

module.exports = { modoNovosDados, novosDadosNoPostgres };
