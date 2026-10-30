'use strict';

/**
 * Fatia Horários e escala do gate (Maturacao/28 seção 5.3): `GET /schedules`, `PUT /schedules/:tarotId/weekly`,
 * `PUT|DELETE /schedules/:tarotId/overrides[/:key]`. Mesma cadeia da B (método, sessão, permissão, parâmetros,
 * leitura/gravação), DTO puro (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`).
 *
 * Só existe com `GF_FATIA_HORARIOS=true`; desligada, todo `/schedules...` responde 404 NOT_FOUND antes do método e da sessão,
 * como `payoutsOff`, e a sessão não anuncia `realFeatures.schedules`.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/horarios/horarios.routes');
const { enviarErro, enviarJson, responderFalha } = require('./http');
const { registrar } = require('./rotas-operacoes');

const horariosLigado = (env = process.env) => `${env.GF_FATIA_HORARIOS || ''}`.trim().toLowerCase() === 'true';

/** Leitura: equipe precisa de `canViewSchedules` (403 + auditoria); a taróloga passa e o service confere o `tarotId` dela. */
const exigirEdicao = exigirCapacidade('canEditSchedule', { escrita: true });
const exigirLeitura = exigirCapacidade('canViewSchedules');
const permissaoDeLeitura = (req, res, next) => (req.perfilGate === 'tarologa' ? next() : exigirLeitura(req, res, next));

function criarRotasHorarios(provedor) {
  const router = Router();
  router.use('/schedules', (req, res, next) => (horariosLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '100kb' });
  for (const def of rotas) {
    registrar(router, provedor, {
      metodo: def.metodo, caminho: def.caminho, escrita: def.escrita,
      // Corpo lido depois da sessão e da permissão; a leitura só passa pela permissão de leitura.
      handler: [(req, res, next) => (def.escrita ? exigirEdicao(req, res, next) : permissaoDeLeitura(req, res, next)), json, def.handler],
    });
  }
  router.use('/schedules', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasHorarios, horariosLigado };
