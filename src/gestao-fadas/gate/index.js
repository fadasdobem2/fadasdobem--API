'use strict';

/**
 * GATE de compatibilidade com o front do suspiro: um router Express que fala EXATAMENTE o contrato HTTP da API B
 * (`/api/auth/*`, `/api/ops/health`, `/api/operations/*`, `/api/payouts/*`), reaproveitando os controllers/services de
 * `gestao-fadas/features/**`. Só adapta: autenticação, erro `{error:{code,message}}`, status e cabeçalhos da B.
 *
 * Uso:
 *   const { montarGate } = require('./src/gestao-fadas/gate');
 *   montarGate(app);                                   // monta em /api (proxy da B, env GATE_B_ORIGEM)
 *   // ou: app.use('/api', criarGate({ provedorDeSessao }));
 *
 * Só responde os caminhos do contrato; qualquer outro `/api/...` segue para o resto do app (`next()`).
 */

const { Router } = require('express');
const { criarProvedorProxyB } = require('./sessao-proxy-b');
const { criarProvedorNativo } = require('./sessao-nativa');
const { criarRotasAuth } = require('./rotas-auth');
const { criarRotaHealth } = require('./rotas-health');
const { payoutsOff } = require('./payouts-off');
const { criarRotasPublicas } = require('./rotas-publicas');
const { criarRotasOperacoes } = require('./rotas-operacoes');
const { criarRotasHorarios } = require('./rotas-horarios');
const { criarRotasAgenda } = require('./rotas-agenda');
const { criarRotasPresenca } = require('./rotas-presenca');
const { criarRotasConsulta } = require('./rotas-consulta');
const { criarRotasCadastros } = require('./rotas-cadastros');
const { criarRotasFinanceiro } = require('./rotas-financeiro');
const { criarRotasRecados } = require('./rotas-recados');
const { criarRotasDivergencias } = require('./rotas-divergencias');
const { criarRotasMigracao } = require('./rotas-migracao');
const { criarRotasPendencias } = require('./rotas-pendencias');
const { criarRotasFicha } = require('./rotas-ficha');
const { criarRotasEstadoFinanceiro } = require('./rotas-estado-financeiro');
const { criarRotasContas } = require('./rotas-contas');
const { criarRotasConfig } = require('./rotas-config');
const { criarRotasLilly } = require('./rotas-lilly');
const rotasExtras = require('./rotas-extras');

/** Provedor por env `GATE_SESSAO`: `nativa` (login da A) ou `proxy-b` (padrão, não quebra o que existe). */
function escolherProvedor(env = process.env) {
  return `${env.GATE_SESSAO || ''}`.trim().toLowerCase() === 'nativa' ? criarProvedorNativo() : criarProvedorProxyB();
}

/**
 * @param {object} [opcoes]
 * @param {object} [opcoes.provedorDeSessao] interface em ./sessao-proxy-b.js (padrão por `GATE_SESSAO`: proxy da B (`GATE_B_ORIGEM`) ou nativa da A)
 * @param {Function} [opcoes.verificarLegado] `() => Promise<boolean>` para o health
 * @param {Array} [opcoes.extras] rotas extras (padrão: ./rotas-extras.js)
 */
function criarGate({ provedorDeSessao, verificarLegado, extras = rotasExtras } = {}) {
  const provedor = provedorDeSessao || escolherProvedor();
  const router = Router();
  router.use(criarRotaHealth({ verificarLegado }));
  router.use('/payouts', payoutsOff);
  router.use(criarRotasCadastros(provedor)); // antes das públicas: com a flag ligada atende /tarologos-cadastro
  router.use(criarRotasConfig(provedor)); // antes das públicas: com GF_FATIA_CONFIG atende /welcome (leitura, editor e PUT)
  router.use(criarRotasLilly()); // antes das públicas: o serviço Lilly usa token, não sessão
  router.use(criarRotasPublicas());
  router.use(criarRotasAuth(provedor));
  router.use(criarRotasContas(provedor));
  router.use(criarRotasHorarios(provedor));
  router.use(criarRotasAgenda(provedor));
  router.use(criarRotasPresenca(provedor));
  router.use(criarRotasConsulta(provedor));
  router.use(criarRotasFinanceiro(provedor));
  router.use(criarRotasRecados(provedor));
  router.use(criarRotasDivergencias(provedor));
  router.use(criarRotasMigracao(provedor));
  router.use(criarRotasPendencias(provedor));
  router.use(criarRotasFicha(provedor));
  router.use(criarRotasEstadoFinanceiro(provedor));
  router.use(criarRotasOperacoes(provedor, extras));
  return router;
}

/** Monta o gate em `/api` (o front do suspiro fala `/api/...`). */
function montarGate(app, opcoes) {
  const gate = criarGate(opcoes);
  app.use('/api', gate);
  return gate;
}

module.exports = { criarGate, montarGate, escolherProvedor };
