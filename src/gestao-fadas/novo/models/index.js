'use strict';

/**
 * Models Sequelize (PostgreSQL) das tabelas `gf_*` do BANCO NOVO do Gestão Fadas. Um arquivo por tabela.
 * `registrar(sequelize)` os cria na conexão principal da A (chamado por src/models/index.js, uma linha) e devolve
 * `{ NomeDoModel: Model }`. Sem associações: o módulo lê por `tarot_id`/`abertura_id` explicitamente.
 */

const fabricas = [
  require('./gf_auditoria.model'),
  require('./gf_operacoes.model'),
  require('./gf_welcome.model'),
  require('./gf_tarologos_ext.model'),
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
  require('./gf_escalas_semanais.model'),
  require('./gf_horarios_excecoes.model'),
  require('./gf_horarios_periodos.model'),
  require('./gf_presenca_estado.model'),
  require('./gf_presenca_confirmacoes.model'),
  require('./gf_presenca_historico.model'),
  require('./gf_agenda.model'),
  require('./gf_agenda_eventos.model'),
  require('./gf_agenda_ordem_comandos.model'),
  require('./gf_agenda_admissoes.model'),
  require('./gf_agenda_solicitacoes.model'),
  require('./gf_consultas_ext.model'),
  require('./gf_consultas_eventos.model'),
  require('./gf_tarologos_perfil.model'),
  require('./gf_cadastros_tarologo.model'),
  require('./gf_cadastros_tarologo_envios.model'),
  require('./gf_cadastros_tarologo_links.model'),
  require('./gf_clientes_ext.model'),
  require('./gf_precos_versoes.model'),
  require('./gf_pagamentos.model'),
  require('./gf_pagamentos_eventos.model'),
  require('./gf_beneficios_minutos.model'),
  require('./gf_saldos_partida.model'),
  require('./gf_restricoes.model'),
  require('./gf_divergencias.model'),
  require('./gf_recados.model'),
  require('./gf_recados_pessoais.model'),
  require('./gf_contas_ext.model'),
  require('./gf_pendencias_encaminhamentos.model'),
  require('./gf_clientes_orientacoes.model'),
  require('./gf_clientes_notas.model'),
  require('./gf_motivos_financeiros.model'),
  require('./gf_adicionais_itens.model'),
  require('./gf_log_operacional.model'),
  require('./gf_legado_intencoes.model'),
  require('./gf_legado_verificacoes.model'),
  require('./gf_migracao_historicos.model'),
];

function registrar(sequelize) {
  const models = {};
  for (const fabrica of fabricas) models[fabrica.NOME] = fabrica(sequelize);
  return models;
}

module.exports = { registrar, fabricas };
