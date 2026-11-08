'use strict';

/**
 * Configuração dos executores das ações da Lilly (lida na hora da chamada, nada em cache de módulo).
 *  - LILLY_SERVICE_USER_ID               UUID de um usuário da A reservado à Lilly. É o "autor" das gravações que passam pelos serviços
 *                                        da equipe (a auditoria exige um usuário real). Sem ele nenhuma ação do Gestão executa.
 *  - GF_LILLY_CADASTRO_LEGADO_ENABLED    ponto de extensão do cadastro NOVO no legado (Maturacao/60, item 1). Desligado por padrão e,
 *                                        mesmo ligado, SEM implementação de escrita: o cadastro novo responde 4xx "não implementado".
 *  - GF_LILLY_CADASTRO_NOVO_ENABLED      cadastro novo no BANCO NOVO (v708): `register_client` sem ID cria em `gf_clientes_novos`. Desligado por padrão.
 *  - GF_LILLY_FECHAR_CONSULTA_ENABLED / GF_LILLY_CONTINUACAO_ENABLED  (v710) `close_consultation` e `open_continuation`. Desligadas por padrão.
 *  - GF_LILLY_CADASTRO_EXIGE_APROVACAO  criar cadastro exige `registrationApproval` provada (evento de atendente). Desligado por padrão.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ligado = (nome, env = process.env) => `${env[nome] || ''}`.trim().toLowerCase() === 'true';

/** UUID da conta de serviço da Lilly ou `''` (ausente ou malformada). */
const contaDeServico = (env = process.env) => {
  const v = `${env.LILLY_SERVICE_USER_ID || ''}`.trim();
  return UUID.test(v) ? v : '';
};
const cadastroLegadoLigado = (env = process.env) => ligado('GF_LILLY_CADASTRO_LEGADO_ENABLED', env);
/** Cadastro NOVO no BANCO NOVO (`gf_clientes_novos`, Lilly v708). Desligado por padrão: ligado só no dev. NÃO escreve no legado. */
const cadastroNovoLigado = (env = process.env) => ligado('GF_LILLY_CADASTRO_NOVO_ENABLED', env);
/** Exige `registrationApproval` (autorização humana provada) para CRIAR cadastro. Espelha `registration.requireApproval` da Lilly, que a API não vê. */
const cadastroExigeAprovacao = (env = process.env) => ligado('GF_LILLY_CADASTRO_EXIGE_APROVACAO', env);

/** v710: fechar consulta pela Lilly. Desligado por padrão (a Lilly tem a flag `consultationActions.closeEnabled`; as duas precisam estar ligadas). */
const fecharConsultaLigado = (env = process.env) => ligado('GF_LILLY_FECHAR_CONSULTA_ENABLED', env);
/** v710: abrir continuação pela Lilly. Desligado por padrão (par de `consultationActions.continuationEnabled`). */
const continuacaoLigada = (env = process.env) => ligado('GF_LILLY_CONTINUACAO_ENABLED', env);

/** Nome de quem assina nos serviços da equipe (aparece no histórico das telas). */
const NOME_DO_SERVICO = 'Lilly';

module.exports = { contaDeServico, cadastroLegadoLigado, cadastroNovoLigado, cadastroExigeAprovacao, fecharConsultaLigado, continuacaoLigada, NOME_DO_SERVICO };
