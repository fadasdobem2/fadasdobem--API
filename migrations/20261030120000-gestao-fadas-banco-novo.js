'use strict';

/**
 * Gestão Fadas, BANCO NOVO (decisão do produto, 29/10): os dados novos do sistema B vivem no PostgreSQL da API A,
 * nunca no legado do ASP32. Esta migração porta, em dialeto Postgres, as tabelas `gf_*` que existiam em MySQL
 * (src/gestao-fadas/fontes/migrations-gf/): `gf_auditoria`, as 10 `gf_repasse_*` e `gf_tarologos_ext`; mais `gf_operacoes`
 * (idempotência genérica) e `gf_welcome` (revisão otimista do texto de boas-vindas).
 *
 * Diferenças em relação ao MySQL:
 *  - quem assina (`registrado_por`, `lancado_por`, `confirmado_por`, `resolvida_por`, `decidido_por`, `ator_conta_id`,
 *    `atualizado_por`) é o USUÁRIO da A: UUID com FK real para `users(id)`; `gf_auth_accounts` deixa de existir;
 *  - DATETIME vira `timestamp` (relógio de parede, sem fuso); `antes`/`depois` da auditoria viram `jsonb`;
 *  - os únicos de idempotência (`operation_key`, `corrige_id`, revisão, vigência) são ÍNDICES ÚNICOS (idempotentes);
 *  - as identidades legadas (`tarot_id`, `consulta_id`, `cliente_id`) seguem em texto e sem FK (o legado é outro banco).
 * Idempotente: CREATE ... IF NOT EXISTS; não apaga nem altera linhas. As expressões dos CHECKs vêm de
 * src/gestao-fadas/novo/esquema-checks.js, a mesma fonte dos models (o comparador prova que os dois batem).
 */

const { CHECKS } = require('../src/gestao-fadas/novo/esquema-checks');

const ck = (tabela) => CHECKS[tabela].map(([nome, expr]) => `  CONSTRAINT ${nome} CHECK (${expr})`).join(',\n');
const fkUser = (nome, coluna) => `  CONSTRAINT ${nome} FOREIGN KEY (${coluna}) REFERENCES users (id) ON UPDATE RESTRICT ON DELETE RESTRICT`;
const fk = (nome, coluna, tabela, alvo = 'id') => `  CONSTRAINT ${nome} FOREIGN KEY (${coluna}) REFERENCES ${tabela} (${alvo}) ON UPDATE RESTRICT ON DELETE RESTRICT`;
const unico = (nome, tabela, colunas) => `CREATE UNIQUE INDEX IF NOT EXISTS ${nome} ON ${tabela} (${colunas})`;
const indice = (nome, tabela, colunas) => `CREATE INDEX IF NOT EXISTS ${nome} ON ${tabela} (${colunas})`;

const DDL = [
  `CREATE TABLE IF NOT EXISTS gf_auditoria (
  id VARCHAR(64) NOT NULL,
  ocorrido_em BIGINT NOT NULL,
  ator_conta_id UUID NOT NULL,
  ator_funcao VARCHAR(32) NOT NULL,
  acao VARCHAR(64) NOT NULL,
  entidade VARCHAR(64) NOT NULL,
  entidade_id VARCHAR(64) NOT NULL,
  antes JSONB,
  depois JSONB,
  motivo VARCHAR(1000),
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fkUser('fk_auditoria_ator', 'ator_conta_id')},
${ck('gf_auditoria')}
)`,
  unico('uq_auditoria_operation_key', 'gf_auditoria', 'operation_key'),
  indice('idx_auditoria_entidade', 'gf_auditoria', 'entidade, entidade_id, ocorrido_em'),

  `CREATE TABLE IF NOT EXISTS gf_repasse_percentuais (
  id VARCHAR(64) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  percentual NUMERIC(5,2) NOT NULL,
  vigente_desde TIMESTAMP NOT NULL,
  motivo VARCHAR(500),
  registrado_por UUID NOT NULL,
  registrado_em BIGINT NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fkUser('fk_percentuais_registrado_por', 'registrado_por')},
${ck('gf_repasse_percentuais')}
)`,
  unico('uq_percentuais_vigencia', 'gf_repasse_percentuais', 'tarot_id, vigente_desde'),
  unico('uq_percentuais_operation_key', 'gf_repasse_percentuais', 'operation_key'),

  `CREATE TABLE IF NOT EXISTS gf_repasse_calendarios (
  id VARCHAR(64) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  tipo VARCHAR(12) NOT NULL,
  dia_semana VARCHAR(8),
  dias_mes VARCHAR(100),
  politica_fim_semana VARCHAR(20),
  vigente_desde TIMESTAMP NOT NULL,
  motivo VARCHAR(500),
  registrado_por UUID NOT NULL,
  registrado_em BIGINT NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fkUser('fk_calendarios_registrado_por', 'registrado_por')},
${ck('gf_repasse_calendarios')}
)`,
  unico('uq_calendarios_vigencia', 'gf_repasse_calendarios', 'tarot_id, vigente_desde'),
  unico('uq_calendarios_operation_key', 'gf_repasse_calendarios', 'operation_key'),

  `CREATE TABLE IF NOT EXISTS gf_repasse_aberturas (
  id VARCHAR(64) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  revisao INTEGER NOT NULL,
  situacao VARCHAR(12) NOT NULL,
  corrige_revisao INTEGER,
  motivo_correcao VARCHAR(500),
  ultimo_pagamento_data DATE NOT NULL,
  ultimo_pagamento_valor NUMERIC(20,2) NOT NULL,
  planilha_referencia VARCHAR(200) NOT NULL,
  quitado_ate TIMESTAMP NOT NULL,
  saldo_remanescente NUMERIC(20,2) NOT NULL,
  saldo_composicao VARCHAR(2000),
  corte_migracao TIMESTAMP NOT NULL,
  percentual_conferido NUMERIC(5,2) NOT NULL DEFAULT 30,
  lancado_por UUID NOT NULL,
  lancado_em BIGINT NOT NULL,
  confirmado_por UUID,
  confirmado_em BIGINT,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fkUser('fk_aberturas_lancado_por', 'lancado_por')},
${fkUser('fk_aberturas_confirmado_por', 'confirmado_por')},
${ck('gf_repasse_aberturas')}
)`,
  unico('uq_aberturas_revisao', 'gf_repasse_aberturas', 'tarot_id, revisao'),
  unico('uq_aberturas_operation_key', 'gf_repasse_aberturas', 'operation_key'),
  // FK composta para a revisão corrigida: precisa do único acima, então vem depois dele.
  `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_aberturas_corrige' AND conrelid = 'gf_repasse_aberturas'::regclass) THEN
    ALTER TABLE gf_repasse_aberturas ADD CONSTRAINT fk_aberturas_corrige FOREIGN KEY (tarot_id, corrige_revisao)
      REFERENCES gf_repasse_aberturas (tarot_id, revisao) ON UPDATE RESTRICT ON DELETE RESTRICT;
  END IF;
END $$`,

  `CREATE TABLE IF NOT EXISTS gf_repasse_abertura_pendencias (
  id VARCHAR(64) NOT NULL,
  abertura_id VARCHAR(64) NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  valor NUMERIC(20,2),
  resolvida_em BIGINT,
  resolvida_por UUID,
  PRIMARY KEY (id),
${fk('fk_pendencias_abertura', 'abertura_id', 'gf_repasse_aberturas')},
${fkUser('fk_pendencias_resolvida_por', 'resolvida_por')},
${ck('gf_repasse_abertura_pendencias')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_repasse_dividas (
  id VARCHAR(64) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  tipo VARCHAR(8) NOT NULL,
  origem VARCHAR(10) NOT NULL,
  abertura_id VARCHAR(64),
  valor NUMERIC(20,2) NOT NULL,
  entrega_original DATE,
  entregue_em DATE,
  referencia_data DATE,
  situacao VARCHAR(12) NOT NULL,
  corrige_id VARCHAR(64),
  motivo_correcao VARCHAR(500),
  planilha_referencia VARCHAR(200),
  observacao VARCHAR(500),
  registrado_por UUID NOT NULL,
  registrado_em BIGINT NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fk('fk_dividas_abertura', 'abertura_id', 'gf_repasse_aberturas')},
${fk('fk_dividas_corrige', 'corrige_id', 'gf_repasse_dividas')},
${fkUser('fk_dividas_registrado_por', 'registrado_por')},
${ck('gf_repasse_dividas')}
)`,
  unico('uq_dividas_corrige', 'gf_repasse_dividas', 'corrige_id'),
  unico('uq_dividas_operation_key', 'gf_repasse_dividas', 'operation_key'),
  indice('idx_dividas_tarot', 'gf_repasse_dividas', 'tarot_id'),

  `CREATE TABLE IF NOT EXISTS gf_repasse_divida_parcelas (
  divida_id VARCHAR(64) NOT NULL,
  sequencia INTEGER NOT NULL,
  data DATE NOT NULL,
  valor NUMERIC(20,2) NOT NULL,
  PRIMARY KEY (divida_id, sequencia),
${fk('fk_parcelas_divida', 'divida_id', 'gf_repasse_dividas')},
${ck('gf_repasse_divida_parcelas')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_repasse_pagamentos (
  id VARCHAR(64) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  valor NUMERIC(20,2) NOT NULL,
  pago_em DATE NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  saldo_na_data NUMERIC(20,2) NOT NULL,
  situacao VARCHAR(12) NOT NULL,
  corrige_id VARCHAR(64),
  motivo_correcao VARCHAR(500),
  observacao VARCHAR(500),
  registrado_por UUID NOT NULL,
  registrado_em BIGINT NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fk('fk_pagamentos_corrige', 'corrige_id', 'gf_repasse_pagamentos')},
${fkUser('fk_pagamentos_registrado_por', 'registrado_por')},
${ck('gf_repasse_pagamentos')}
)`,
  unico('uq_pagamentos_corrige', 'gf_repasse_pagamentos', 'corrige_id'),
  unico('uq_pagamentos_operation_key', 'gf_repasse_pagamentos', 'operation_key'),
  indice('idx_pagamentos_tarot', 'gf_repasse_pagamentos', 'tarot_id, pago_em'),

  `CREATE TABLE IF NOT EXISTS gf_repasse_pagamento_descontos (
  pagamento_id VARCHAR(64) NOT NULL,
  divida_id VARCHAR(64) NOT NULL,
  valor NUMERIC(20,2) NOT NULL,
  PRIMARY KEY (pagamento_id, divida_id),
${fk('fk_descontos_pagamento', 'pagamento_id', 'gf_repasse_pagamentos')},
${fk('fk_descontos_divida', 'divida_id', 'gf_repasse_dividas')},
${ck('gf_repasse_pagamento_descontos')}
)`,

  `CREATE TABLE IF NOT EXISTS gf_repasse_ajustes (
  id VARCHAR(64) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  tipo VARCHAR(8) NOT NULL,
  valor NUMERIC(20,2) NOT NULL,
  descricao VARCHAR(500) NOT NULL,
  data DATE NOT NULL,
  periodo_inicio DATE NOT NULL,
  periodo_fim DATE NOT NULL,
  abertura_id VARCHAR(64),
  situacao VARCHAR(12) NOT NULL,
  corrige_id VARCHAR(64),
  motivo_correcao VARCHAR(500),
  registrado_por UUID NOT NULL,
  registrado_em BIGINT NOT NULL,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fk('fk_ajustes_abertura', 'abertura_id', 'gf_repasse_aberturas')},
${fk('fk_ajustes_corrige', 'corrige_id', 'gf_repasse_ajustes')},
${fkUser('fk_ajustes_registrado_por', 'registrado_por')},
${ck('gf_repasse_ajustes')}
)`,
  unico('uq_ajustes_corrige', 'gf_repasse_ajustes', 'corrige_id'),
  unico('uq_ajustes_operation_key', 'gf_repasse_ajustes', 'operation_key'),
  indice('idx_ajustes_tarot', 'gf_repasse_ajustes', 'tarot_id, data'),

  `CREATE TABLE IF NOT EXISTS gf_repasse_cancelamentos (
  id VARCHAR(64) NOT NULL,
  consulta_id VARCHAR(16) NOT NULL,
  tarot_id VARCHAR(16) NOT NULL,
  cliente_id VARCHAR(16) NOT NULL,
  queixa TEXT NOT NULL,
  situacao VARCHAR(10) NOT NULL,
  motivo_decisao VARCHAR(1000),
  registrado_por UUID NOT NULL,
  registrado_em BIGINT NOT NULL,
  decidido_por UUID,
  decidido_em BIGINT,
  operation_key VARCHAR(64) NOT NULL,
  PRIMARY KEY (id),
${fkUser('fk_cancelamentos_registrado_por', 'registrado_por')},
${fkUser('fk_cancelamentos_decidido_por', 'decidido_por')},
${ck('gf_repasse_cancelamentos')}
)`,
  unico('uq_cancelamentos_consulta', 'gf_repasse_cancelamentos', 'consulta_id'),
  unico('uq_cancelamentos_operation_key', 'gf_repasse_cancelamentos', 'operation_key'),
  indice('idx_cancelamentos_tarot', 'gf_repasse_cancelamentos', 'tarot_id'),

  `CREATE TABLE IF NOT EXISTS gf_tarologos_ext (
  id_tarologo INTEGER NOT NULL,
  foto_atual_ref VARCHAR(2048),
  primeiro_nome_civil VARCHAR(100),
  personal_whatsapp VARCHAR(45),
  avatar_whatsapp VARCHAR(45),
  situacao_turno VARCHAR(20),
  retorno_previsto_em VARCHAR(40),
  PRIMARY KEY (id_tarologo)
)`,

  // Idempotência genérica: uma operação = (escopo, chave); o hash do corpo distingue repetição de conflito.
  `CREATE TABLE IF NOT EXISTS gf_operacoes (
  escopo VARCHAR(64) NOT NULL,
  chave VARCHAR(128) NOT NULL,
  hash_corpo VARCHAR(64) NOT NULL,
  resposta JSONB,
  criada_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (escopo, chave),
${ck('gf_operacoes')}
)`,

  // Texto de boas-vindas com revisão otimista: gravar exige a revisão lida; outra revisão = conflito.
  `CREATE TABLE IF NOT EXISTS gf_welcome (
  id VARCHAR(32) NOT NULL,
  conteudo JSONB NOT NULL,
  revisao INTEGER NOT NULL DEFAULT 1,
  atualizado_por UUID,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
${fkUser('fk_welcome_atualizado_por', 'atualizado_por')},
${ck('gf_welcome')}
)`,
];

module.exports = {
  async up({ sequelize }) {
    for (const sql of DDL) await sequelize.query(sql);
  },
};
