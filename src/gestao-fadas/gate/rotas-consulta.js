'use strict';

/**
 * Fatias Consulta (5 a 7) do gate (Maturacao/28 seção 4.3): `GET|POST /consultations`, `POST /consultations/:id/{start,pause,resume,
 * finish,finish-by-staff,cancel-by-reader,more-time,finish/correction-request,revise}` e `GET /panel/sources` (fontes do Painel). Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro
 * (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`).
 *
 * Só existe com `GF_FATIA_CONSULTA=true`; desligada, todo `/consultations...` responde 404 NOT_FOUND antes do método e da sessão,
 * como `payoutsOff`, e a sessão não anuncia `realFeatures.consultation`. A equipe passa pela permissão; a taróloga passa e o
 * service confere o `tarotId` dela.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/consultas-ciclo/ciclo.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const consultaLigada = (env = process.env) => `${env.GF_FATIA_CONSULTA || ''}`.trim().toLowerCase() === 'true';

const exigirEscrita = exigirCapacidade('canManageConsultations', { escrita: true });
const exigirLeitura = exigirCapacidade('canViewConsultations');
const permissao = (def) => (req, res, next) => (req.perfilGate === 'tarologa' ? next() : (def.escrita ? exigirEscrita : exigirLeitura)(req, res, next));

function criarRotasConsulta(provedor) {
  const router = Router();
  router.use(['/consultations', '/panel'], (req, res, next) => (consultaLigada() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '300kb' });
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defConsulta = defs.find((d) => d.metodo === req.method); return req.defConsulta ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => permissao(req.defConsulta)(req, res, next),
      (req, res, next) => { res.locals.gateEscrita = req.defConsulta.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defConsulta.handler(req, res, next),
    );
  }
  router.use(['/consultations', '/panel'], (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasConsulta, consultaLigada };
