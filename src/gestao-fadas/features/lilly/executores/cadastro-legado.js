'use strict';

/**
 * PONTO DE EXTENSÃO do cadastro NOVO de cliente no legado (Maturacao/60, item 1, "fase B"). Hoje NÃO existe escrita:
 *  - o painel da Nice nunca cria `usuarios` (só edita 4 colunas) e a tabela tem 54 colunas obrigatórias sem default;
 *  - a Nice ainda não autorizou INSERT em `usuarios` pela API (decisão 1 da lista final do doc 60).
 * Sem ID existente, `register_client` recusa com 4xx. Se `GF_LILLY_CADASTRO_LEGADO_ENABLED` for ligada antes de a escrita existir, a
 * resposta é 4xx "não implementado" (nunca finge sucesso e nunca devolve ID inventado).
 * A implementação futura entra AQUI (`criarClienteNoLegado`), por uma entidade nova em `legado-escrita/` sob flag própria, sem mexer no resto.
 */

const cfg = require('./executores.config');
const { recusar } = require('./executores.comum');

const MOTIVO_PADRAO = 'O cadastro novo ainda é feito pela equipe: o Gestão só completa uma cliente que já tenha ID. Cadastro novo ainda depende de decisão da Nice.';

/** Motivo da recusa quando não há ID existente (usado pelo `validate` e pela execução). */
function motivoDoCadastroNovo() {
  return cfg.cadastroLegadoLigado()
    ? 'A criação de cliente no legado ainda não foi implementada. A equipe cadastra a cliente e a Lilly a encontra pelo telefone.'
    : MOTIVO_PADRAO;
}

/** Tentativa de criar a cliente. Sempre recusa (4xx) enquanto a escrita não existir. @returns {never} */
function criarClienteNoLegado(/* payload, contexto */) {
  if (cfg.cadastroLegadoLigado()) recusar('LILLY_CLIENT_CREATION_NOT_IMPLEMENTED', motivoDoCadastroNovo(), 422);
  return recusar('LILLY_CLIENT_CREATION_NOT_ENABLED', motivoDoCadastroNovo(), 422);
}

module.exports = { criarClienteNoLegado, motivoDoCadastroNovo };
