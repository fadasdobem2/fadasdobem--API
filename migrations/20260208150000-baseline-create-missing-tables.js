'use strict';

/**
 * Cria tabelas e tipos em falta conforme `src/models` — sem `alter` (evita SQL inválido no Postgres).
 *
 * Em bases antigas onde `sessions` já existia sem colunas telecom, `sequelize.sync()` tentava
 * criar índices (ex.: `telecom_provider`) **antes** das migrações `20260307*` — falhava com 42703.
 * Por isso, se `sessions` já existe, garantimos com `ADD COLUMN IF NOT EXISTS` o mínimo para o modelo atual.
 */
module.exports = {
  async up({ sequelize }) {
    const [[row]] = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sessions'
      ) AS exists;
    `);

    if (row?.exists) {
      await sequelize.query(`
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_channel_id VARCHAR(128);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS telecom_provider VARCHAR(24);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS provider_channel_id VARCHAR(160);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS telecom_status VARCHAR(32);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_uid_client BIGINT;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agora_uid_specialist BIGINT;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_end_reason VARCHAR(512);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS rtc_duration_seconds INTEGER;
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intelbras_unique_id VARCHAR(128);
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS intelbras_bridge_id VARCHAR(160);
      `);
      await sequelize.query(`
        UPDATE sessions SET telecom_status = 'PENDING'
        WHERE telecom_status IS NULL OR trim(telecom_status::text) = '';
      `);
    }

    await criarEsquemaDosModels(sequelize);
  },
  // Exportado só para o comparador (scripts/comparar-models-migracoes.js); não altera o efeito de `up`.
  criarEsquemaDosModels,
};

/**
 * Equivale ao `sequelize.sync({ alter: false })`, mas sem a 2a passada `alter: true` que o Sequelize faz quando os models
 * têm referências cíclicas: ela gera SQL inválido no Postgres (ENUM com comentário em `payment_orders.payment_method`,
 * "syntax error at or near USING") e falha também em `Session` e `AccountRecoveryRequest`, impedindo subir um banco novo.
 *
 * 1) Sem ciclo, delega ao `sync` normal (mesmo comportamento de antes).
 * 2) Com ciclo: cria tabelas/enums/índices sem FKs (como o Sequelize) e depois adiciona só as FKs que faltam, lendo
 *    `references` dos atributos dos models. Não altera colunas já existentes.
 */
async function criarEsquemaDosModels(sequelize) {
  const colunasExistentes = await lerColunasExistentes(sequelize);
  const restaurar = ocultarIndicesDeColunasAusentes(sequelize, colunasExistentes);
  try {
    if (sequelize.modelManager.getModelsTopoSortedByForeignKey() != null) {
      await sequelize.sync({ alter: false, logging: false });
      return;
    }
    const models = sequelize.modelManager.models;
    for (const model of models) {
      await model.sync({ withoutForeignKeyConstraints: true, logging: false });
    }
    for (const model of models) {
      await adicionarFksFaltantes(sequelize, model, colunasExistentes);
    }
  } finally {
    restaurar();
  }
}

/** { tabela: Set(colunas) } do que já existe no banco (vazio em banco novo). */
async function lerColunasExistentes(sequelize) {
  const [rows] = await sequelize.query(
    `SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'`,
    { logging: false }
  );
  const out = new Map();
  for (const { t, c } of rows) {
    if (!out.has(t)) out.set(t, new Set());
    out.get(t).add(c);
  }
  return out;
}

/** Colunas que um índice do model referencia (campo simples, {name} ou expressão fn/col). */
function colunasDoIndice(ix, model) {
  const achar = (f) => {
    if (typeof f === 'string') return [f];
    if (f && f.col) return [f.col];
    if (f && f.args) return f.args.flatMap(achar);
    if (f && (f.name || f.attribute)) return [f.name || f.attribute];
    return [];
  };
  return (ix.fields || []).flatMap(achar).map((a) => (model.rawAttributes[a] && model.rawAttributes[a].field) || a);
}

/**
 * Em tabela que JÁ existe (banco criado antes por sync com models mais antigos), o `sync` tenta criar os índices
 * dos models e falha (42703) se a coluna ainda não existe: ela só chega numa migração posterior, que cria o mesmo
 * índice com o mesmo nome. Aqui os índices cujas colunas faltam ficam fora do sync; os models são restaurados no fim.
 */
function ocultarIndicesDeColunasAusentes(sequelize, existentes) {
  const originais = new Map();
  for (const model of sequelize.modelManager.models) {
    const { table } = nomeTabela(model.getTableName());
    const cols = existentes.get(table);
    if (!cols || !model._indexes) continue;
    originais.set(model, model._indexes);
    const ausentes = Object.values(model.rawAttributes).map((a) => a.field || a.fieldName).filter((c) => !cols.has(c));
    const usaAusente = (ix) => {
      const onde = ix.where ? ix.where.val || JSON.stringify(ix.where) : '';
      return ausentes.some((c) => onde.includes(`"${c}"`));
    };
    model._indexes = model._indexes.filter((ix) => !usaAusente(ix) && colunasDoIndice(ix, model).every((c) => cols.has(c)));
  }
  return () => originais.forEach((idx, model) => { model._indexes = idx; });
}

function nomeTabela(t) {
  return typeof t === 'string' ? { schema: 'public', table: t } : { schema: t.schema || 'public', table: t.tableName };
}

async function adicionarFksFaltantes(sequelize, model, colunasExistentes) {
  const qg = sequelize.getQueryInterface().queryGenerator;
  const { schema, table } = nomeTabela(model.getTableName());
  for (const [nomeAttr, attr] of Object.entries(model.rawAttributes)) {
    if (!attr.references) continue;
    const coluna = attr.field || nomeAttr;
    const colsDaTabela = colunasExistentes.get(table);
    if (colsDaTabela && !colsDaTabela.has(coluna)) continue; // tabela antiga: a coluna (e a FK) vêm de migração posterior
    const refModel = attr.references.model;
    const ref = nomeTabela(typeof refModel === 'object' && refModel.getTableName ? refModel.getTableName() : refModel);
    const [[{ existe }]] = await sequelize.query(
      `SELECT EXISTS (
         SELECT 1 FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY (c.conkey)
         WHERE c.contype = 'f' AND n.nspname = :schema AND t.relname = :table AND a.attname = :coluna
       ) AS existe`,
      { replacements: { schema, table, coluna }, logging: false }
    );
    if (existe) continue;
    let sql = `ALTER TABLE ${qg.quoteTable({ schema, tableName: table })} ADD FOREIGN KEY (${qg.quoteIdentifier(coluna)}) ` +
      `REFERENCES ${qg.quoteTable({ schema: ref.schema, tableName: ref.table })} (${qg.quoteIdentifier(attr.references.key || 'id')})`;
    if (attr.onDelete) sql += ` ON DELETE ${attr.onDelete.toUpperCase()}`;
    if (attr.onUpdate) sql += ` ON UPDATE ${attr.onUpdate.toUpperCase()}`;
    await sequelize.query(sql, { logging: false });
  }
}
