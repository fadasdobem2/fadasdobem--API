'use strict';

/** Adaptador de escrita de DADOS no legado (espelho de `tbl_consultas`). Desligado por padrão: `GF_LEGADO_ESCRITA_ENABLED=false`. */

module.exports = { ...require('./executor'), consultas: require('./consultas'), mapeamento: require('./mapeamento'), sql: require('./sql'), chave: require('./chave') };
