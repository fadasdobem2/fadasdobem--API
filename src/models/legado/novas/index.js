'use strict';

/** GERADO por scripts/gerar-models-legado.js. Tabelas NOVAS `gf_*` ligadas ao legado por ID. */

module.exports = [
  require('./gf_auth_accounts.model'),
  require('./gf_repasse_percentuais.model'),
  require('./gf_repasse_calendarios.model'),
  require('./gf_repasse_aberturas.model'),
  require('./gf_repasse_abertura_pendencias.model'),
  require('./gf_repasse_dividas.model'),
  require('./gf_repasse_divida_parcelas.model'),
  require('./gf_repasse_pagamentos.model'),
  require('./gf_repasse_pagamento_descontos.model'),
  require('./gf_repasse_ajustes.model'),
  require('./gf_repasse_cancelamentos.model'),
  require('./gf_auditoria.model'),
  require('./gf_tarologos_ext.model'),
];
