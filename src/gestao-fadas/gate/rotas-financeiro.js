'use strict';

/**
 * Fatia Valores, Pagamentos e Restrições do gate (Maturacao/29 seção 10): `/pricing...`, `/payments...` e `/restrictions...`. Mesma cadeia da
 * B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`).
 * Três flags independentes: `GF_FATIA_PRECOS`, `GF_FATIA_PAGAMENTOS` e `GF_FATIA_RESTRICOES`. Grupo desligado responde 404 NOT_FOUND antes do
 * método e da sessão (como `payoutsOff`), e a sessão só anuncia `realFeatures.pricing|payments|restrictions` quando ligado.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/financeiro-cliente/financeiro.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const ligada = (flag, env = process.env) => `${env[flag] || ''}`.trim().toLowerCase() === 'true';
const precosLigado = (env) => ligada('GF_FATIA_PRECOS', env);
const pagamentosLigado = (env) => ligada('GF_FATIA_PAGAMENTOS', env);
const restricoesLigado = (env) => ligada('GF_FATIA_RESTRICOES', env);

const PREFIXOS = ['/pricing', '/payments', '/restrictions'];
const permissao = (def) => {
  const exigir = exigirCapacidade(def.capacidade, { escrita: def.escrita });
  return (req, res, next) => (def.tarologa && req.perfilGate === 'tarologa' ? next() : exigir(req, res, next));
};

function criarRotasFinanceiro(provedor) {
  const router = Router();
  // Grupo desligado: 404 antes do método e da sessão.
  router.use(PREFIXOS, (req, res, next) => {
    const flag = rotas.find((d) => req.originalUrl.split('?')[0].replace(/^\/api/, '').startsWith(d.caminho.split('/:')[0]))?.flag;
    return flag && ligada(flag) ? next() : enviarErro(res, 'NOT_FOUND');
  });
  const json = express.json({ limit: '300kb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defFinanceiro = defs.find((d) => d.metodo === req.method); return req.defFinanceiro ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defFinanceiro)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defFinanceiro.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defFinanceiro.handler(req, res, next),
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

module.exports = { criarRotasFinanceiro, precosLigado, pagamentosLigado, restricoesLigado };
