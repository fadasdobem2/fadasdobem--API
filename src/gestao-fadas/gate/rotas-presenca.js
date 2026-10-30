'use strict';

/**
 * Fatia Presença do gate (Maturacao/28 seção 5.3): `GET /presence`, `POST /presence/:tarotId/status|confirm|request|activity`.
 * Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro (`desembrulhar`) e erro
 * `{error:{code,message}}` (`responderFalha`).
 *
 * Só existe com `GF_FATIA_PRESENCA=true`; desligada, todo `/presence...` responde 404 NOT_FOUND antes do método e da sessão,
 * como `payoutsOff`, e a sessão não anuncia `realFeatures.presence`.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/presenca/presenca.routes');
const { enviarErro, enviarJson, responderFalha } = require('./http');
const { registrar } = require('./rotas-operacoes');

const presencaLigada = (env = process.env) => `${env.GF_FATIA_PRESENCA || ''}`.trim().toLowerCase() === 'true';

/** Equipe lê com `canViewSchedules` e escreve com `canManageConsultations`; a taróloga passa e o service confere o `tarotId` dela. */
const exigirEscrita = exigirCapacidade('canManageConsultations', { escrita: true });
const exigirLeitura = exigirCapacidade('canViewSchedules');
const permissao = (escrita) => (req, res, next) => (req.perfilGate === 'tarologa' ? next() : (escrita ? exigirEscrita : exigirLeitura)(req, res, next));

function criarRotasPresenca(provedor) {
  const router = Router();
  router.use('/presence', (req, res, next) => (presencaLigada() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '20kb' });
  for (const def of rotas) {
    registrar(router, provedor, {
      metodo: def.metodo, caminho: def.caminho, escrita: def.escrita,
      // Corpo lido depois da sessão e da permissão; a leitura só passa pela permissão de leitura.
      handler: [permissao(def.escrita), json, def.handler],
    });
  }
  router.use('/presence', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasPresenca, presencaLigada };
