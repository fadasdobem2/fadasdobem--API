'use strict';

/**
 * Adaptador de escrita de DADOS no legado (nunca estrutura). Desligado por padrão: `GF_LEGADO_ESCRITA_ENABLED=false`, e uma flag por entidade
 * (`GF_LEGADO_CLIENTES`, `GF_LEGADO_TAROLOGOS`; consultas só com a geral). Consulta (`tbl_consultas`), cliente (`usuarios`), tarólogo (`tbl_tarologos`).
 * `entidades`/`reconciliacao`/`fusao` carregam sob demanda (só tocam o banco novo quando chamados).
 */

module.exports = {
  ...require('./executor'), consultas: require('./consultas'), mapeamento: require('./mapeamento'), sql: require('./sql'), chave: require('./chave'),
  clientes: require('./clientes'), pagamentos: require('./pagamentos'), notas: require('./notas'), tarologoStatus: require('./tarologo-status'), provisorio: require('./provisorio'), tarologos: require('./tarologos'), sqlEntidades: require('./sql.entidades'), fusao: require('./fusao'),
  legadoPrimeiro: require('./legado-primeiro'), get intencoes() { return require('./intencoes'); },
  get entidades() { return require('./entidades'); }, get reconciliacao() { return require('./reconciliacao'); },
};
