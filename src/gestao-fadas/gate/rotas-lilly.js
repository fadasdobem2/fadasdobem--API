'use strict';

/**
 * Fatia Lilly do gate (Maturacao/59): `/lilly/*`. Quem chama é o SERVIÇO Lilly, não uma usuária: autentica por token de serviço
 * (`features/lilly/lilly.auth.js`), sem sessão. Flag `GF_FATIA_LILLY`: desligada responde 404 NOT_FOUND antes de tudo.
 * Erro de JSON malformado ou grande demais sai 4xx (recusa definitiva para a Lilly), nunca 5xx.
 */

const express = require('express');
const { Router } = require('express');
const rotas = require('../features/lilly/lilly.routes');
const { exigirTokenDeServico } = require('../features/lilly/lilly.auth');
const { lillyLigada } = require('../features/lilly/lilly.config');
const { falha } = require('../features/lilly/lilly.respostas');
const { enviarErro, metodoNaoPermitido } = require('./http');

function criarRotasLilly() {
  const router = Router();
  router.use('/lilly', (req, res, next) => (lillyLigada() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '2mb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defLilly = defs.find((d) => d.metodo === req.method); return req.defLilly ? next() : metodoNaoPermitido(res, permitido); },
      exigirTokenDeServico,
      json,
      (req, res, next) => req.defLilly.handler(req, res, next),
    );
  }
  router.use('/lilly', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return falha(res, 400, 'INVALID_INPUT', 'JSON inválido.');
    if (err && err.type === 'entity.too.large') return falha(res, 413, 'PAYLOAD_TOO_LARGE', 'Pedido grande demais.');
    console.error('[lilly] falha inesperada:', err && err.name);
    return falha(res, 500, 'LILLY_INTERNAL', 'Falha interna.');
  });
  return router;
}

module.exports = { criarRotasLilly };
