'use strict';

/**
 * Fatia Divergências do gate (Maturacao/31): `GET /divergences` e `PUT /divergences/:id`. Mesma cadeia da B (método, sessão, permissão,
 * parâmetros, leitura/gravação), DTO puro (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`). Flag `GF_FATIA_DIVERGENCIAS`:
 * desligada responde 404 NOT_FOUND antes do método e da sessão, e a sessão só anuncia `realFeatures.divergences` quando ligada.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/divergencias/divergencias.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const ligada = (flag, env = process.env) => `${env[flag] || ''}`.trim().toLowerCase() === 'true';
const divergenciasLigado = (env) => ligada('GF_FATIA_DIVERGENCIAS', env);

const PREFIXO = '/divergences';
const permissao = (def) => {
  const exigir = exigirCapacidade(def.capacidade, { escrita: def.escrita });
  return (req, res, next) => (def.tarologa && req.perfilGate === 'tarologa' ? next() : exigir(req, res, next));
};

function criarRotasDivergencias(provedor) {
  const router = Router();
  router.use(PREFIXO, (req, res, next) => (divergenciasLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '300kb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defDivergencias = defs.find((d) => d.metodo === req.method); return req.defDivergencias ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defDivergencias)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defDivergencias.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defDivergencias.handler(req, res, next),
    );
  }
  router.use(PREFIXO, (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasDivergencias, divergenciasLigado };
