'use strict';

/**
 * CHECKs das tabelas `gf_*` do banco novo (PostgreSQL da API A), portados dos SQL do MySQL em
 * fontes/migrations-gf/. Fonte ÚNICA das expressões: a migração (migrations/*gestao-fadas*) e os models
 * (hooks de `sync`) leem daqui, então `npm run comparar:models-migracoes` prova que os dois criam o mesmo esquema.
 * Dialeto Postgres: `char_length`, `trim`, `~` / `!~` no lugar de REGEXP, sem JSON_VALID (as colunas são jsonb).
 */

const nv = (c) => `char_length(${c}) > 0 AND char_length(${c}) = char_length(trim(${c}))`; // texto sem espaço nas pontas
const nt = (c) => `char_length(trim(${c})) > 0`; // texto não vazio
const DIAS_MES_OK = String.raw`dias_mes ~ '^([1-9]|[12][0-9]|3[01])(,([1-9]|[12][0-9]|3[01]))*$' AND dias_mes !~ '(^|,)([0-9]+),(.*,)?\2(,|$)'`;

/** Correção por substituição: `corrige_id` e `motivo_correcao` andam juntos. */
const correcao = `(corrige_id IS NULL AND motivo_correcao IS NULL) OR (corrige_id IS NOT NULL AND corrige_id <> id AND motivo_correcao IS NOT NULL AND ${nt('motivo_correcao')})`;

const CHECKS = {
  gf_repasse_percentuais: [
    ['chk_percentuais_id', nv('id')], ['chk_percentuais_tarot_id', nv('tarot_id')],
    ['chk_percentuais_percentual', 'percentual >= 0 AND percentual <= 100'],
    ['chk_percentuais_motivo', `motivo IS NULL OR ${nt('motivo')}`], ['chk_percentuais_registrado_em', 'registrado_em > 0'],
    ['chk_percentuais_operation_key', nv('operation_key')],
  ],
  gf_repasse_calendarios: [
    ['chk_calendarios_id', nv('id')], ['chk_calendarios_tarot_id', nv('tarot_id')],
    ['chk_calendarios_tipo', "tipo IN ('weekday', 'monthdays', 'none')"],
    ['chk_calendarios_dia_semana', "(tipo = 'weekday' AND dia_semana IS NOT NULL AND dia_semana IN ('segunda', 'terca', 'quarta', 'quinta', 'sexta')) OR (tipo <> 'weekday' AND dia_semana IS NULL)"],
    ['chk_calendarios_dias_mes', `(tipo = 'monthdays' AND dias_mes IS NOT NULL AND ${DIAS_MES_OK}) OR (tipo <> 'monthdays' AND dias_mes IS NULL)`],
    ['chk_calendarios_politica', "politica_fim_semana IS NULL OR (tipo = 'monthdays' AND politica_fim_semana IN ('keep', 'next-business-day'))"],
    ['chk_calendarios_motivo', `motivo IS NULL OR ${nt('motivo')}`], ['chk_calendarios_registrado_em', 'registrado_em > 0'],
    ['chk_calendarios_operation_key', nv('operation_key')],
  ],
  gf_repasse_aberturas: [
    ['chk_aberturas_id', nv('id')], ['chk_aberturas_tarot_id', nv('tarot_id')],
    ['chk_aberturas_situacao', "situacao IN ('rascunho', 'confirmada', 'descartada')"],
    ['chk_aberturas_correcao', `(revisao = 1 AND corrige_revisao IS NULL AND motivo_correcao IS NULL) OR (revisao > 1 AND corrige_revisao IS NOT NULL AND motivo_correcao IS NOT NULL AND corrige_revisao >= 1 AND corrige_revisao < revisao AND ${nt('motivo_correcao')})`],
    ['chk_aberturas_ultimo_pagamento_valor', 'ultimo_pagamento_valor >= 0'], ['chk_aberturas_planilha_referencia', nt('planilha_referencia')],
    ['chk_aberturas_saldo_composicao', `saldo_composicao IS NULL OR ${nt('saldo_composicao')}`],
    ['chk_aberturas_percentual', 'percentual_conferido >= 0 AND percentual_conferido <= 100'], ['chk_aberturas_lancado_em', 'lancado_em > 0'],
    ['chk_aberturas_confirmacao', "(situacao = 'confirmada' AND confirmado_por IS NOT NULL AND confirmado_em IS NOT NULL AND confirmado_em >= lancado_em) OR (situacao <> 'confirmada' AND confirmado_por IS NULL AND confirmado_em IS NULL)"],
    ['chk_aberturas_operation_key', nv('operation_key')],
  ],
  gf_repasse_abertura_pendencias: [
    ['chk_pendencias_id', nv('id')], ['chk_pendencias_descricao', nt('descricao')],
    ['chk_pendencias_resolucao', '(resolvida_em IS NULL AND resolvida_por IS NULL) OR (resolvida_em IS NOT NULL AND resolvida_em > 0 AND resolvida_por IS NOT NULL)'],
  ],
  gf_repasse_dividas: [
    ['chk_dividas_id', nv('id')], ['chk_dividas_tarot_id', nv('tarot_id')], ['chk_dividas_tipo', "tipo IN ('loan', 'advance')"],
    ['chk_dividas_origem', "(origem = 'migracao' AND abertura_id IS NOT NULL AND referencia_data IS NOT NULL) OR (origem = 'novo' AND abertura_id IS NULL AND entregue_em IS NOT NULL AND planilha_referencia IS NULL)"],
    ['chk_dividas_valor', 'valor > 0'], ['chk_dividas_situacao', "situacao IN ('valido', 'substituido')"], ['chk_dividas_correcao', correcao],
    ['chk_dividas_registrado_em', 'registrado_em > 0'], ['chk_dividas_operation_key', nv('operation_key')],
  ],
  gf_repasse_divida_parcelas: [['chk_parcelas_sequencia', 'sequencia > 0'], ['chk_parcelas_valor', 'valor > 0']],
  gf_repasse_pagamentos: [
    ['chk_pagamentos_id', nv('id')], ['chk_pagamentos_tarot_id', nv('tarot_id')], ['chk_pagamentos_valor', 'valor >= 0'],
    ['chk_pagamentos_periodo', 'periodo_inicio <= periodo_fim'], ['chk_pagamentos_situacao', "situacao IN ('valido', 'substituido')"],
    ['chk_pagamentos_correcao', correcao], ['chk_pagamentos_registrado_em', 'registrado_em > 0'], ['chk_pagamentos_operation_key', nv('operation_key')],
  ],
  gf_repasse_pagamento_descontos: [['chk_descontos_valor', 'valor > 0']],
  gf_repasse_ajustes: [
    ['chk_ajustes_id', nv('id')], ['chk_ajustes_tarot_id', nv('tarot_id')], ['chk_ajustes_tipo', "tipo IN ('bonus', 'outro', 'desconto')"],
    ['chk_ajustes_descricao', nt('descricao')], ['chk_ajustes_periodo', 'periodo_inicio <= periodo_fim'],
    ['chk_ajustes_situacao', "situacao IN ('valido', 'substituido')"], ['chk_ajustes_correcao', correcao],
    ['chk_ajustes_registrado_em', 'registrado_em > 0'], ['chk_ajustes_operation_key', nv('operation_key')],
  ],
  gf_repasse_cancelamentos: [
    ['chk_cancelamentos_id', nv('id')], ['chk_cancelamentos_consulta_id', nv('consulta_id')], ['chk_cancelamentos_tarot_id', nv('tarot_id')],
    ['chk_cancelamentos_cliente_id', nv('cliente_id')], ['chk_cancelamentos_queixa', `${nt('queixa')} AND char_length(queixa) <= 4000`],
    ['chk_cancelamentos_situacao', "situacao IN ('pendente', 'mantido', 'retirado')"],
    ['chk_cancelamentos_decisao', `(situacao = 'pendente' AND motivo_decisao IS NULL AND decidido_por IS NULL AND decidido_em IS NULL) OR (situacao <> 'pendente' AND motivo_decisao IS NOT NULL AND ${nt('motivo_decisao')} AND decidido_por IS NOT NULL AND decidido_em IS NOT NULL AND decidido_em >= registrado_em)`],
    ['chk_cancelamentos_registrado_em', 'registrado_em > 0'], ['chk_cancelamentos_operation_key', nv('operation_key')],
  ],
  gf_auditoria: [
    ['chk_auditoria_id', nv('id')], ['chk_auditoria_ocorrido_em', 'ocorrido_em > 0'],
    ['chk_auditoria_ator_funcao', "ator_funcao IN ('administradora', 'assistente', 'supervisora', 'atendente', 'tarologa')"],
    ['chk_auditoria_acao', nv('acao')], ['chk_auditoria_entidade', nv('entidade')], ['chk_auditoria_entidade_id', nv('entidade_id')],
    ['chk_auditoria_motivo', `motivo IS NULL OR ${nt('motivo')}`], ['chk_auditoria_operation_key', nv('operation_key')],
  ],
  gf_escalas_semanais: [
    ['chk_escalas_id_tarologo', nv('id_tarologo')],
    ['chk_escalas_weekday', "weekday IN ('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo')"],
    ['chk_escalas_hours', nt('hours')],
  ],
  gf_horarios_excecoes: [
    ['chk_horarios_excecoes_id', nv('id')], ['chk_horarios_excecoes_id_tarologo', nv('id_tarologo')],
    ['chk_horarios_excecoes_periodo', 'data_fim >= data_inicio'],
    ['chk_horarios_excecoes_ausencia', "absence_type IN ('Nenhuma', 'Férias', 'Licença', 'Folga estendida')"],
    ['chk_horarios_excecoes_horas', nt('today_hours')], ['chk_horarios_excecoes_operation_key', nv('operation_key')],
  ],
  gf_horarios_periodos: [
    ['chk_horarios_periodos_ordem', 'ordem BETWEEN 1 AND 3'], ['chk_horarios_periodos_inicio_fim', 'inicio <> fim'],
  ],
  gf_agenda: [
    ['chk_agenda_id', nv('id')], ['chk_agenda_numero', 'numero_publico > 0'], ['chk_agenda_id_tarologo', nv('id_tarologo')],
    ['chk_agenda_id_cliente', nv('id_cliente')], ['chk_agenda_posicao', 'posicao >= 0'], ['chk_agenda_versao', 'version >= 1'],
    ['chk_agenda_desfecho', "agenda_outcome IS NULL OR agenda_outcome IN ('Concluída', 'Cancelada')"],
    ['chk_agenda_item', "jsonb_typeof(item) = 'object'"], ['chk_agenda_criado_por', nt('criado_por')], ['chk_agenda_operation_key', nv('operation_key')],
  ],
  gf_agenda_eventos: [
    ['chk_agenda_eventos_id', nv('id')], ['chk_agenda_eventos_id_agenda', nv('id_agenda')],
    ['chk_agenda_eventos_tipo', "tipo IN ('criacao', 'contato', 'observacao', 'prazo', 'saida', 'resolucao', 'agendamento', 'estado')"],
    ['chk_agenda_eventos_ref', 'evento_ref IS NULL OR char_length(evento_ref) > 0'], ['chk_agenda_eventos_ator_nome', nt('ator_nome')],
    ['chk_agenda_eventos_ator_perfil', "ator_perfil IN ('administradora', 'assistente', 'supervisora', 'atendente', 'tarologa')"],
    ['chk_agenda_eventos_versao', 'versao >= 1'], ['chk_agenda_eventos_operation_key', nv('operation_key')],
  ],
  gf_consultas_ext: [
    ['chk_consultas_ext_id', nv('id')], ['chk_consultas_ext_tarologo', nv('id_tarologo')], ['chk_consultas_ext_cliente', nv('id_cliente')],
    ['chk_consultas_ext_status', "status IN ('Em curso', 'Finalizada pelo tarólogo', 'Concluída', 'Cancelada', 'Devolvida', 'Não houve', 'Desistiu', 'Anulada', 'Erro')"],
    ['chk_consultas_ext_perfil', "perfil_pagamento IS NULL OR perfil_pagamento IN ('Pré-paga', 'Pós-paga')"],
    ['chk_consultas_ext_comissao', 'comissao_percentual >= 0 AND comissao_percentual <= 100'], ['chk_consultas_ext_duracao', 'duracao_segundos >= 0'],
    ['chk_consultas_ext_versao', 'version >= 1'], ['chk_consultas_ext_item', "jsonb_typeof(item) = 'object'"],
    ['chk_consultas_ext_legado_id', "id_consulta_legado IS NULL OR id_consulta_legado ~ '^[0-9]{1,10}$'"],
    ['chk_consultas_ext_legado_estado', "legado_estado IN ('nao_espelhada', 'pendente', 'espelhada', 'sem_tarologo', 'erro')"],
    ['chk_consultas_ext_criado_por', nt('criado_por')], ['chk_consultas_ext_operation_key', nv('operation_key')],
  ],
  gf_consultas_eventos: [
    ['chk_consultas_eventos_id', nv('id')], ['chk_consultas_eventos_consulta', nv('id_consulta')],
    ['chk_consultas_eventos_tipo', "tipo IN ('lancamento', 'inicio', 'pausa', 'retomada', 'termino', 'conferencia', 'correcao', 'mais_tempo', 'desfecho', 'revisao', 'compensacao', 'edicao', 'reabertura', 'agenda', 'espelho')"],
    ['chk_consultas_eventos_ref', 'evento_ref IS NULL OR char_length(evento_ref) > 0'], ['chk_consultas_eventos_ator_nome', nt('ator_nome')],
    ['chk_consultas_eventos_ator_perfil', "ator_perfil IN ('administradora', 'assistente', 'supervisora', 'atendente', 'tarologa', 'sistema')"],
    ['chk_consultas_eventos_versao', 'versao >= 1'], ['chk_consultas_eventos_operation_key', nv('operation_key')],
  ],
  gf_agenda_ordem_comandos: [
    ['chk_agenda_ordem_id', nv('id')], ['chk_agenda_ordem_fila', nv('fila')], ['chk_agenda_ordem_base', nv('base_revision')],
    ['chk_agenda_ordem_status', "status IN ('applied', 'rejected', 'superseded')"],
    ['chk_agenda_ordem_motivo', "motivo IS NULL OR motivo IN ('authority', 'stale', 'concurrent')"],
    ['chk_agenda_ordem_ator_papel', "ator_papel IN ('administradora', 'assistente', 'supervisora', 'atendente')"],
    ['chk_agenda_ordem_ator_nome', nt('ator_nome')], ['chk_agenda_ordem_operation_key', nv('operation_key')],
  ],
  gf_presenca_estado: [
    ['chk_presenca_estado_id_tarologo', nv('id_tarologo')],
    ['chk_presenca_estado_turno', "shift_status IN ('Disponível', 'Em pausa', 'Offline')"],
    ['chk_presenca_estado_saida', "shift_exit IS NULL OR shift_exit IN ('ended', 'return', 'missing', 'shift-ended')"],
    ['chk_presenca_estado_pausa', "pause_reason IS NULL OR pause_reason IN ('Volta logo', 'Refeição', 'Não disse')"],
    ['chk_presenca_estado_retorno', 'return_until IS NULL OR expected_return IS NULL OR return_until > expected_return'],
    ['chk_presenca_estado_revisao', 'revisao >= 1'],
  ],
  gf_presenca_confirmacoes: [
    ['chk_presenca_confirmacoes_id_tarologo', nv('id_tarologo')], ['chk_presenca_confirmacoes_motivo', "reason IN ('manual', 'inactivity')"],
    ['chk_presenca_confirmacoes_prazo', 'deadline_at IS NULL OR deadline_at >= requested_at'],
  ],
  gf_presenca_historico: [
    ['chk_presenca_historico_id', nv('id')], ['chk_presenca_historico_id_tarologo', nv('id_tarologo')], ['chk_presenca_historico_ator', nt('actor_name')],
    ['chk_presenca_historico_ordem', 'ordem >= 1'],
  ],
  gf_tarologos_perfil: [
    ['chk_tarologos_perfil_id', nv('tarot_id')], ['chk_tarologos_perfil_legado', 'id_legado IS NULL OR id_legado > 0'],
    ['chk_tarologos_perfil_conta', `conta_slug IS NULL OR ${nv('conta_slug')}`], ['chk_tarologos_perfil_nome', `nome IS NULL OR ${nt('nome')}`],
    ['chk_tarologos_perfil_perfil', "jsonb_typeof(perfil) = 'object'"], ['chk_tarologos_perfil_revisao', 'revisao >= 1'],
    ['chk_tarologos_perfil_ator', nt('atualizado_por')], ['chk_tarologos_perfil_registro', `registro_id IS NULL OR ${nv('registro_id')}`],
  ],
  gf_cadastros_tarologo: [
    ['chk_cadastros_tarologo_id', nv('id')], ['chk_cadastros_tarologo_dados', "jsonb_typeof(dados) = 'object'"],
    ['chk_cadastros_tarologo_status', "status IN ('pending', 'approved')"], ['chk_cadastros_tarologo_revisao', 'revisao >= 1'],
    ['chk_cadastros_tarologo_tarot', `tarot_id IS NULL OR ${nv('tarot_id')}`],
    ['chk_cadastros_tarologo_aprovado', "status <> 'approved' OR tarot_id IS NOT NULL"], ['chk_cadastros_tarologo_ator', nt('atualizado_por')],
  ],
  gf_cadastros_tarologo_envios: [
    ['chk_cadastros_envios_chave', "chave_hash ~ '^[0-9a-f]{64}$'"], ['chk_cadastros_envios_impressao', "impressao ~ '^[0-9a-f]{64}$'"],
  ],
  gf_cadastros_tarologo_links: [
    ['chk_cadastros_links_token', "token_hash ~ '^[0-9a-f]{64}$'"], ['chk_cadastros_links_revisao', 'revisao_emitida >= 1'],
    ['chk_cadastros_links_criado_por', nt('criado_por')],
  ],
  gf_cadastros_tarologo_novos_links: [
    ['chk_cadastros_novos_links_id', nv('id')], ['chk_cadastros_novos_links_token', "token_hash ~ '^[0-9a-f]{64}$'"],
    ['chk_cadastros_novos_links_prazo', 'expira_em > emitido_em'], ['chk_cadastros_novos_links_criado_por', nt('criado_por')],
    ['chk_cadastros_novos_links_estado', 'consumido_em IS NULL OR revogado_em IS NULL'],
  ],
  gf_clientes_ext: [
    ['chk_clientes_ext_id', "id_cliente ~ '^[1-9][0-9]{0,9}$'"],
    ['chk_clientes_ext_perfil', "perfil_pagamento IS NULL OR perfil_pagamento IN ('Pré-pago', 'Pós-pago')"],
    ['chk_clientes_ext_dados', "jsonb_typeof(dados) = 'object'"], ['chk_clientes_ext_revisao', 'revisao >= 1'],
    ['chk_clientes_ext_ator', nt('atualizado_por')], ['chk_clientes_ext_operation_key', nv('operation_key')],
  ],
  gf_precos_versoes: [
    ['chk_precos_versoes_id', nv('id')], ['chk_precos_versoes_item', "jsonb_typeof(item) = 'object'"],
    ['chk_precos_versoes_campos', "jsonb_typeof(item -> 'changedFields') = 'array' AND jsonb_array_length(item -> 'changedFields') > 0"],
    ['chk_precos_versoes_criado_por', nt('criado_por')], ['chk_precos_versoes_operation_key', nv('operation_key')],
  ],
  gf_pagamentos: [
    ['chk_pagamentos_id', nv('id')], ['chk_pagamentos_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"],
    ['chk_pagamentos_status', "status IN ('Informado', 'Corrigido', 'Em conferência', 'Cancelado')"],
    ['chk_pagamentos_confirmacao', "confirmacao IS NULL OR confirmacao IN ('Confirmado', 'A confirmar')"],
    ['chk_pagamentos_valor', 'valor_centavos > 0'], ['chk_pagamentos_metodo', "metodo IN ('PIX', 'Cartão de crédito', 'Transferência', 'Depósito', 'Dinheiro')"],
    ['chk_pagamentos_consulta', 'id_consulta IS NULL OR char_length(id_consulta) > 0'],
    ['chk_pagamentos_item', "jsonb_typeof(item) = 'object'"], ['chk_pagamentos_versao', 'version >= 1'],
    ['chk_pagamentos_criado_por', nt('criado_por')], ['chk_pagamentos_operation_key', nv('operation_key')],
  ],
  gf_pagamentos_eventos: [
    ['chk_pagamentos_eventos_id', nv('id')], ['chk_pagamentos_eventos_pagamento', nv('id_pagamento')],
    ['chk_pagamentos_eventos_tipo', "tipo IN ('lancamento', 'correcao', 'confirmacao', 'cancelamento', 'movimento', 'vinculo', 'revisao')"],
    ['chk_pagamentos_eventos_ator_nome', nt('ator_nome')],
    ['chk_pagamentos_eventos_ator_perfil', "ator_perfil IN ('administradora', 'assistente', 'supervisora', 'atendente')"],
    ['chk_pagamentos_eventos_versao', 'versao >= 1'], ['chk_pagamentos_eventos_operation_key', nv('operation_key')],
  ],
  gf_beneficios_minutos: [
    ['chk_beneficios_id', nv('id')], ['chk_beneficios_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_beneficios_tipo', "tipo IN ('Bônus', 'Cortesia')"],
    ['chk_beneficios_minutos', 'minutos >= 1 AND minutos <= 1440'], ['chk_beneficios_item', "jsonb_typeof(item) = 'object'"],
    ['chk_beneficios_concedido_por', nt('concedido_por')], ['chk_beneficios_operation_key', nv('operation_key')],
  ],
  gf_saldos_partida: [
    ['chk_saldos_partida_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_saldos_partida_fonte', nv('fonte')],
    ['chk_saldos_partida_ator', nt('congelado_por')], ['chk_saldos_partida_operation_key', nv('operation_key')],
  ],
  gf_restricoes: [
    ['chk_restricoes_id', nv('id')], ['chk_restricoes_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_restricoes_tarologo', nv('id_tarologo')],
    ['chk_restricoes_solicitante', "solicitante IN ('tarologist', 'client')"], ['chk_restricoes_item', "jsonb_typeof(item) = 'object'"],
    ['chk_restricoes_versao', 'version >= 1'], ['chk_restricoes_criado_por', nt('criado_por')], ['chk_restricoes_operation_key', nv('operation_key')],
  ],
  gf_recados: [
    ['chk_recados_id', nv('id')], ['chk_recados_tarologo', nv('id_tarologo')], ['chk_recados_origem', "origem IN ('schedule', 'staff', 'tarologist')"],
    ['chk_recados_ator', "id_ator IS NULL OR " + nv('id_ator')], ['chk_recados_resposta', "id_resposta_a IS NULL OR (" + nv('id_resposta_a') + " AND id_resposta_a <> id)"],
    ['chk_recados_item', "jsonb_typeof(item) = 'object'"], ['chk_recados_versao', 'version >= 1'], ['chk_recados_criado_por', nt('criado_por')], ['chk_recados_operation_key', nv('operation_key')],
  ],
  gf_recados_pessoais: [
    ['chk_recados_pessoais_recado', nv('id_recado')], ['chk_recados_pessoais_conta', nv('id_conta')],
    ['chk_recados_pessoais_leitura', '(lido_em IS NULL AND lido_por IS NULL AND lido_versao IS NULL) OR (lido_em IS NOT NULL AND lido_por IS NOT NULL AND lido_versao IS NOT NULL)'],
    ['chk_recados_pessoais_arquivado', "arquivado IS NULL OR jsonb_typeof(arquivado) = 'object'"], ['chk_recados_pessoais_operation_key', nv('operation_key')],
  ],
  gf_agenda_admissoes: [
    ['chk_agenda_admissoes_id', nv('id')], ['chk_agenda_admissoes_tarologo', nv('id_tarologo')],
    ['chk_agenda_admissoes_modo', "modo IN ('open', 'no_more', 'until_end', 'on_return', 'count')"],
    ['chk_agenda_admissoes_item', "jsonb_typeof(item) = 'object'"], ['chk_agenda_admissoes_criado_por', nt('criado_por')], ['chk_agenda_admissoes_operation_key', nv('operation_key')],
  ],
  gf_agenda_solicitacoes: [
    ['chk_agenda_solicitacoes_id', nv('id')], ['chk_agenda_solicitacoes_tarologo', nv('id_tarologo')], ['chk_agenda_solicitacoes_cliente', nv('id_cliente')],
    ['chk_agenda_solicitacoes_versao', 'version >= 1'], ['chk_agenda_solicitacoes_item', "jsonb_typeof(item) = 'object'"],
    ['chk_agenda_solicitacoes_criado_por', nt('criado_por')], ['chk_agenda_solicitacoes_operation_key', nv('operation_key')],
  ],
  gf_agenda_contatos: [
    ['chk_agenda_contatos_id', nv('id')], ['chk_agenda_contatos_codigo', 'codigo IS NULL OR char_length(codigo) > 0'],
    ['chk_agenda_contatos_versao', 'version >= 1'], ['chk_agenda_contatos_item', "jsonb_typeof(item) = 'object'"],
    ['chk_agenda_contatos_criado_por', nt('criado_por')], ['chk_agenda_contatos_operation_key', nv('operation_key')],
  ],
  gf_divergencias: [
    ['chk_divergencias_id', nv('id')], ['chk_divergencias_tipo', "tipo IN ('Operacional', 'Financeira')"], ['chk_divergencias_area', "area IN ('Consulta', 'Pagamento', 'Repasse')"],
    ['chk_divergencias_situacao', "situacao IN ('Pendente', 'Em conferência', 'Resolvida', 'Arquivada')"],
    ['chk_divergencias_cliente', "id_cliente IS NULL OR id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_divergencias_tarologo', 'id_tarologo IS NULL OR ' + nv('id_tarologo')],
    ['chk_divergencias_reportador', 'id_reportador IS NULL OR ' + nv('id_reportador')], ['chk_divergencias_consulta', 'id_consulta IS NULL OR ' + nv('id_consulta')],
    ['chk_divergencias_pagamento', 'id_pagamento IS NULL OR ' + nv('id_pagamento')], ['chk_divergencias_item', "jsonb_typeof(item) = 'object'"],
    ['chk_divergencias_versao', 'version >= 1'], ['chk_divergencias_criado_por', nt('criado_por')], ['chk_divergencias_operation_key', nv('operation_key')],
  ],
  gf_migracao_historicos: [
    ['chk_migracao_historicos_id', nv('id')], ['chk_migracao_historicos_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_migracao_historicos_seq', 'seq >= 1'],
    ['chk_migracao_historicos_source_key', nv('source_key')], ['chk_migracao_historicos_source_hash', "source_hash ~ '^[0-9a-f]{64}$'"], ['chk_migracao_historicos_batch', nv('batch_id')], ['chk_migracao_historicos_corte', nt('corte_em')],
    ['chk_migracao_historicos_credito', 'credito_centavos >= 0'], ['chk_migracao_historicos_debito', 'debito_centavos >= 0'],
    ['chk_migracao_historicos_item', "jsonb_typeof(item) = 'object'"], ['chk_migracao_historicos_criado_por', nt('criado_por')], ['chk_migracao_historicos_operation_key', nv('operation_key')],
  ],
  gf_lilly_vinculos: [
    ['chk_lilly_vinculos_id', nv('id')], ['chk_lilly_vinculos_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_lilly_vinculos_contato', nv('umbler_contact_id')],
    ['chk_lilly_vinculos_conversa', nv('umbler_conversation_id')], ['chk_lilly_vinculos_attribution', "attribution IS NULL OR jsonb_typeof(attribution) = 'object'"],
  ],
  gf_lilly_eventos: [
    ['chk_lilly_eventos_id', nv('id')], ['chk_lilly_eventos_source', "source IN ('umbler', 'site')"], ['chk_lilly_eventos_conversa', 'conversation_id IS NULL OR ' + nv('conversation_id')],
    ['chk_lilly_eventos_actor', "actor IN ('client', 'contact', 'staff', 'tarologist', 'lilly', 'system')"],
    ['chk_lilly_eventos_data', "jsonb_typeof(data) = 'object'"], ['chk_lilly_eventos_staff', 'staff_authorized = false OR (actor = \'staff\' AND internal = true AND staff_id IS NOT NULL)'],
  ],
  gf_lilly_acoes: [
    ['chk_lilly_acoes_chave', nv('chave_interna')], ['chk_lilly_acoes_original', nt('chave_original')], ['chk_lilly_acoes_hash', "hash_corpo ~ '^[0-9a-f]{64}$'"],
    ['chk_lilly_acoes_kind', nv('kind')], ['chk_lilly_acoes_estado', "estado IN ('em_execucao', 'confirmada', 'recusada', 'incerta')"],
    ['chk_lilly_acoes_resultado', "resultado IS NULL OR jsonb_typeof(resultado) = 'object'"],
  ],
  gf_lilly_notas_horario: [
    ['chk_lilly_notas_id', nv('id')], ['chk_lilly_notas_tarologo', nv('tarologist_id')], ['chk_lilly_notas_status', "status IN ('waiting', 'arrived', 'resolved')"],
    ['chk_lilly_notas_texto', nt('texto')], ['chk_lilly_notas_fim', 'ends_at IS NULL OR expected_at IS NULL OR ends_at >= expected_at'],
  ],
  gf_lilly_pagamento_refs: [
    ['chk_lilly_refs_pagamento', nv('payment_id')], ['chk_lilly_refs_reference', 'reference IS NULL OR ' + nv('reference')],
  ],
  // Cliente criada pela Lilly NO BANCO NOVO (sem linha em `usuarios`, que é legado somente leitura). Nomes vazios enquanto desconhecidos; nascimento NULL.
  gf_clientes_novos: [
    ['chk_clientes_novos_id', "id_cliente ~ '^[1-9][0-9]{9}$' AND id_cliente >= '1000000000' AND id_cliente <= '2147483647'"],
    ['chk_clientes_novos_nomes', 'nome = trim(nome) AND nome_id = trim(nome_id) AND nome2 = trim(nome2)'],
    ['chk_clientes_novos_nascimento', "data_nascimento IS NULL OR data_nascimento >= DATE '1900-01-01'"],
    ['chk_clientes_novos_email', 'email IS NULL OR ' + nv('email')], ['chk_clientes_novos_telefone', 'telefone IS NULL OR ' + nv('telefone')],
    ['chk_clientes_novos_origem', "origem IN ('lilly')"], ['chk_clientes_novos_operation_key', nv('operation_key')],
  ],
  // Pedido de mais tempo: registro e auditoria, NUNCA minutos, cobrança nem encerramento (altera_duracao e encerra_consulta sempre falsos).
  gf_lilly_mais_tempo: [
    ['chk_lilly_mais_tempo_id', nv('id')], ['chk_lilly_mais_tempo_consulta', nv('consulta_id')], ['chk_lilly_mais_tempo_ciclo', 'ciclo >= 1'],
    ['chk_lilly_mais_tempo_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_lilly_mais_tempo_tarologo', nv('id_tarologo')],
    ['chk_lilly_mais_tempo_evento', nv('source_event_id')], ['chk_lilly_mais_tempo_rotulo', nt('rotulo')],
    ['chk_lilly_mais_tempo_sem_efeito', 'altera_duracao = FALSE AND encerra_consulta = FALSE'],
  ],
  gf_lilly_cotacoes: [
    ['chk_lilly_cotacoes_id', nv('id')], ['chk_lilly_cotacoes_conversa', nv('conversation_id')], ['chk_lilly_cotacoes_cliente', "id_cliente IS NULL OR id_cliente ~ '^[1-9][0-9]{0,9}$'"],
    ['chk_lilly_cotacoes_valor', 'amount_centavos >= 0'], ['chk_lilly_cotacoes_minutos', 'minutes > 0'],
  ],
  gf_lilly_avisos: [
    ['chk_lilly_avisos_id', nv('id')], ['chk_lilly_avisos_conversa', nv('conversation_id')], ['chk_lilly_avisos_cliente', "id_cliente IS NULL OR id_cliente ~ '^[1-9][0-9]{0,9}$'"],
  ],
  gf_ponto_turnos: [
    ['chk_ponto_turnos_id', nv('id')], ['chk_ponto_turnos_conta', nv('id_conta')], ['chk_ponto_turnos_revisao', 'revisao >= 1'],
    ['chk_ponto_turnos_conteudo', "jsonb_typeof(conteudo) = 'object'"], ['chk_ponto_turnos_fim', 'ultimo_em >= iniciado_em'],
  ],
  gf_ponto_escalas: [
    ['chk_ponto_escalas_conta', nv('id_conta')], ['chk_ponto_escalas_revisao', 'revisao >= 1'], ['chk_ponto_escalas_autor', nv('atualizado_por')],
    ['chk_ponto_escalas_conteudo', "jsonb_typeof(conteudo) = 'object'"],
  ],
  gf_ponto_eventos: [
    ['chk_ponto_eventos_id', nv('id')], ['chk_ponto_eventos_conta', nv('id_conta')], ['chk_ponto_eventos_conteudo', "jsonb_typeof(conteudo) = 'object'"],
  ],
  gf_operacoes: [['chk_operacoes_chave', nv('chave')], ['chk_operacoes_escopo', nv('escopo')], ['chk_operacoes_hash', "hash_corpo ~ '^[0-9a-f]{64}$'"]],
  gf_welcome: [['chk_welcome_id', nv('id')], ['chk_welcome_revisao', 'revisao >= 1']],
  gf_contas_ext: [
    ['chk_contas_ext_legacy', 'legacy_id IS NULL OR ' + nv('legacy_id')], ['chk_contas_ext_avatar', 'avatar IS NULL OR char_length(avatar) <= 4500000'],
    ['chk_contas_ext_revisao', 'revisao >= 1'],
  ],
  gf_pendencias_encaminhamentos: [
    ['chk_pendencias_chave', nv('chave')], ['chk_pendencias_fila', "fila IN ('atendimento', 'supervisao', 'financeiro', 'administracao')"],
    ['chk_pendencias_item', "jsonb_typeof(item) = 'object'"], ['chk_pendencias_versao', 'version >= 1'],
    ['chk_pendencias_criado_por', nt('criado_por')], ['chk_pendencias_operation_key', nv('operation_key')],
  ],
  gf_clientes_orientacoes: [
    ['chk_orientacoes_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_orientacoes_item', "jsonb_typeof(item) = 'object'"], ['chk_orientacoes_revisao', 'revisao >= 1'],
    ['chk_orientacoes_atualizado_por', nt('atualizado_por')], ['chk_orientacoes_operation_key', nv('operation_key')],
  ],
  gf_clientes_notas: [
    ['chk_notas_cliente_id', nv('id')], ['chk_notas_cliente', "id_cliente ~ '^[1-9][0-9]{0,9}$'"], ['chk_notas_item', "jsonb_typeof(item) = 'object'"],
    ['chk_notas_versao', 'version >= 1'], ['chk_notas_criado_por', nt('criado_por')], ['chk_notas_operation_key', nv('operation_key')],
  ],
  gf_motivos_financeiros: [
    ['chk_motivos_id', nv('id')], ['chk_motivos_item', "jsonb_typeof(item) = 'object'"], ['chk_motivos_versao', 'version >= 1'],
    ['chk_motivos_criado_por', nt('criado_por')], ['chk_motivos_operation_key', nv('operation_key')],
  ],
  gf_adicionais_itens: [
    ['chk_adicionais_chave', nv('chave')], ['chk_adicionais_tipo', "tipo IN ('categoria', 'regra', 'ocorrencia')"], ['chk_adicionais_item', "jsonb_typeof(item) = 'object'"],
    ['chk_adicionais_versao', 'version >= 1'], ['chk_adicionais_criado_por', nt('criado_por')], ['chk_adicionais_operation_key', nv('operation_key')],
  ],
  gf_log_operacional: [
    ['chk_log_operacional_id', nv('id')], ['chk_log_operacional_categoria', "categoria IN ('agenda', 'cliente', 'consulta', 'mais-tempo', 'pagamento', 'profissional')"],
    ['chk_log_operacional_item', "jsonb_typeof(item) = 'object'"], ['chk_log_operacional_por', nt('registrado_por')], ['chk_log_operacional_conta', nv('conta_id')],
    ['chk_log_operacional_operation_key', nv('operation_key')],
  ],
  // Legado como fonte (Maturacao/46): uma linha por escrita no legado (antes/depois só das colunas do legado) + as recusas da trava de banco.
  gf_legado_intencoes: [
    ['chk_legado_intencoes_id', nv('id')], ['chk_legado_intencoes_entidade', "entidade IN ('clientes', 'tarologos', 'consultas', 'pagamentos', 'trava')"],
    ['chk_legado_intencoes_estado', "estado IN ('iniciada', 'concluida', 'revertida', 'divergente', 'recusada')"],
    ['chk_legado_intencoes_antes', "antes IS NULL OR jsonb_typeof(antes) = 'object'"], ['chk_legado_intencoes_depois', "depois IS NULL OR jsonb_typeof(depois) = 'object'"],
  ],
  // Trava da ficha do ASP (Maturacao/53): conferências pós-gravação de cada campo do legado (cliente: nome_id, nome2, datanascimento; tarólogo: nmuTarologo).
  gf_legado_verificacoes: [
    ['chk_legado_verificacoes_id', nv('id')], ['chk_legado_verificacoes_intencao', nv('intencao_id')], ['chk_legado_verificacoes_entidade', "entidade IN ('clientes', 'tarologos')"],
    ['chk_legado_verificacoes_coluna', "coluna IN ('nome_id', 'nome2', 'datanascimento', 'nmuTarologo')"],
    ['chk_legado_verificacoes_estado', "estado IN ('pendente', 'ok', 'reaplicada', 'divergente', 'encerrada')"], ['chk_legado_verificacoes_etapa', 'etapa >= 0'],
  ],
};

/**
 * CHECKs de colunas acrescentadas DEPOIS da criação da tabela (migração 20261128000000, espelho no legado). Ficam à parte de `CHECKS` porque as
 * migrações antigas criam a tabela com `CHECKS[tabela]` ANTES de essas colunas existirem; a migração nova os aplica por ALTER e o `sync` dos
 * models (`_definir.js`) os junta aos de `CHECKS`.
 */
const ESTADOS_ESPELHO = "('nao_espelhada', 'pendente', 'espelhada', 'sem_registro', 'erro', 'reaplicada', 'divergente')";
const ESTADOS_PAGTO_NOTA = "('nao_espelhada', 'espelhada', 'recusada', 'desatualizada', 'erro')";
const CHECKS_ESPELHO = {
  // Convite/permissão (v706): a migração 20261210 os cria depois das colunas, por isso ficam fora de CHECKS (CREATE TABLE da contas-config).
  gf_contas_ext: [
    ['chk_contas_ext_convite', "(convite_hash IS NULL AND convite_tipo IS NULL AND convite_emitido IS NULL AND convite_expira IS NULL) OR (convite_hash ~ '^[0-9a-f]{64}$' AND convite_tipo IN ('first-access', 'reset-password') AND convite_emitido IS NOT NULL AND convite_expira > convite_emitido)"],
    ['chk_contas_ext_trilha', "jsonb_typeof(permissoes_trilha) = 'array'"],
  ],
  gf_clientes_ext: [
    ['chk_clientes_ext_legado_estado', `legado_estado IN ${ESTADOS_ESPELHO}`], ['chk_clientes_ext_legado_pendentes', "jsonb_typeof(legado_pendentes) = 'array'"],
  ],
  gf_pagamentos: [
    ['chk_pagamentos_legado_id', "legado_id IS NULL OR legado_id ~ '^[0-9]{1,10}$'"], ['chk_pagamentos_legado_estado', `legado_estado IN ${ESTADOS_PAGTO_NOTA}`],
  ],
  gf_clientes_notas: [
    ['chk_clientes_notas_legado_id', "legado_id IS NULL OR legado_id ~ '^[0-9]{1,10}$'"], ['chk_clientes_notas_legado_estado', `legado_estado IN ${ESTADOS_PAGTO_NOTA}`],
  ],
  gf_tarologos_perfil: [
    ['chk_tarologos_perfil_espelho_estado', `legado_estado IN ${ESTADOS_ESPELHO}`], ['chk_tarologos_perfil_espelho_pendentes', "jsonb_typeof(legado_pendentes) = 'array'"],
  ],
};

/**
 * CHECKs de colunas acrescentadas pela migração 20261211000000 (Lilly v708). À parte de `CHECKS_ESPELHO` porque a migração do espelho (20261128) aplica
 * TODA a lista de `CHECKS_ESPELHO` antes de a coluna existir. Situação cadastral: NULL = ainda não avaliada (NUNCA preencher o legado em massa);
 * NÃO é o `perfil_pagamento` (Pré/Pós).
 */
const CHECKS_LILLY_V708 = {
  gf_clientes_ext: [
    ['chk_clientes_ext_situacao_cadastral', "situacao_cadastral IS NULL OR situacao_cadastral IN ('dados_pendentes', 'completo')"],
  ],
};

module.exports = { CHECKS, CHECKS_ESPELHO, CHECKS_LILLY_V708 };
