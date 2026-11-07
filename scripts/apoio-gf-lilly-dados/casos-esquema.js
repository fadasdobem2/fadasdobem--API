'use strict';

/** Migração idempotente, tabelas e gatilho só-acrescenta de gf_lilly_eventos. */

const TABELAS = ['gf_lilly_vinculos', 'gf_lilly_eventos', 'gf_lilly_acoes', 'gf_lilly_notas_horario', 'gf_lilly_pagamento_refs', 'gf_lilly_cotacoes', 'gf_lilly_avisos'];

module.exports = async ({ r, sequelize, consulta, conferir, passo }) => {
  console.log('Esquema');
  await passo('migração roda de novo sem erro (idempotente) e as 7 tabelas existem', async () => {
    await require(r('migrations/20261203000000-gestao-fadas-lilly.js')).up({ sequelize });
    const faltando = [];
    for (const t of TABELAS) if (!(await consulta('SELECT to_regclass(:t) AS ok', { t }))[0].ok) faltando.push(t);
    conferir('7 tabelas gf_lilly_*', faltando.length === 0, faltando.join(','));
  });
  await consulta("INSERT INTO gf_lilly_eventos (id, source, at, actor, internal, data) VALUES ('t:gatilho', 'umbler', now(), 'system', false, '{}')");
  await passo('gatilho: UPDATE em gf_lilly_eventos é barrado', async () => {
    let barrou = false;
    try { await consulta("UPDATE gf_lilly_eventos SET text = 'x' WHERE id = 't:gatilho'"); } catch (e) { barrou = /so acrescenta/.test(e.message); }
    conferir('UPDATE barrado', barrou);
  });
  await passo('gatilho: DELETE em gf_lilly_eventos é barrado', async () => {
    let barrou = false;
    try { await consulta("DELETE FROM gf_lilly_eventos WHERE id = 't:gatilho'"); } catch (e) { barrou = /so acrescenta/.test(e.message); }
    conferir('DELETE barrado', barrou);
  });
  await passo('CHECK: staff_authorized exige ator staff em nota privada', async () => {
    let barrou = false;
    try { await consulta("INSERT INTO gf_lilly_eventos (id, source, at, actor, internal, data, staff_authorized) VALUES ('t:ck', 'umbler', now(), 'client', false, '{}', true)"); } catch (e) { barrou = /chk_lilly_eventos_staff/.test(e.message); }
    conferir('CHECK barrou', barrou);
  });
};
