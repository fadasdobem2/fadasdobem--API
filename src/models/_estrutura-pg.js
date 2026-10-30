'use strict';
/**
 * Apoio estrutural dos models (somente DDL no `sync`; nenhuma regra de negócio).
 * Serve para o `sync` dos models reproduzir o que as migrações SQL criam e o Sequelize não expressa sozinho:
 *  - ENUM do Postgres com nome próprio (o Sequelize sempre nomeia `enum_<tabela>_<coluna>`);
 *  - CHECK constraints.
 * Em tabelas que já existem, nada é alterado (CREATE TABLE IF NOT EXISTS do sync); a convergência de bancos
 * antigos fica na migração 20261029120000-alinhar-models-e-migracoes.js.
 */
const { DataTypes, ValidationErrorItem } = require('sequelize');

/**
 * Tipo de coluna que usa um ENUM do Postgres já criado com nome livre (ex.: `enum_staff_status`).
 * Fábrica em vez de `class extends`, pois o `DataTypes.ABSTRACT` exportado pelo Sequelize é um Proxy
 * que descarta a subclasse no `new`.
 */
function EnumPgNomeado(nome, valores) {
  const tipo = new DataTypes.ABSTRACT();
  tipo.key = 'ENUM_PG_NOMEADO';
  tipo.values = valores;
  tipo.options = { values: valores };
  tipo.toSql = () => `"${nome}"`;
  tipo.validate = (valor) => {
    if (!valores.includes(valor)) {
      throw new ValidationErrorItem(`"${valor}" não é um valor válido para ${nome}`, 'Validation error', null, valor);
    }
    return true;
  };
  return tipo;
}

const existiam = new Map();

async function tabelaExiste(sequelize, tabela) {
  const [rows] = await sequelize.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :tabela`,
    { replacements: { tabela }, logging: false }
  );
  return rows.length > 0;
}

/**
 * Hooks de `sync` para um model: cria os ENUMs nomeados antes da tabela e os CHECKs depois dela,
 * apenas quando a tabela está sendo criada agora (nunca em tabela existente com dados).
 * `enums`: [{ nome, valores }]; `checks`: [{ nome, sql }].
 */
function hooksDeEstrutura(sequelize, tabela, { enums = [], checks = [] } = {}) {
  return {
    beforeSync: async () => {
      existiam.set(tabela, await tabelaExiste(sequelize, tabela));
      for (const e of enums) {
        const vals = e.valores.map((v) => `'${v}'`).join(', ');
        await sequelize.query(
          `DO $$ BEGIN CREATE TYPE "${e.nome}" AS ENUM (${vals}); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
          { logging: false }
        );
      }
    },
    afterSync: async () => {
      if (existiam.get(tabela)) return;
      for (const c of checks) {
        await sequelize.query(`ALTER TABLE "${tabela}" ADD CONSTRAINT "${c.nome}" CHECK (${c.sql})`, { logging: false });
      }
    },
  };
}

module.exports = { EnumPgNomeado, hooksDeEstrutura };
