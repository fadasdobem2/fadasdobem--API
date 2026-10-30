'use strict';

/**
 * Fatia Recados do gate (Maturacao/30): `/notes...`. Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro
 * (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`). Flag `GF_FATIA_RECADOS`: desligada responde 404 NOT_FOUND antes do método
 * e da sessão (como `payoutsOff`); a sessão só anuncia `realFeatures.notes` quando ligada.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/recados/recados.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const recadosLigado = (env = process.env) => `${env.GF_FATIA_RECADOS || ''}`.trim().toLowerCase() === 'true';
const permissao = (def) => {
  const exigir = exigirCapacidade(def.capacidade, { escrita: def.escrita });
  return (req, res, next) => (def.tarologa && req.perfilGate === 'tarologa' ? next() : exigir(req, res, next));
};

function criarRotasRecados(provedor) {
  const router = Router();
  router.use('/notes', (req, res, next) => (recadosLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '300kb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defRecados = defs.find((d) => d.metodo === req.method); return req.defRecados ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defRecados)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defRecados.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defRecados.handler(req, res, next),
    );
  }
  router.use('/notes', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasRecados, recadosLigado };
