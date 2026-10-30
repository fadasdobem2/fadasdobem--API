'use strict';

/**
 * Fatia Ficha da cliente do gate (Maturacao/36): `GET` e `PUT` de `/client-guidance` (orientação financeira) e `/client-notes` (observações).
 * Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro (`desembrulhar`) e erro `{error:{code,message}}`
 * (`responderFalha`). Flag `GF_FATIA_FICHA`: desligada responde 404 NOT_FOUND antes do método e da sessão, e a sessão só anuncia
 * `realFeatures.clientFile` quando ligada.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/ficha/ficha.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const ligada = (flag, env = process.env) => `${env[flag] || ''}`.trim().toLowerCase() === 'true';
const fichaLigada = (env) => ligada('GF_FATIA_FICHA', env);

const PREFIXOS = ['/client-guidance', '/client-notes'];
const permissao = (def) => {
  const exigir = exigirCapacidade(def.capacidade, { escrita: def.escrita });
  return (req, res, next) => (def.tarologa && req.perfilGate === 'tarologa' ? next() : exigir(req, res, next));
};

function criarRotasFicha(provedor) {
  const router = Router();
  router.use(PREFIXOS, (req, res, next) => (fichaLigada() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '300kb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defFicha = defs.find((d) => d.metodo === req.method); return req.defFicha ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defFicha)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defFicha.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defFicha.handler(req, res, next),
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

module.exports = { criarRotasFicha, fichaLigada };
