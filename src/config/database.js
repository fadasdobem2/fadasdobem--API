const path = require('path');
const { Sequelize } = require('sequelize');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const logging = process.env.DB_LOGGING === 'true' ? console.log : false;

function envInt(name, fallback) {
  const n = Number.parseInt(`${process.env[name] ?? ''}`.trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Pool de conexões — CRÍTICO para escalar. Sem `pool`, o Sequelize usa `max: 5`
 * por processo e as requisições enfileiram/estouram sob carga.
 *
 * Regra de dimensionamento: `DB_POOL_MAX × nº_de_instâncias` deve ficar abaixo do
 * `max_connections` do Postgres (menos margem p/ migrações/admin). Ex.: Postgres com
 * 200 conexões e 8 instâncias → DB_POOL_MAX ≈ 20.
 */
const pool = {
  max: envInt('DB_POOL_MAX', 20),
  min: envInt('DB_POOL_MIN', 0),
  acquire: envInt('DB_POOL_ACQUIRE_MS', 30000),
  idle: envInt('DB_POOL_IDLE_MS', 10000),
  evict: envInt('DB_POOL_EVICT_MS', 1000),
};

const poolCommon = {
  dialect: 'postgres',
  logging,
  pool,
  define: {
    underscored: true,
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    deletedAt: 'deleted_at',
  },
};

/** SSL opcional para DATABASE_URL em nuvem */
const dialectOptionsSsl =
  process.env.DB_SSL === 'true'
    ? {
        require: true,
        rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      }
    : undefined;

let sequelize;

if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
  sequelize = new Sequelize(process.env.DATABASE_URL, {
    ...poolCommon,
    dialectOptions: dialectOptionsSsl ? { ssl: dialectOptionsSsl } : {},
  });
} else {
  sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    ...poolCommon,
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 5432,
  });
}

module.exports = { sequelize };
