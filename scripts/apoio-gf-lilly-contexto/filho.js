'use strict';

/**
 * FILHO de scripts/verificar-gf-lilly-contexto.js: roda contra o Postgres DESCARTÁVEL (fdb_lctx_*) já migrado. Legado MySQL SIMULADO em memória
 * (`legado-simulado.js`), banco novo real, dados fictícios. Prova os montadores do snapshot `POST /lilly/context` direto no serviço e o
 * controller pelo HTTP (token de serviço de teste).
 */

const path = require('path');
const http = require('http');
const express = require('express');
const { raiz, conferir, passo, resumo } = require('../apoio-gf-banco-novo/comum');
const { criarLegado } = require('./legado-simulado');
const { semear, AGORA } = require('./semear');

Object.assign(process.env, {
  GESTAO_FADAS_ESCRITA_ENABLED: 'true', FADAS_ENVIRONMENT: 'test', GF_NOVOS_DADOS: 'postgres', GF_FATIA_LILLY: 'true',
  LILLY_SERVICE_TOKEN: 'token-de-teste-com-mais-de-24-caracteres', UMBLER_ORGANIZATION_ID: 'org-teste',
});
delete process.env.GF_LILLY_ACOES_ENABLED;
delete process.env.LILLY_CLIENT_PROFILE_BASE_URL;
const r = (p) => path.join(raiz, p);

(async () => {
  const { sequelize } = require(r('src/config/database'));
  const { criarRotasLilly } = require(r('src/gestao-fadas/gate/rotas-lilly'));
  const { avulso } = require(r('src/gestao-fadas/features/lilly/dados/executor'));
  const servico = require(r('src/gestao-fadas/features/lilly/contexto/contexto.servico'));
  const { definirFontes } = require(r('src/gestao-fadas/features/lilly/contexto/fontes'));
  const tarologos = require(r('src/gestao-fadas/features/cadastros/tarologos.service'));
  const fin = require(r('src/gestao-fadas/features/financeiro-cliente/fin.contexto'));

  const legado = criarLegado();
  // Catálogo de tarólogos: legado simulado (o resto do catálogo é o real, do Postgres).
  tarologos.definirFonteLegado({
    listar: async () => [
      { idTarologo: 9001, nmuTarologo: 'Mara', ativo: 1, status: 1, meus_horarios: '', oraculos: [] },
      { idTarologo: 9002, nmuTarologo: 'Luz', ativo: 1, status: 1, meus_horarios: '', oraculos: [] },
      { idTarologo: 9003, nmuTarologo: 'Inativa', ativo: 0, status: 1, meus_horarios: '', oraculos: [] },
    ],
    obter: async () => null,
  });
  fin.definirLeitorDeHistorico(async () => new Map()); // histórico do ASP: nenhuma cliente com histórico anterior
  definirFontes({ ...legado.fontes });

  const consulta = async (sql, valores) => (await sequelize.query(sql, { replacements: valores, logging: false }))[0];
  const body = (event = {}, conversation) => ({ event: { id: 'umbler:E9', type: 'message', at: '2026-11-07T15:00:00.000Z', conversationId: 'chat-A', actor: 'client', internal: false, data: {}, ...event }, ...(conversation ? { conversation } : {}) });
  const contato = (phone) => ({ id: 'ct-x', phoneNumber: phone });
  /** Monta o snapshot com as fontes padrão (legado simulado) mais as trocas pedidas. */
  const snap = async (corpo, { trocas = {}, agora = AGORA, env } = {}) => {
    definirFontes({ ...legado.fontes, ...trocas });
    try { return await servico.montarContexto(corpo, { agora, env }); } finally { definirFontes({ ...legado.fontes }); }
  };

  const app = express();
  app.use('/api', criarRotasLilly());
  const servidor = http.createServer(app);
  await new Promise((res) => servidor.listen(0, '127.0.0.1', res));
  const chamar = async (corpo) => {
    const resp = await fetch(`http://127.0.0.1:${servidor.address().port}/api/lilly/context`, {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.LILLY_SERVICE_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    const texto = await resp.text();
    return { status: resp.status, texto, corpo: texto ? JSON.parse(texto) : null };
  };
  const ctx = { r, sequelize, avulso, servico, snap, body, contato, consulta, legado, chamar, conferir, passo, definirFontes, fin, AGORA };

  const log = console.log;
  const mudo = () => {}; const erro = console.error; console.info = mudo; console.warn = mudo;
  try {
    await semear({ sequelize, r, avulso });
    log('Banco semeado com dados fictícios.');
    await require('./casos-telefone')(ctx);
    await require('./casos-snapshot')(ctx);
    await require('./casos-consultas')(ctx);
    await require('./casos-regras')(ctx);
    await require('./casos-http')(ctx);
  } catch (e) {
    console.error = erro; log(`  FALHOU  inesperado: ${e.original ? e.original.message : e.stack}`); resumo().falhas.push('inesperado');
  }
  console.error = erro;
  servidor.close();
  await sequelize.close();
  const { ok, falhas } = resumo();
  log(`\n${ok} verificações passaram, ${falhas.length} falharam.`);
  process.exit(falhas.length ? 1 : 0);
})();
