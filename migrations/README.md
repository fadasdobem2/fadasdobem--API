# Migrações PostgreSQL

Ficheiros `*.js` nesta pasta executam **uma vez** por nome (registados em `_schema_migrations`).

## Formato

Cada ficheiro exporta `up({ sequelize, queryInterface, Sequelize })`:

```javascript
'use strict';

module.exports = {
  async up({ sequelize }) {
    await sequelize.query(`/* SQL idempotente */`);
  },
};
```

## Ordem

Prefixo `YYYYMMDDHHMMSS` ou numérico crescente no nome do ficheiro (ex.: `20260208150000-...`).

## Baseline

A primeira migração chama `sequelize.sync({ alter: false })` para **criar só o que falta** em bases novas, com base nos modelos em `src/models`. Alterações em bases já existentes devem ir em migrações seguintes com `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`, etc.

## Execução

- `npm start` — corre migrações e depois sobe a API (`package.json`).
- `npm run migrate` — só migrações.

Defina `SEQUELIZE_SYNC=false` no `.env` em produção e evite `alter: true` na app; o esquema evolui aqui.

## Conferência com os models

- `npm run comparar:models-migracoes`: cria 3 bancos descartáveis (migração oficial, sync dos models e migração "estrita") e sai com 1 se houver qualquer diferença de esquema.
- `npm run ensaiar:baseline-banco-existente [-- --historico]`: ensaia o runner sobre bancos que já têm tabelas e dados (totalmente migrado, só por models, parcial com N variados, produção simulada).
- Índices, FKs, checks e ENUMs dos models seguem o que as migrações criam (mesmos nomes); ao criar migração nova, declare o mesmo no model e rode o comparador.
