-- Gestão Fadas, spec 004 (etapa 2): tabelas do repasse e da auditoria, migração de ida.
-- Par: 001_repasses.rollback.sql. Modelo: specs/004-consultas-pagamentos-apuracao/data-model.md, seção 2.
--
-- Preparada para revisão e aplicação MANUAL. Nem a aplicação, nem o build, nem os testes aplicam este arquivo num banco
-- compartilhado; tests/finance-schema-db.test.mjs o ensaia só em containers locais descartáveis, ao lado do núcleo
-- fictício do legado e das tabelas de auth.
-- Cria onze tabelas no banco ATUAL. Em produção é o `fadasdobem`, ao lado do legado e das gf_auth_*; os prefixos
-- `gf_repasse_` e o nome `gf_auditoria` marcam o que esta migração possui. Não cria o banco e não lê, altera nem apaga
-- tabela legada ou de auth. Exige a 001_auth.sql já aplicada: as colunas de quem registrou, lançou, confirmou, resolveu
-- ou decidiu são FK para gf_auth_accounts. As identidades legadas (tarot_id, consulta_id, cliente_id) ficam em texto e
-- sem FK, porque o InnoDB não aceita FK para tabela MyISAM: o servidor confere o ID antes de gravar.
--
-- EXECUÇÃO AUTOMATIZADA (preferida)
--   scripts/auth-admin.mjs automatiza os passos abaixo com --schema financeiro, com o mesmo arquivo de opções da
--   001_auth.sql (um grupo de ~/.my.cnf, chmod 600, lido sozinho, sem herdar [client]).
--   Ensaio num banco NÃO produtivo que já tenha a 001_auth.sql (aplica, verifica, exercita as regras, desfaz e reaplica):
--     node scripts/auth-admin.mjs rehearse --schema financeiro --group fadas_auth_dev --confirm-database DATABASE
--   Aplicação real. Gravar exige repetir o nome do banco; o `fadasdobem` exige também --production, e a assinatura do
--   revisor que a Constituição III pede precisa estar registrada antes:
--     node scripts/auth-admin.mjs migrate  --schema financeiro --group GROUP --confirm-database DATABASE
--     node scripts/auth-admin.mjs verify   --schema financeiro --group GROUP
--     node scripts/auth-admin.mjs rollback --schema financeiro --group GROUP --confirm-database DATABASE [--backup FILE]
--   Sem --schema, o CLI continua tratando só da 001_auth.sql. Decidir aplicar continua sendo um passo humano e
--   deliberado; a ferramenta só tira a cópia de consultas. Os passos manuais abaixo seguem como a referência do que ela faz.
--
-- REQUISITOS DO ALVO
--   Os mesmos da 001_auth.sql (MariaDB 10.2.1+ ou MySQL 8.0.16+ com InnoDB; ensaiado no MariaDB 10.6 da KingHost).
--   O servidor da KingHost roda com sql_mode VAZIO: aplique com STRICT_ALL_TABLES e NO_ENGINE_SUBSTITUTION (veja APLICAR),
--   e toda conexão da aplicação força o mesmo modo. Precisa de CREATE, ALTER, DROP, INDEX e REFERENCES.
--   DDL não é transacional no MySQL nem no MariaDB: cada comando é atômico, este script não.
--   Um CHECK cuja expressão dá NULL passa. Por isso toda coluna anulável que uma regra exige aparece com IS NOT NULL
--   explícito antes da comparação.
--
-- ANTES DE APLICAR (registre cada resultado no registro da execução)
--   1. Identifique o alvo:    SELECT DATABASE(), VERSION(), @@sql_mode;
--      DATABASE() precisa ser `fadasdobem` em produção, ou o banco não produtivo separado no ensaio.
--   2. Pré-condições. A primeira precisa dar 0 (senão PARE e não rode a reversão também, porque ela apagaria tabelas que
--      esta migração não criou); a segunda precisa dar 1 (a 001_auth.sql aplicada):
--        SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
--         AND (TABLE_NAME LIKE 'gf\_repasse\_%' OR TABLE_NAME = 'gf_auditoria');
--        SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'gf_auth_accounts';
--      Depois salve o inventário:
--        SELECT TABLE_NAME, ENGINE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
--   3. Prove que CHECK e FOREIGN KEY são aplicados aqui, com a sonda do passo 3 da 001_auth.sql (cada INSERT dela
--      PRECISA falhar; se um passar, PARE).
--   4. O que é copiado antes de aplicar. A aplicação só acrescenta e não toca em tabela existente, então antes da
--      PRIMEIRA aplicação a rede de segurança é o inventário do passo 2: nada mais é copiado. Nunca tire dump do banco
--      inteiro para esta feature: as tabelas MyISAM do legado não saem consistentes e ficariam travadas. Com as tabelas
--      criadas, e antes de qualquer reversão ou migração financeira seguinte, tire o dump só das onze tabelas (InnoDB,
--      snapshot consistente), guardado fora do Git com modo 0600 (um cliente MySQL 8 pode pedir também --no-tablespaces;
--      o do MariaDB não o conhece). As notas de --no-defaults, porta, túnel SSH e --skip-ssl da 001_auth.sql valem aqui:
--        mysqldump --no-defaults --single-transaction -h HOST -P PORT -u USER -p DATABASE \
--          gf_repasse_percentuais gf_repasse_calendarios gf_repasse_aberturas gf_repasse_abertura_pendencias \
--          gf_repasse_dividas gf_repasse_divida_parcelas gf_repasse_pagamentos gf_repasse_pagamento_descontos \
--          gf_repasse_ajustes gf_repasse_cancelamentos gf_auditoria > financeiro-DATE.sql
--      Prove a restauração uma vez num banco de rascunho que já tenha a 001_auth.sql (o destino entra no registro):
--        mysql --no-defaults -h HOST -P PORT -u USER -p SCRATCH_DATABASE < financeiro-DATE.sql
--
-- APLICAR
--   mysql --no-defaults -h HOST -P PORT -u USER -p --database=DATABASE \
--     --init-command="SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'" \
--     < database/migrations/financeiro/001_repasses.sql
--   Não passe --force: o cliente para no primeiro erro. Se parar no meio, as tabelas anteriores ficam; rode
--   001_repasses.rollback.sql (pode repetir, nomeia só as onze tabelas abaixo), corrija a causa e aplique de novo.
--
-- VERIFICAR DEPOIS DE APLICAR (valores esperados entre colchetes)
--   Tabelas, engine e collation [11 linhas, InnoDB, utf8mb4_bin]:
--     SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
--      AND (TABLE_NAME LIKE 'gf\_repasse\_%' OR TABLE_NAME = 'gf_auditoria') ORDER BY TABLE_NAME;
--   Inventário de constraints [PRIMARY KEY 11, FOREIGN KEY 21, UNIQUE 15, CHECK 77]; a aplicação em si é provada pela
--   sonda do passo 3, que se repete à mão depois de qualquer atualização do servidor:
--     SELECT CONSTRAINT_TYPE, COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE()
--      AND (TABLE_NAME LIKE 'gf\_repasse\_%' OR TABLE_NAME = 'gf_auditoria') GROUP BY CONSTRAINT_TYPE;
--   Regras referenciais [21 linhas, todo UPDATE_RULE e DELETE_RULE = RESTRICT]:
--     SELECT TABLE_NAME, CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--      WHERE CONSTRAINT_SCHEMA = DATABASE() AND (TABLE_NAME LIKE 'gf\_repasse\_%' OR TABLE_NAME = 'gf_auditoria');
--   Referências órfãs [toda contagem 0; só aparecem depois de uma carga com foreign_key_checks=0, como a restauração]:
--     SELECT 'fk_percentuais_registrado_por' AS fk, COUNT(*) AS orphans FROM gf_repasse_percentuais c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.registrado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_calendarios_registrado_por', COUNT(*) FROM gf_repasse_calendarios c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.registrado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_aberturas_corrige', COUNT(*) FROM gf_repasse_aberturas c LEFT JOIN gf_repasse_aberturas p
--       ON p.tarot_id = c.tarot_id AND p.revisao = c.corrige_revisao WHERE c.corrige_revisao IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_aberturas_lancado_por', COUNT(*) FROM gf_repasse_aberturas c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.lancado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_aberturas_confirmado_por', COUNT(*) FROM gf_repasse_aberturas c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.confirmado_por WHERE c.confirmado_por IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_pendencias_abertura', COUNT(*) FROM gf_repasse_abertura_pendencias c
--       LEFT JOIN gf_repasse_aberturas p ON p.id = c.abertura_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_pendencias_resolvida_por', COUNT(*) FROM gf_repasse_abertura_pendencias c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.resolvida_por WHERE c.resolvida_por IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_dividas_abertura', COUNT(*) FROM gf_repasse_dividas c
--       LEFT JOIN gf_repasse_aberturas p ON p.id = c.abertura_id WHERE c.abertura_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_dividas_corrige', COUNT(*) FROM gf_repasse_dividas c
--       LEFT JOIN gf_repasse_dividas p ON p.id = c.corrige_id WHERE c.corrige_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_dividas_registrado_por', COUNT(*) FROM gf_repasse_dividas c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.registrado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_parcelas_divida', COUNT(*) FROM gf_repasse_divida_parcelas c
--       LEFT JOIN gf_repasse_dividas p ON p.id = c.divida_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_pagamentos_corrige', COUNT(*) FROM gf_repasse_pagamentos c
--       LEFT JOIN gf_repasse_pagamentos p ON p.id = c.corrige_id WHERE c.corrige_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_pagamentos_registrado_por', COUNT(*) FROM gf_repasse_pagamentos c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.registrado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_descontos_pagamento', COUNT(*) FROM gf_repasse_pagamento_descontos c
--       LEFT JOIN gf_repasse_pagamentos p ON p.id = c.pagamento_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_descontos_divida', COUNT(*) FROM gf_repasse_pagamento_descontos c
--       LEFT JOIN gf_repasse_dividas p ON p.id = c.divida_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_ajustes_abertura', COUNT(*) FROM gf_repasse_ajustes c
--       LEFT JOIN gf_repasse_aberturas p ON p.id = c.abertura_id WHERE c.abertura_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_ajustes_corrige', COUNT(*) FROM gf_repasse_ajustes c
--       LEFT JOIN gf_repasse_ajustes p ON p.id = c.corrige_id WHERE c.corrige_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_ajustes_registrado_por', COUNT(*) FROM gf_repasse_ajustes c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.registrado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_cancelamentos_registrado_por', COUNT(*) FROM gf_repasse_cancelamentos c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.registrado_por WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_cancelamentos_decidido_por', COUNT(*) FROM gf_repasse_cancelamentos c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.decidido_por WHERE c.decidido_por IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_auditoria_ator', COUNT(*) FROM gf_auditoria c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.ator_conta_id WHERE p.id IS NULL;
--   A primeira aplicação deixa as onze tabelas vazias [onze contagens 0], e o inventário das demais igual ao do passo 2.
--
-- REVERSÃO (001_repasses.rollback.sql) E PONTO SEM VOLTA
--   Antes de qualquer gravação real a reversão é livre: apaga as onze tabelas e nada mais.
--   O ponto sem volta é a PRIMEIRA GRAVAÇÃO REAL nestas tabelas (um percentual, uma abertura, um pagamento, um ajuste,
--   uma dívida, um caso de cancelamento ou o registro de um download). Depois dele, o padrão NÃO é este script: desligue
--   a etapa 2 e reimplante o artefato anterior, mantendo as tabelas, que guardam o histórico dos repasses e a auditoria.
--   Se ainda assim for preciso reverter, os passos exatos são:
--     a. pare tudo o que grava nestas tabelas (a etapa 2 do artefato Node);
--     b. tire o dump das onze tabelas (passo 4), prove a restauração num banco de rascunho e registre os dois;
--     c. rode a reversão: rollback --schema financeiro --backup financeiro-DATE.sql (o CLI recusa reverter tabelas com
--        linhas sem esse dump privado), ou, à mão, mysql ... --database=DATABASE < 001_repasses.rollback.sql;
--     d. confira como em VERIFICAR DEPOIS DA REVERSÃO.
--   A reversão da 001_auth.sql não roda enquanto estas tabelas existirem, porque as FKs delas apontam para
--   gf_auth_accounts: reverta antes esta, e o CLI recusa a ordem contrária.
--   VERIFICAR DEPOIS DA REVERSÃO: a primeira consulta do passo 2 dá 0, gf_auth_accounts continua lá e o inventário das
--   demais tabelas segue igual ao salvo antes de aplicar.
--
-- RESTAURAR (no lugar, depois que a reversão tirou as onze tabelas)
--   mysql --no-defaults -h HOST -P PORT -u USER -p DATABASE < financeiro-DATE.sql
--   O dump nomeia só as onze tabelas, então as recria e não toca em mais nada; nunca restaure um dump do banco inteiro
--   sobre o legado. O mysqldump carrega com foreign_key_checks=0: confira como depois de aplicar, com as órfãs em 0
--   (verify --schema financeiro faz as duas coisas), e as contagens de linhas iguais às do backup.
--
-- ENSAIO
--   tests/finance-schema-db.test.mjs aplica, reverte e reaplica, prova cada CHECK, UNIQUE e FK abaixo, exige o dump antes
--   da reversão com linhas, restaura esse dump e confere que o legado e as gf_auth_* saem idênticos, num MariaDB 10.6
--   descartável. Não é o ensaio no servidor da hospedagem, que continua obrigatório antes de produção, num banco não
--   produtivo desse servidor e nunca no `fadasdobem`.

-- Percentual de repasse por tarólogo, só inclusão. O vigente no instante T é o de maior vigente_desde até T (R11).
CREATE TABLE `gf_repasse_percentuais` (
  `id` VARCHAR(64) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `percentual` DECIMAL(5,2) NOT NULL,
  `vigente_desde` DATETIME NOT NULL,
  `motivo` VARCHAR(500) NULL DEFAULT NULL,
  `registrado_por` VARCHAR(64) NOT NULL,
  `registrado_em` BIGINT NOT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_percentuais_vigencia` UNIQUE (`tarot_id`, `vigente_desde`),
  CONSTRAINT `uq_percentuais_operation_key` UNIQUE (`operation_key`),
  CONSTRAINT `fk_percentuais_registrado_por` FOREIGN KEY (`registrado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_percentuais_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_percentuais_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_percentuais_percentual` CHECK (`percentual` >= 0 AND `percentual` <= 100),
  CONSTRAINT `chk_percentuais_motivo` CHECK (`motivo` IS NULL OR CHAR_LENGTH(TRIM(`motivo`)) > 0),
  CONSTRAINT `chk_percentuais_registrado_em` CHECK (`registrado_em` > 0),
  CONSTRAINT `chk_percentuais_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Calendário de pagamento por tarólogo, só inclusão (TarologistPaymentSchedule). dias_mes guarda os dias separados por
-- vírgula, sem espaço e sem repetir; a política de fim de semana só existe no calendário por dias do mês.
CREATE TABLE `gf_repasse_calendarios` (
  `id` VARCHAR(64) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `tipo` VARCHAR(12) NOT NULL,
  `dia_semana` VARCHAR(8) NULL DEFAULT NULL,
  `dias_mes` VARCHAR(100) NULL DEFAULT NULL,
  `politica_fim_semana` VARCHAR(20) NULL DEFAULT NULL,
  `vigente_desde` DATETIME NOT NULL,
  `motivo` VARCHAR(500) NULL DEFAULT NULL,
  `registrado_por` VARCHAR(64) NOT NULL,
  `registrado_em` BIGINT NOT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_calendarios_vigencia` UNIQUE (`tarot_id`, `vigente_desde`),
  CONSTRAINT `uq_calendarios_operation_key` UNIQUE (`operation_key`),
  CONSTRAINT `fk_calendarios_registrado_por` FOREIGN KEY (`registrado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_calendarios_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_calendarios_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_calendarios_tipo` CHECK (`tipo` IN ('weekday', 'monthdays', 'none')),
  CONSTRAINT `chk_calendarios_dia_semana` CHECK ((`tipo` = 'weekday' AND `dia_semana` IS NOT NULL AND `dia_semana` IN ('segunda', 'terca', 'quarta', 'quinta', 'sexta')) OR (`tipo` <> 'weekday' AND `dia_semana` IS NULL)),
  CONSTRAINT `chk_calendarios_dias_mes` CHECK ((`tipo` = 'monthdays' AND `dias_mes` IS NOT NULL AND `dias_mes` REGEXP '^([1-9]|[12][0-9]|3[01])(,([1-9]|[12][0-9]|3[01]))*$' AND `dias_mes` NOT REGEXP '(^|,)([0-9]+),(.*,)?\\2(,|$)') OR (`tipo` <> 'monthdays' AND `dias_mes` IS NULL)),
  CONSTRAINT `chk_calendarios_politica` CHECK (`politica_fim_semana` IS NULL OR (`tipo` = 'monthdays' AND `politica_fim_semana` IN ('keep', 'next-business-day'))),
  CONSTRAINT `chk_calendarios_motivo` CHECK (`motivo` IS NULL OR CHAR_LENGTH(TRIM(`motivo`)) > 0),
  CONSTRAINT `chk_calendarios_registrado_em` CHECK (`registrado_em` > 0),
  CONSTRAINT `chk_calendarios_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Abertura da migração por tarólogo, em revisões (complemento 20, seção 7). A vigente é a maior revisão confirmada; a
-- correção cria a N+1 e mantém a N. Corrigir um rascunho deixa a N descartada, sem confirmação e sem poder ser
-- confirmada (PO, 2026-10-24). Um só rascunho aberto por tarólogo e quitado_ate antes de corte_migracao ficam com o
-- servidor, que os confere ao gravar e ao confirmar.
CREATE TABLE `gf_repasse_aberturas` (
  `id` VARCHAR(64) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `revisao` INT NOT NULL,
  `situacao` VARCHAR(12) NOT NULL,
  `corrige_revisao` INT NULL DEFAULT NULL,
  `motivo_correcao` VARCHAR(500) NULL DEFAULT NULL,
  `ultimo_pagamento_data` DATE NOT NULL,
  `ultimo_pagamento_valor` DECIMAL(20,2) NOT NULL,
  `planilha_referencia` VARCHAR(200) NOT NULL,
  `quitado_ate` DATETIME NOT NULL,
  `saldo_remanescente` DECIMAL(20,2) NOT NULL,
  `saldo_composicao` VARCHAR(2000) NULL DEFAULT NULL,
  `corte_migracao` DATETIME NOT NULL,
  `percentual_conferido` DECIMAL(5,2) NOT NULL DEFAULT 30.00,
  `lancado_por` VARCHAR(64) NOT NULL,
  `lancado_em` BIGINT NOT NULL,
  `confirmado_por` VARCHAR(64) NULL DEFAULT NULL,
  `confirmado_em` BIGINT NULL DEFAULT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_aberturas_revisao` UNIQUE (`tarot_id`, `revisao`),
  CONSTRAINT `uq_aberturas_operation_key` UNIQUE (`operation_key`),
  CONSTRAINT `fk_aberturas_corrige` FOREIGN KEY (`tarot_id`, `corrige_revisao`) REFERENCES `gf_repasse_aberturas` (`tarot_id`, `revisao`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_aberturas_lancado_por` FOREIGN KEY (`lancado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_aberturas_confirmado_por` FOREIGN KEY (`confirmado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_aberturas_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_aberturas_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_aberturas_situacao` CHECK (`situacao` IN ('rascunho', 'confirmada', 'descartada')),
  CONSTRAINT `chk_aberturas_correcao` CHECK ((`revisao` = 1 AND `corrige_revisao` IS NULL AND `motivo_correcao` IS NULL) OR (`revisao` > 1 AND `corrige_revisao` IS NOT NULL AND `motivo_correcao` IS NOT NULL AND `corrige_revisao` >= 1 AND `corrige_revisao` < `revisao` AND CHAR_LENGTH(TRIM(`motivo_correcao`)) > 0)),
  CONSTRAINT `chk_aberturas_ultimo_pagamento_valor` CHECK (`ultimo_pagamento_valor` >= 0),
  CONSTRAINT `chk_aberturas_planilha_referencia` CHECK (CHAR_LENGTH(TRIM(`planilha_referencia`)) > 0),
  CONSTRAINT `chk_aberturas_saldo_composicao` CHECK (`saldo_composicao` IS NULL OR CHAR_LENGTH(TRIM(`saldo_composicao`)) > 0),
  CONSTRAINT `chk_aberturas_percentual` CHECK (`percentual_conferido` >= 0 AND `percentual_conferido` <= 100),
  CONSTRAINT `chk_aberturas_lancado_em` CHECK (`lancado_em` > 0),
  CONSTRAINT `chk_aberturas_confirmacao` CHECK ((`situacao` = 'confirmada' AND `confirmado_por` IS NOT NULL AND `confirmado_em` IS NOT NULL AND `confirmado_em` >= `lancado_em`) OR (`situacao` <> 'confirmada' AND `confirmado_por` IS NULL AND `confirmado_em` IS NULL)),
  CONSTRAINT `chk_aberturas_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Diferenças com a planilha na abertura (FR-030). Uma pendência nunca vira ajuste automático.
CREATE TABLE `gf_repasse_abertura_pendencias` (
  `id` VARCHAR(64) NOT NULL,
  `abertura_id` VARCHAR(64) NOT NULL,
  `descricao` VARCHAR(500) NOT NULL,
  `valor` DECIMAL(20,2) NULL DEFAULT NULL,
  `resolvida_em` BIGINT NULL DEFAULT NULL,
  `resolvida_por` VARCHAR(64) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `fk_pendencias_abertura` FOREIGN KEY (`abertura_id`) REFERENCES `gf_repasse_aberturas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_pendencias_resolvida_por` FOREIGN KEY (`resolvida_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_pendencias_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_pendencias_descricao` CHECK (CHAR_LENGTH(TRIM(`descricao`)) > 0),
  CONSTRAINT `chk_pendencias_resolucao` CHECK ((`resolvida_em` IS NULL AND `resolvida_por` IS NULL) OR (`resolvida_em` IS NOT NULL AND `resolvida_em` > 0 AND `resolvida_por` IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Empréstimos e adiantamentos (PayoutLoan): os que vieram da abertura (migracao) e os entregues depois do corte (novo).
-- A correção cria uma linha nova que aponta a antiga em corrige_id, e a antiga passa a substituido; cada linha é
-- corrigida no máximo uma vez. O saldo devedor e o limite da correção pelos descontos ficam com o servidor.
CREATE TABLE `gf_repasse_dividas` (
  `id` VARCHAR(64) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `tipo` VARCHAR(8) NOT NULL,
  `origem` VARCHAR(10) NOT NULL,
  `abertura_id` VARCHAR(64) NULL DEFAULT NULL,
  `valor` DECIMAL(20,2) NOT NULL,
  `entrega_original` DATE NULL DEFAULT NULL,
  `entregue_em` DATE NULL DEFAULT NULL,
  `referencia_data` DATE NULL DEFAULT NULL,
  `situacao` VARCHAR(12) NOT NULL,
  `corrige_id` VARCHAR(64) NULL DEFAULT NULL,
  `motivo_correcao` VARCHAR(500) NULL DEFAULT NULL,
  `planilha_referencia` VARCHAR(200) NULL DEFAULT NULL,
  `observacao` VARCHAR(500) NULL DEFAULT NULL,
  `registrado_por` VARCHAR(64) NOT NULL,
  `registrado_em` BIGINT NOT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_dividas_corrige` UNIQUE (`corrige_id`),
  CONSTRAINT `uq_dividas_operation_key` UNIQUE (`operation_key`),
  KEY `idx_dividas_tarot` (`tarot_id`),
  CONSTRAINT `fk_dividas_abertura` FOREIGN KEY (`abertura_id`) REFERENCES `gf_repasse_aberturas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_dividas_corrige` FOREIGN KEY (`corrige_id`) REFERENCES `gf_repasse_dividas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_dividas_registrado_por` FOREIGN KEY (`registrado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_dividas_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_dividas_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_dividas_tipo` CHECK (`tipo` IN ('loan', 'advance')),
  CONSTRAINT `chk_dividas_origem` CHECK ((`origem` = 'migracao' AND `abertura_id` IS NOT NULL AND `referencia_data` IS NOT NULL) OR (`origem` = 'novo' AND `abertura_id` IS NULL AND `entregue_em` IS NOT NULL AND `planilha_referencia` IS NULL)),
  CONSTRAINT `chk_dividas_valor` CHECK (`valor` > 0),
  CONSTRAINT `chk_dividas_situacao` CHECK (`situacao` IN ('valido', 'substituido')),
  CONSTRAINT `chk_dividas_correcao` CHECK ((`corrige_id` IS NULL AND `motivo_correcao` IS NULL) OR (`corrige_id` IS NOT NULL AND `corrige_id` <> `id` AND `motivo_correcao` IS NOT NULL AND CHAR_LENGTH(TRIM(`motivo_correcao`)) > 0)),
  CONSTRAINT `chk_dividas_registrado_em` CHECK (`registrado_em` > 0),
  CONSTRAINT `chk_dividas_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Parcelas acordadas de uma dívida (PayoutLoanRepaymentPlan.installments). A soma igual ao valor da dívida é conferida
-- pelo servidor na mesma transação; uma parcela planejada ou vencida não baixa a dívida.
CREATE TABLE `gf_repasse_divida_parcelas` (
  `divida_id` VARCHAR(64) NOT NULL,
  `sequencia` INT NOT NULL,
  `data` DATE NOT NULL,
  `valor` DECIMAL(20,2) NOT NULL,
  PRIMARY KEY (`divida_id`, `sequencia`),
  CONSTRAINT `fk_parcelas_divida` FOREIGN KEY (`divida_id`) REFERENCES `gf_repasse_dividas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_parcelas_sequencia` CHECK (`sequencia` > 0),
  CONSTRAINT `chk_parcelas_valor` CHECK (`valor` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Pagamentos ao tarólogo (PayoutTransfer), com a correção como nas dívidas. saldo_na_data é a fotografia do valor a pagar
-- mostrado (settlementBasis); pago_em não vir antes do corte da abertura vigente fica com o servidor (FR-037).
CREATE TABLE `gf_repasse_pagamentos` (
  `id` VARCHAR(64) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `valor` DECIMAL(20,2) NOT NULL,
  `pago_em` DATE NOT NULL,
  `periodo_inicio` DATE NOT NULL,
  `periodo_fim` DATE NOT NULL,
  `saldo_na_data` DECIMAL(20,2) NOT NULL,
  `situacao` VARCHAR(12) NOT NULL,
  `corrige_id` VARCHAR(64) NULL DEFAULT NULL,
  `motivo_correcao` VARCHAR(500) NULL DEFAULT NULL,
  `observacao` VARCHAR(500) NULL DEFAULT NULL,
  `registrado_por` VARCHAR(64) NOT NULL,
  `registrado_em` BIGINT NOT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_pagamentos_corrige` UNIQUE (`corrige_id`),
  CONSTRAINT `uq_pagamentos_operation_key` UNIQUE (`operation_key`),
  KEY `idx_pagamentos_tarot` (`tarot_id`, `pago_em`),
  CONSTRAINT `fk_pagamentos_corrige` FOREIGN KEY (`corrige_id`) REFERENCES `gf_repasse_pagamentos` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_pagamentos_registrado_por` FOREIGN KEY (`registrado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_pagamentos_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_pagamentos_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_pagamentos_valor` CHECK (`valor` >= 0),
  CONSTRAINT `chk_pagamentos_periodo` CHECK (`periodo_inicio` <= `periodo_fim`),
  CONSTRAINT `chk_pagamentos_situacao` CHECK (`situacao` IN ('valido', 'substituido')),
  CONSTRAINT `chk_pagamentos_correcao` CHECK ((`corrige_id` IS NULL AND `motivo_correcao` IS NULL) OR (`corrige_id` IS NOT NULL AND `corrige_id` <> `id` AND `motivo_correcao` IS NOT NULL AND CHAR_LENGTH(TRIM(`motivo_correcao`)) > 0)),
  CONSTRAINT `chk_pagamentos_registrado_em` CHECK (`registrado_em` > 0),
  CONSTRAINT `chk_pagamentos_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Descontos de dívida dentro de um pagamento (loanDeductions), gravados na mesma transação dele, ou nada (FR-037).
CREATE TABLE `gf_repasse_pagamento_descontos` (
  `pagamento_id` VARCHAR(64) NOT NULL,
  `divida_id` VARCHAR(64) NOT NULL,
  `valor` DECIMAL(20,2) NOT NULL,
  PRIMARY KEY (`pagamento_id`, `divida_id`),
  CONSTRAINT `fk_descontos_pagamento` FOREIGN KEY (`pagamento_id`) REFERENCES `gf_repasse_pagamentos` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_descontos_divida` FOREIGN KEY (`divida_id`) REFERENCES `gf_repasse_dividas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_descontos_valor` CHECK (`valor` > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Ajustes (PayoutAdjustment): valor com sinal, positivo é adicional e negativo é desconto. abertura_id marca o ajuste que
-- estava em aberto na migração.
CREATE TABLE `gf_repasse_ajustes` (
  `id` VARCHAR(64) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `tipo` VARCHAR(8) NOT NULL,
  `valor` DECIMAL(20,2) NOT NULL,
  `descricao` VARCHAR(500) NOT NULL,
  `data` DATE NOT NULL,
  `periodo_inicio` DATE NOT NULL,
  `periodo_fim` DATE NOT NULL,
  `abertura_id` VARCHAR(64) NULL DEFAULT NULL,
  `situacao` VARCHAR(12) NOT NULL,
  `corrige_id` VARCHAR(64) NULL DEFAULT NULL,
  `motivo_correcao` VARCHAR(500) NULL DEFAULT NULL,
  `registrado_por` VARCHAR(64) NOT NULL,
  `registrado_em` BIGINT NOT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_ajustes_corrige` UNIQUE (`corrige_id`),
  CONSTRAINT `uq_ajustes_operation_key` UNIQUE (`operation_key`),
  KEY `idx_ajustes_tarot` (`tarot_id`, `data`),
  CONSTRAINT `fk_ajustes_abertura` FOREIGN KEY (`abertura_id`) REFERENCES `gf_repasse_aberturas` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_ajustes_corrige` FOREIGN KEY (`corrige_id`) REFERENCES `gf_repasse_ajustes` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_ajustes_registrado_por` FOREIGN KEY (`registrado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_ajustes_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_ajustes_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_ajustes_tipo` CHECK (`tipo` IN ('bonus', 'outro', 'desconto')),
  CONSTRAINT `chk_ajustes_descricao` CHECK (CHAR_LENGTH(TRIM(`descricao`)) > 0),
  CONSTRAINT `chk_ajustes_periodo` CHECK (`periodo_inicio` <= `periodo_fim`),
  CONSTRAINT `chk_ajustes_situacao` CHECK (`situacao` IN ('valido', 'substituido')),
  CONSTRAINT `chk_ajustes_correcao` CHECK ((`corrige_id` IS NULL AND `motivo_correcao` IS NULL) OR (`corrige_id` IS NOT NULL AND `corrige_id` <> `id` AND `motivo_correcao` IS NOT NULL AND CHAR_LENGTH(TRIM(`motivo_correcao`)) > 0)),
  CONSTRAINT `chk_ajustes_registrado_em` CHECK (`registrado_em` > 0),
  CONSTRAINT `chk_ajustes_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Casos de cancelamento (ConsultationCancellationReview), só o efeito no repasse: um caso por consulta legada.
CREATE TABLE `gf_repasse_cancelamentos` (
  `id` VARCHAR(64) NOT NULL,
  `consulta_id` VARCHAR(16) NOT NULL,
  `tarot_id` VARCHAR(16) NOT NULL,
  `cliente_id` VARCHAR(16) NOT NULL,
  `queixa` TEXT NOT NULL,
  `situacao` VARCHAR(10) NOT NULL,
  `motivo_decisao` VARCHAR(1000) NULL DEFAULT NULL,
  `registrado_por` VARCHAR(64) NOT NULL,
  `registrado_em` BIGINT NOT NULL,
  `decidido_por` VARCHAR(64) NULL DEFAULT NULL,
  `decidido_em` BIGINT NULL DEFAULT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_cancelamentos_consulta` UNIQUE (`consulta_id`),
  CONSTRAINT `uq_cancelamentos_operation_key` UNIQUE (`operation_key`),
  KEY `idx_cancelamentos_tarot` (`tarot_id`),
  CONSTRAINT `fk_cancelamentos_registrado_por` FOREIGN KEY (`registrado_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_cancelamentos_decidido_por` FOREIGN KEY (`decidido_por`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_cancelamentos_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_cancelamentos_consulta_id` CHECK (CHAR_LENGTH(`consulta_id`) > 0 AND CHAR_LENGTH(`consulta_id`) = CHAR_LENGTH(TRIM(`consulta_id`))),
  CONSTRAINT `chk_cancelamentos_tarot_id` CHECK (CHAR_LENGTH(`tarot_id`) > 0 AND CHAR_LENGTH(`tarot_id`) = CHAR_LENGTH(TRIM(`tarot_id`))),
  CONSTRAINT `chk_cancelamentos_cliente_id` CHECK (CHAR_LENGTH(`cliente_id`) > 0 AND CHAR_LENGTH(`cliente_id`) = CHAR_LENGTH(TRIM(`cliente_id`))),
  CONSTRAINT `chk_cancelamentos_queixa` CHECK (CHAR_LENGTH(TRIM(`queixa`)) > 0 AND CHAR_LENGTH(`queixa`) <= 4000),
  CONSTRAINT `chk_cancelamentos_situacao` CHECK (`situacao` IN ('pendente', 'mantido', 'retirado')),
  CONSTRAINT `chk_cancelamentos_decisao` CHECK ((`situacao` = 'pendente' AND `motivo_decisao` IS NULL AND `decidido_por` IS NULL AND `decidido_em` IS NULL) OR (`situacao` <> 'pendente' AND `motivo_decisao` IS NOT NULL AND CHAR_LENGTH(TRIM(`motivo_decisao`)) > 0 AND `decidido_por` IS NOT NULL AND `decidido_em` IS NOT NULL AND `decidido_em` >= `registrado_em`)),
  CONSTRAINT `chk_cancelamentos_registrado_em` CHECK (`registrado_em` > 0),
  CONSTRAINT `chk_cancelamentos_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Auditoria das gravações da etapa 2 (AuditGateway.append e list). Nas gravações do finance-store, operation_key é a chave
-- da própria operação; no AuditGateway.append, que não recebe chave, é o id do registro. ator_conta_id e ator_funcao são
-- o actorUserId e o actorRole do AuditEntry; antes e depois guardam JSON.
CREATE TABLE `gf_auditoria` (
  `id` VARCHAR(64) NOT NULL,
  `ocorrido_em` BIGINT NOT NULL,
  `ator_conta_id` VARCHAR(64) NOT NULL,
  `ator_funcao` VARCHAR(32) NOT NULL,
  `acao` VARCHAR(64) NOT NULL,
  `entidade` VARCHAR(64) NOT NULL,
  `entidade_id` VARCHAR(64) NOT NULL,
  `antes` LONGTEXT NULL DEFAULT NULL,
  `depois` LONGTEXT NULL DEFAULT NULL,
  `motivo` VARCHAR(1000) NULL DEFAULT NULL,
  `operation_key` VARCHAR(64) NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_auditoria_operation_key` UNIQUE (`operation_key`),
  KEY `idx_auditoria_entidade` (`entidade`, `entidade_id`, `ocorrido_em`),
  CONSTRAINT `fk_auditoria_ator` FOREIGN KEY (`ator_conta_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_auditoria_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_auditoria_ocorrido_em` CHECK (`ocorrido_em` > 0),
  CONSTRAINT `chk_auditoria_ator_funcao` CHECK (`ator_funcao` IN ('administradora', 'assistente', 'supervisora', 'atendente', 'tarologa')),
  CONSTRAINT `chk_auditoria_acao` CHECK (CHAR_LENGTH(`acao`) > 0 AND CHAR_LENGTH(`acao`) = CHAR_LENGTH(TRIM(`acao`))),
  CONSTRAINT `chk_auditoria_entidade` CHECK (CHAR_LENGTH(`entidade`) > 0 AND CHAR_LENGTH(`entidade`) = CHAR_LENGTH(TRIM(`entidade`))),
  CONSTRAINT `chk_auditoria_entidade_id` CHECK (CHAR_LENGTH(`entidade_id`) > 0 AND CHAR_LENGTH(`entidade_id`) = CHAR_LENGTH(TRIM(`entidade_id`))),
  CONSTRAINT `chk_auditoria_antes` CHECK (`antes` IS NULL OR JSON_VALID(`antes`)),
  CONSTRAINT `chk_auditoria_depois` CHECK (`depois` IS NULL OR JSON_VALID(`depois`)),
  CONSTRAINT `chk_auditoria_motivo` CHECK (`motivo` IS NULL OR CHAR_LENGTH(TRIM(`motivo`)) > 0),
  CONSTRAINT `chk_auditoria_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
