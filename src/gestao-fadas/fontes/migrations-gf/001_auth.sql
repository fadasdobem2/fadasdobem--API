-- Gestao Fadas, feature 002-real-login: auth relations, forward migration.
-- Pair: 001_auth.rollback.sql. Model: specs/002-real-login/data-model.md (detailed ERD + storage rules).
--
-- Prepared for review and MANUAL application. No application code, build or test applies this file to a
-- shared database; tests/auth-schema.test.mjs rehearses it on disposable local containers only, next to the
-- real legacy DDL.
-- It creates six new relations in the CURRENT database. In production that is the legacy `fadasdobem`
-- database, beside the legacy tables; the `gf_auth_` prefix marks what this migration owns. It does not
-- create the database, and it does not read, alter or drop any legacy or other table. Test fixtures and
-- staging never use `fadasdobem`.
--
-- AUTOMATED RUN (preferred)
--   scripts/auth-admin.mjs automates the steps below, so no query has to be copied by hand. Describe the target
--   as a group of ~/.my.cnf (chmod 600). The group is read alone and must be complete: it never inherits [client].
--     [fadas_auth_dev]
--     host=...
--     user=...
--     password=...
--     database=...
--   Rehearsal on a NON-production database (apply, verify, exercise the rules, roll back, reapply):
--     node scripts/auth-admin.mjs rehearse --group fadas_auth_dev --confirm-database DATABASE
--   Real apply. Writes need the database name repeated; `fadasdobem` also needs --production, and the reviewer
--   sign-off that Constitution III requires must be recorded first:
--     node scripts/auth-admin.mjs migrate  --group GROUP --confirm-database DATABASE
--     node scripts/auth-admin.mjs verify   --group GROUP
--     node scripts/auth-admin.mjs rollback --group GROUP --confirm-database DATABASE [--backup FILE]
--   `--help` lists every option. Deciding to apply stays a deliberate human step; the tool only removes the copying.
--   The manual steps below remain as the reference of what it does.
--
-- TARGET REQUIREMENTS
--   MariaDB 10.2.1+ or MySQL 8.0.16+ with InnoDB (rehearsed on MariaDB 10.6, the KingHost target, and on
--   MySQL 8.0). Older servers, such as the MySQL 5.6 this host ran before, accept CHECK syntax and silently
--   ignore it, and cap indexed utf8mb4 columns at 191 characters; step 3 below proves enforcement on the
--   actual target. The KingHost server runs with an EMPTY sql_mode, so strictness must come from the session:
--   apply with STRICT_ALL_TABLES and NO_ENGINE_SUBSTITUTION (see APPLY), and every application connection
--   must set the same. Needs CREATE, ALTER, DROP, INDEX and REFERENCES.
--   DDL is not transactional in MySQL or MariaDB: every statement is atomic, this script is not.
--
-- BEFORE APPLY (record each result in the run record)
--   1. Identify the target:    SELECT DATABASE(), VERSION(), @@sql_mode;
--      DATABASE() must be `fadasdobem` for production, or the separate non-production database for staging.
--   2. Precondition, must be 0 (otherwise STOP and do not run the rollback script either, because it would
--      drop tables this migration did not create):
--        SELECT COUNT(*) FROM information_schema.TABLES
--         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'gf\_auth\_%';
--      Then save the inventory:
--        SELECT TABLE_NAME, ENGINE, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE();
--   3. Prove CHECK and FOREIGN KEY are enforced here (each INSERT below MUST fail; if one succeeds, STOP):
--        CREATE TABLE gf_probe_parent (id INT NOT NULL PRIMARY KEY, n INT NOT NULL,
--          CONSTRAINT chk_probe CHECK (n > 0)) ENGINE=InnoDB;
--        CREATE TABLE gf_probe_child (id INT NOT NULL PRIMARY KEY, parent INT NOT NULL,
--          CONSTRAINT fk_probe FOREIGN KEY (parent) REFERENCES gf_probe_parent (id)) ENGINE=InnoDB;
--        INSERT INTO gf_probe_parent VALUES (1, 0);   -- expect error 4025 (MariaDB) or 3819 (MySQL), check violated
--        INSERT INTO gf_probe_child VALUES (1, 99);   -- expect error 1452, foreign key fails
--        DROP TABLE gf_probe_child; DROP TABLE gf_probe_parent;
--   4. Backup. This apply is additive and touches no existing table, so before the FIRST apply the record of
--      step 2 is the safety net. Never take a whole-database dump for this feature: the legacy MyISAM tables
--      cannot be dumped consistently and would be locked. Once the tables exist, and before any rollback or
--      later auth migration, dump only the six auth tables (InnoDB, consistent snapshot), kept outside Git with
--      mode 0600 (a MySQL 8 client may also need --no-tablespaces; MariaDB's client does not know it):
--        mysqldump --no-defaults --single-transaction -h HOST -P PORT -u USER -p DATABASE \
--          gf_auth_accounts gf_auth_identifiers gf_auth_identifier_uses gf_auth_professional_links \
--          gf_auth_sessions gf_auth_security_events > auth-DATE.sql
--      Every client command in this header starts with --no-defaults, which the clients accept only as their
--      first option, because otherwise they read the [client] group of ~/.my.cnf, which the deploy CLI never
--      inherits: a database= default there broke T036's real dump until it was added. PORT is 3306 for a
--      direct connection and the local port of the SSH tunnel otherwise (research R10), with HOST as
--      127.0.0.1, since a client may take localhost as its local socket and ignore the port. MariaDB's client
--      also installs these programs as mariadb-dump and mariadb (the names T036 used), and recent releases warn
--      that the mysql names will be removed. A MariaDB client from 11.4 on also requires TLS by default and
--      refuses a server without it ("SSL is required, but the server does not support it"), so for such a
--      target, like the local Docker database, add --skip-ssl right after --no-defaults; a MySQL 8 client falls
--      back to a plain connection by itself.
--      Prove the restore path once into a scratch database first (the destination is part of the record):
--        mysql --no-defaults -h HOST -P PORT -u USER -p SCRATCH_DATABASE < auth-DATE.sql
--      A logical export of only those tables from the host's own tooling is equivalent.
--
-- APPLY
--   mysql --no-defaults -h HOST -P PORT -u USER -p --database=AUTH_DATABASE \
--     --init-command="SET SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'" \
--     < database/migrations/auth/001_auth.sql
--   Do not pass --force: the client stops at the first error. If it stops midway, earlier tables remain;
--   run 001_auth.rollback.sql (safe to repeat, it names only the six tables below), fix the cause, apply again.
--
-- VERIFY AFTER APPLY (expected values in brackets)
--   Relations, engine and collation [6 rows, InnoDB, utf8mb4_bin]:
--     SELECT TABLE_NAME, ENGINE, TABLE_COLLATION FROM information_schema.TABLES
--      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'gf\_auth\_%' ORDER BY TABLE_NAME;
--   Constraint inventory [PRIMARY KEY 6, FOREIGN KEY 8, UNIQUE 4, CHECK 32]; enforcement itself is proved by
--   the probe in step 3, which must be repeated by hand after any server upgrade:
--     SELECT CONSTRAINT_TYPE, COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
--      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME LIKE 'gf\_auth\_%' GROUP BY CONSTRAINT_TYPE;
--   Referential rules [8 rows, every UPDATE_RULE and DELETE_RULE = RESTRICT]:
--     SELECT CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--      WHERE CONSTRAINT_SCHEMA = DATABASE();
--   Orphaned references [every count 0]:
--     SELECT 'fk_identifiers_account' AS fk, COUNT(*) AS orphans FROM gf_auth_identifiers c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.account_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_uses_account', COUNT(*) FROM gf_auth_identifier_uses c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.account_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_uses_identifier', COUNT(*) FROM gf_auth_identifier_uses c
--       LEFT JOIN gf_auth_identifiers p ON p.account_id = c.account_id AND p.normalized_value = c.normalized_value
--       WHERE p.normalized_value IS NULL
--     UNION ALL SELECT 'fk_links_account', COUNT(*) FROM gf_auth_professional_links c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.account_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_sessions_account', COUNT(*) FROM gf_auth_sessions c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.account_id WHERE p.id IS NULL
--     UNION ALL SELECT 'fk_events_actor', COUNT(*) FROM gf_auth_security_events c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.actor_user_id WHERE c.actor_user_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_events_subject', COUNT(*) FROM gf_auth_security_events c
--       LEFT JOIN gf_auth_accounts p ON p.id = c.subject_account_id
--       WHERE c.subject_account_id IS NOT NULL AND p.id IS NULL
--     UNION ALL SELECT 'fk_events_session', COUNT(*) FROM gf_auth_security_events c
--       LEFT JOIN gf_auth_sessions p ON p.id = c.session_id WHERE c.session_id IS NOT NULL AND p.id IS NULL;
--   First apply leaves every gf_auth_ table empty [six counts of 0].
--
-- ROLLBACK (001_auth.rollback.sql) AND THE POINT OF NO RETURN
--   Before any real account exists the rollback is free: it drops the six tables and nothing else.
--   After the first live account, the default rollback is NOT this script: disable real access and redeploy
--   the previous real-mode artifact, keeping the tables and audit history. Dropping them destroys accounts and
--   security events, and passwords cannot be recovered from hashes. Run the rollback only with every auth
--   consumer stopped, after a fresh verified backup (step 4) and after archiving the security events.
--   VERIFY AFTER ROLLBACK: the precondition query of step 2 returns 0, and the saved inventory of the
--   other tables is unchanged.
--
-- RESTORE (in place, after the rollback removed the six tables; before any real use)
--   mysql --no-defaults -h HOST -P PORT -u USER -p DATABASE < auth-DATE.sql
--   The dump names only the six auth tables, so it recreates them and touches nothing else; never restore a
--   whole-database dump over the legacy tables. Verify as after apply, plus row counts equal the backup's.
--   Invalidate every restored session so a rollback cannot revive an ended one, then require a fresh sign-in:
--     UPDATE gf_auth_sessions SET revoked_at = <now in epoch milliseconds> WHERE revoked_at IS NULL;
--
-- REHEARSAL
--   tests/auth-schema.test.mjs runs apply, fictional data, dump, rollback, reapply and restore on disposable
--   MariaDB 10.6 and MySQL 8.0 containers that also hold the real legacy DDL, and checks the legacy tables come
--   out identical; executed results are in specs/002-real-login/implementation-log.md. It is not a rehearsal
--   on the hosting server, which remains a required step before production, in a non-production database on
--   that server rather than in `fadasdobem`.

CREATE TABLE `gf_auth_accounts` (
  `id` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(200) NOT NULL,
  `role` VARCHAR(32) NOT NULL,
  `active` TINYINT NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `credential_version` INT NOT NULL,
  `account_kind` VARCHAR(8) NOT NULL,
  `audience` VARCHAR(255) NOT NULL,
  `bootstrap_key` VARCHAR(64) NULL DEFAULT NULL,
  `created_at` BIGINT NOT NULL,
  `updated_at` BIGINT NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_accounts_bootstrap_key` UNIQUE (`bootstrap_key`),
  CONSTRAINT `chk_accounts_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_accounts_display_name` CHECK (CHAR_LENGTH(TRIM(`display_name`)) > 0),
  CONSTRAINT `chk_accounts_role` CHECK (`role` IN ('administradora', 'assistente', 'supervisora', 'atendente', 'tarologa')),
  CONSTRAINT `chk_accounts_active` CHECK (`active` IN (0, 1)),
  CONSTRAINT `chk_accounts_credential_version` CHECK (`credential_version` > 0),
  CONSTRAINT `chk_accounts_kind` CHECK (`account_kind` IN ('real', 'test')),
  CONSTRAINT `chk_accounts_audience` CHECK (CHAR_LENGTH(TRIM(`audience`)) > 0),
  CONSTRAINT `chk_accounts_bootstrap_key` CHECK (`bootstrap_key` IS NULL OR (CHAR_LENGTH(`bootstrap_key`) > 0 AND CHAR_LENGTH(`bootstrap_key`) = CHAR_LENGTH(TRIM(`bootstrap_key`)))),
  CONSTRAINT `chk_accounts_password_hash` CHECK (CHAR_LENGTH(TRIM(`password_hash`)) > 0),
  CONSTRAINT `chk_accounts_created_at` CHECK (`created_at` > 0),
  CONSTRAINT `chk_accounts_updated_after_created` CHECK (`updated_at` >= `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `gf_auth_identifiers` (
  `normalized_value` VARCHAR(254) NOT NULL,
  `account_id` VARCHAR(64) NOT NULL,
  `display_value` VARCHAR(254) NOT NULL,
  PRIMARY KEY (`normalized_value`),
  CONSTRAINT `uq_identifiers_owner_value` UNIQUE (`account_id`, `normalized_value`),
  CONSTRAINT `fk_identifiers_account` FOREIGN KEY (`account_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_identifiers_normalized_value` CHECK (CHAR_LENGTH(`normalized_value`) > 0 AND CHAR_LENGTH(`normalized_value`) = CHAR_LENGTH(TRIM(`normalized_value`))),
  CONSTRAINT `chk_identifiers_display_value` CHECK (CHAR_LENGTH(TRIM(`display_value`)) > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `gf_auth_identifier_uses` (
  `account_id` VARCHAR(64) NOT NULL,
  `purpose` VARCHAR(8) NOT NULL,
  `normalized_value` VARCHAR(254) NOT NULL,
  PRIMARY KEY (`account_id`, `purpose`),
  KEY `idx_uses_identifier` (`account_id`, `normalized_value`),
  CONSTRAINT `fk_uses_account` FOREIGN KEY (`account_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_uses_identifier` FOREIGN KEY (`account_id`, `normalized_value`) REFERENCES `gf_auth_identifiers` (`account_id`, `normalized_value`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_uses_purpose` CHECK (`purpose` IN ('username', 'email'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `gf_auth_professional_links` (
  `account_id` VARCHAR(64) NOT NULL,
  `professional_id` VARCHAR(64) NOT NULL,
  `source` VARCHAR(8) NOT NULL,
  `verified_at` BIGINT NOT NULL,
  `active` TINYINT NOT NULL,
  PRIMARY KEY (`account_id`),
  CONSTRAINT `fk_links_account` FOREIGN KEY (`account_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_links_professional_id` CHECK (CHAR_LENGTH(`professional_id`) > 0 AND CHAR_LENGTH(`professional_id`) = CHAR_LENGTH(TRIM(`professional_id`))),
  CONSTRAINT `chk_links_source` CHECK (`source` IN ('test', 'legacy')),
  CONSTRAINT `chk_links_verified_at` CHECK (`verified_at` > 0),
  CONSTRAINT `chk_links_active` CHECK (`active` IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `gf_auth_sessions` (
  `id` VARCHAR(64) NOT NULL,
  `token_hash` CHAR(64) NOT NULL,
  `account_id` VARCHAR(64) NOT NULL,
  `audience` VARCHAR(255) NOT NULL,
  `credential_version` INT NOT NULL,
  `created_at` BIGINT NOT NULL,
  `expires_at` BIGINT NOT NULL,
  `revoked_at` BIGINT NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_sessions_token_hash` UNIQUE (`token_hash`),
  KEY `idx_sessions_account_expiry` (`account_id`, `expires_at`),
  CONSTRAINT `fk_sessions_account` FOREIGN KEY (`account_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_sessions_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_sessions_token_hash` CHECK (`token_hash` REGEXP '^[0-9a-f]{64}$'),
  CONSTRAINT `chk_sessions_audience` CHECK (CHAR_LENGTH(TRIM(`audience`)) > 0),
  CONSTRAINT `chk_sessions_credential_version` CHECK (`credential_version` > 0),
  CONSTRAINT `chk_sessions_created_at` CHECK (`created_at` > 0),
  CONSTRAINT `chk_sessions_expiry_after_creation` CHECK (`expires_at` > `created_at`),
  CONSTRAINT `chk_sessions_revoked_after_creation` CHECK (`revoked_at` IS NULL OR `revoked_at` >= `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE `gf_auth_security_events` (
  `id` VARCHAR(64) NOT NULL,
  `operation_key` VARCHAR(128) NOT NULL,
  `occurred_at` BIGINT NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `outcome` VARCHAR(16) NOT NULL,
  `actor_user_id` VARCHAR(64) NULL DEFAULT NULL,
  `actor_role` VARCHAR(32) NULL DEFAULT NULL,
  `subject_account_id` VARCHAR(64) NULL DEFAULT NULL,
  `session_id` VARCHAR(64) NULL DEFAULT NULL,
  `identifier_fingerprint` CHAR(64) NULL DEFAULT NULL,
  `reason_code` VARCHAR(64) NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `uq_events_operation_key` UNIQUE (`operation_key`),
  KEY `idx_events_actor` (`actor_user_id`),
  KEY `idx_events_subject` (`subject_account_id`),
  KEY `idx_events_session` (`session_id`),
  KEY `idx_events_fingerprint` (`identifier_fingerprint`, `action`, `occurred_at`),
  CONSTRAINT `fk_events_actor` FOREIGN KEY (`actor_user_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_events_subject` FOREIGN KEY (`subject_account_id`) REFERENCES `gf_auth_accounts` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_events_session` FOREIGN KEY (`session_id`) REFERENCES `gf_auth_sessions` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `chk_events_id` CHECK (CHAR_LENGTH(`id`) > 0 AND CHAR_LENGTH(`id`) = CHAR_LENGTH(TRIM(`id`))),
  CONSTRAINT `chk_events_operation_key` CHECK (CHAR_LENGTH(`operation_key`) > 0 AND CHAR_LENGTH(`operation_key`) = CHAR_LENGTH(TRIM(`operation_key`))),
  CONSTRAINT `chk_events_occurred_at` CHECK (`occurred_at` > 0),
  CONSTRAINT `chk_events_action` CHECK (`action` IN ('admin.provision', 'auth.login.admit', 'auth.login', 'auth.logout', 'auth.access.denied')),
  CONSTRAINT `chk_events_outcome` CHECK (`outcome` IN ('success', 'denied', 'already-exists', 'unavailable', 'throttled')),
  CONSTRAINT `chk_events_actor_role` CHECK (`actor_role` IS NULL OR `actor_role` IN ('administradora', 'assistente', 'supervisora', 'atendente', 'tarologa')),
  CONSTRAINT `chk_events_fingerprint` CHECK (`identifier_fingerprint` IS NULL OR `identifier_fingerprint` REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
