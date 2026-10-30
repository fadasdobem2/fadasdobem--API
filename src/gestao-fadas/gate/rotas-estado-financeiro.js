'use strict';

/**
 * Fatia Estado financeiro do gate (Maturacao/43): `/financial-reasons`, `/payout-additions` e `/operation-audit`. Mesma cadeia da B (método, sessão,
 * permissão, parâmetros, leitura/gravação), DTO puro (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`). Flag `GF_FATIA_ESTADO_FINANCEIRO`:
 * desligada responde 404 NOT_FOUND antes do método e da sessão, e a sessão só anuncia `realFeatures.financialState` quando ligada.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/estado-financeiro/estado.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const ligada = (flag, env = process.env) => `${env[flag] || ''}`.trim().toLowerCase() === 'true';
const estadoFinanceiroLigado = (env) => ligada('GF_FATIA_ESTADO_FINANCEIRO', env);

const PREFIXOS = ['/financial-reasons', '/payout-additions', '/operation-audit'];
const permissao = (def) => {
  const exigir = exigirCapacidade(def.capacidade, { escrita: def.escrita });
  return (req, res, next) => (def.tarologa && req.perfilGate === 'tarologa' ? next() : exigir(req, res, next));
};

function criarRotasEstadoFinanceiro(provedor) {
  const router = Router();
  router.use(PREFIXOS, (req, res, next) => (estadoFinanceiroLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '1mb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defEstadoFinanceiro = defs.find((d) => d.metodo === req.method); return req.defEstadoFinanceiro ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defEstadoFinanceiro)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defEstadoFinanceiro.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defEstadoFinanceiro.handler(req, res, next),
    );
  }
  router.use(PREFIXOS, (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasEstadoFinanceiro, estadoFinanceiroLigado };
