'use strict';

/**
 * FILHO de scripts/verificar-gf-lilly-dados.js: roda contra o Postgres DESCARTÁVEL (fdb_lilly_*) já migrado. Prova pelo HTTP das rotas da
 * Lilly (token de serviço de teste, leitor da Umbler FALSO injetado): migração idempotente, gatilho só-acrescenta, events/resolve, guarda de
 * idempotência, conciliação e notas do horário. Nenhum dado real; ids fictícios.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { raiz, conferir, passo, resumo } = require('../apoio-gf-banco-novo/comum');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GF_FATIA_LILLY: 'true',
  LILLY_SERVICE_TOKEN: 'token-de-teste-com-mais-de-24-caracteres', UMBLER_ORGANIZATION_ID: 'org-teste', LILLY_STAFF_AUTORIZADA: 'membro-autorizada,outra-autorizada',
});
delete process.env.GF_LILLY_ACOES_ENABLED;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarRotasLilly } = require(r('src/gestao-fadas/gate/rotas-lilly'));
  const controller = require(r('src/gestao-fadas/features/lilly/lilly.controller'));
  const { avulso } = require(r('src/gestao-fadas/features/lilly/dados/executor'));

  const app = express();
  app.use('/api', criarRotasLilly());
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
  const chamar = async (metodo, caminho, { corpo, chave } = {}) => {
    const resp = await fetch(`http://127.0.0.1:${servidor.address().port}/api${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${process.env.LILLY_SERVICE_TOKEN}`, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(chave ? { 'Idempotency-Key': chave } : {}) },
      ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
    });
    const texto = await resp.text();
    return { status: resp.status, corpo: texto ? JSON.parse(texto) : null };
  };
  const consulta = async (sql, valores) => (await sequelize.query(sql, { replacements: valores, logging: false }))[0];
  const ctx = { r, sequelize, controller, avulso, chamar, consulta, conferir, passo };

  const mudo = console.error; console.error = () => {}; console.warn = () => {};
  try {
    await require('./casos-esquema')(ctx);
    await require('./casos-eventos')(ctx);
    await require('./casos-acoes')(ctx);
    await require('./casos-notas')(ctx);
  } catch (e) {
    console.error = mudo; console.log(`  FALHOU  inesperado: ${e.stack}`); resumo().falhas.push('inesperado');
  }
  console.error = mudo;
  servidor.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  console.log(`\n${ok} verificações passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
