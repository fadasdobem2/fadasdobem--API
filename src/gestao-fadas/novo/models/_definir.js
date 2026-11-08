'use strict';

/**
 * Apoio dos models Postgres das `gf_*` (banco novo). Um arquivo por tabela chama `definir(...)`.
 * O `sync` dos models (usado só pelo baseline de um banco vazio e pelo comparador) reproduz o que a migração
 * `migrations/*gestao-fadas-banco-novo.js` cria: CHECKs (de ../esquema-checks.js) e a FK composta depois da tabela.
 * Em tabela que já existe nada é alterado.
 */

const { Model, DataTypes, ValidationErrorItem } = require('sequelize');
const { CHECKS, CHECKS_ESPELHO, CHECKS_LILLY_V708, CHECKS_LILLY_V710 } = require('../esquema-checks');

/** `timestamp` SEM fuso (relógio de parede, como o DATETIME do MySQL). Fábrica, não `class extends` (ver _estrutura-pg.js). */
function TimestampSemFuso() {
  const tipo = new DataTypes.ABSTRACT();
  tipo.key = 'TIMESTAMP_SEM_FUSO';
  tipo.toSql = () => 'TIMESTAMP';
  tipo.validate = (valor) => {
    if (typeof valor !== 'string' && !(valor instanceof Date)) throw new ValidationErrorItem('timestamp inválido', 'Validation error', null, valor);
    return true;
  };
  return tipo;
}

/** Coluna que guarda o id do usuário da A (conta que assina), com FK real para `users(id)`. */
const usuario = (allowNull = false) => ({
  type: DataTypes.UUID, allowNull, references: { model: 'users', key: 'id' }, onUpdate: 'RESTRICT', onDelete: 'RESTRICT',
});
/** Coluna que referencia outra `gf_*` pelo id. */
const referencia = (tabela, chave = 'id', allowNull = true, tamanho = 64) => ({
  type: DataTypes.STRING(tamanho), allowNull, references: { model: tabela, key: chave }, onUpdate: 'RESTRICT', onDelete: 'RESTRICT',
});

const existiam = new Map();

function hooks(sequelize, tabela, extras) {
  return {
    beforeSync: async () => {
      const [linhas] = await sequelize.query(
        "SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = :tabela", { replacements: { tabela }, logging: false },
      );
      existiam.set(tabela, linhas.length > 0);
    },
    afterSync: async () => {
      if (existiam.get(tabela)) return;
      for (const [nome, expr] of [...(CHECKS[tabela] || []), ...(CHECKS_ESPELHO[tabela] || []), ...(CHECKS_LILLY_V708[tabela] || []), ...(CHECKS_LILLY_V710[tabela] || [])]) {
        await sequelize.query(`ALTER TABLE "${tabela}" ADD CONSTRAINT "${nome}" CHECK (${expr})`, { logging: false });
      }
      for (const sql of extras) await sequelize.query(sql, { logging: false });
    },
  };
}

/** Cria a fábrica `(sequelize) => Model` com `NOME` e `TABELA`, como os models de src/models/legado/novas. */
function definir({ nome, tabela, atributos, indexes = [], extras = [] }) {
  const fabrica = (sequelize) => {
    class Novo extends Model {}
    Novo.init(atributos, {
      sequelize, modelName: nome, tableName: tabela, freezeTableName: true, timestamps: false, underscored: false, indexes, hooks: hooks(sequelize, tabela, extras),
    });
    return Novo;
  };
  fabrica.NOME = nome;
  fabrica.TABELA = tabela;
  return fabrica;
}

module.exports = { definir, TimestampSemFuso, usuario, referencia };
