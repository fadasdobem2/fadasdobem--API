'use strict';

/**
 * Fatia Contas do gate (Maturacao/33): `GET|POST /accounts`, `PATCH /accounts/:id`, `POST /accounts/:id/{password,active}`.
 * Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro e erro `{error:{code,message}}`. Só a
 * administradora (conferido no service). Gravações exigem a Origem do front (`FADAS_ORIGIN`, como o login) e JSON.
 * v706: `POST /accounts/:id/invitation[/cancel]` (administradora) e as duas rotas PÚBLICAS do link do convite, sem sessão (o token do link é
 * a credencial): `POST /invitations/resolve` e `POST /invitations/accept`.
 * Só existe com `GF_FATIA_CONTAS=true`; desligada, todo `/accounts...` responde 404 NOT_FOUND antes do método e da sessão.
 */

const express = require('express');
const { Router } = require('express');
const rotas = require('../features/contas/contas.routes');
const controlador = require('../features/contas/contas.controller');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');
const { origemPermitida } = require('./sessao-nativa-http');

const contasLigado = (env = process.env) => `${env.GF_FATIA_CONTAS || ''}`.trim().toLowerCase() === 'true';

/** Escrita só de quem veio do front (a sessão é por cookie). */
const conferirOrigem = (req, res, next) => {
  const permitida = origemPermitida();
  if (!permitida) return enviarErro(res, 'SERVICE_UNAVAILABLE');
  return req.headers.origin === permitida ? next() : enviarErro(res, 'ORIGIN_NOT_ALLOWED');
};

function criarRotasContas(provedor) {
  const router = Router();
  router.use('/accounts', (req, res, next) => (contasLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '6mb' }); // a foto de perfil viaja em data URL (até 3 MB de arquivo)
  // Um mesmo caminho atende mais de um método (GET e POST em /accounts): agrupa por caminho e escolhe a definição pelo método.
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defConta = defs.find((d) => d.metodo === req.method); return req.defConta ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => { res.locals.gateEscrita = req.defConta.escrita; desembrulhar(res); next(); },
      (req, res, next) => (req.defConta.escrita ? conferirOrigem(req, res, next) : next()),
      (req, res, next) => (req.defConta.escrita ? json(req, res, next) : next()),
      (req, res, next) => req.defConta.handler(req, res, next),
    );
  }
  // Link do convite: sem sessão; o corpo carrega o token (nunca na URL, para não ir a log de acesso).
  router.use('/invitations', (req, res, next) => (contasLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  for (const [caminho, handler] of [['/invitations/resolve', controlador.resolverConvite], ['/invitations/accept', controlador.aceitarConvite]]) {
    router.all(caminho, (req, res, next) => (req.method === 'POST' ? next() : metodoNaoPermitido(res, 'POST')), (req, res, next) => { res.locals.gateEscrita = true; desembrulhar(res); next(); }, conferirOrigem, json, handler);
  }
  router.use(['/accounts', '/invitations'], (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasContas, contasLigado };
