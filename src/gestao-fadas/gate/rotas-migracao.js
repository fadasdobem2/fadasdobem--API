'use strict';

/**
 * Fatia Migração por planilha do gate (Maturacao/55): `/migration/histories`, `/migration/apply`, `/migration/reconciliation` e `/migration/without-sheet`.
 * Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`).
 * Flag `GF_FATIA_MIGRACAO`: desligada responde 404 NOT_FOUND antes do método e da sessão, e a sessão só anuncia `realFeatures.migration` quando ligada.
 * O corpo de `/migration/apply` aceita até 40 MB (um lote de planilha tem milhares de históricos); as demais rotas não leem corpo.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/migracao/migracao.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const ligada = (flag, env = process.env) => `${env[flag] || ''}`.trim().toLowerCase() === 'true';
const migracaoLigada = (env) => ligada('GF_FATIA_MIGRACAO', env);

const PREFIXO = '/migration';
const permissao = (def) => {
  const exigir = exigirCapacidade(def.capacidade, { escrita: def.escrita });
  return (req, res, next) => (def.tarologa && req.perfilGate === 'tarologa' ? next() : exigir(req, res, next));
};

function criarRotasMigracao(provedor) {
  const router = Router();
  router.use(PREFIXO, (req, res, next) => (migracaoLigada() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '40mb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defMigracao = defs.find((d) => d.metodo === req.method); return req.defMigracao ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defMigracao)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defMigracao.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defMigracao.handler(req, res, next),
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

module.exports = { criarRotasMigracao, migracaoLigada };
