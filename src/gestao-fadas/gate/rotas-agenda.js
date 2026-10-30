'use strict';

/**
 * Fatias Agenda e Ordem da fila do gate (Maturacao/28 seção 2.3): `GET|POST /agenda`, `PATCH /agenda/:id`,
 * `POST /agenda/:id/{contact,refund-request,observations,departures,requested-wait,resolution,route-general,reservation/release}`,
 * `GET|POST /agenda/{admissions,requests}`, `POST /agenda/requests/:id/resolve` (Maturacao/29 seção 11) e
 * `POST /agenda/queues/:tarotId/order`. Mesma cadeia da B (método, sessão, permissão, parâmetros, leitura/gravação), DTO puro
 * (`desembrulhar`) e erro `{error:{code,message}}` (`responderFalha`).
 *
 * Só existe com `GF_FATIA_AGENDA=true`; desligada, todo `/agenda...` responde 404 NOT_FOUND antes do método e da sessão,
 * como `payoutsOff`, e a sessão não anuncia `realFeatures.agenda`.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/agenda/agenda.routes');
const { enviarErro, enviarJson, metodoNaoPermitido, responderFalha } = require('./http');
const { autenticar, desembrulhar } = require('./rotas-operacoes');

const agendaLigada = (env = process.env) => `${env.GF_FATIA_AGENDA || ''}`.trim().toLowerCase() === 'true';

const exigirEdicao = exigirCapacidade('canManageConsultations', { escrita: true });
const exigirLeitura = exigirCapacidade('canViewAgenda');
// Rotas de outro perfil (a taróloga pede "cliente quer consulta"): a capacidade vem da definição da rota.
const exigirOutra = (capacidade, escrita) => exigirCapacidade(capacidade, { escrita });

function criarRotasAgenda(provedor) {
  const router = Router();
  router.use('/agenda', (req, res, next) => (agendaLigada() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '300kb' });
  // Um mesmo caminho atende mais de um método (GET e POST em /agenda): agrupa por caminho e escolhe a definição pelo método.
  const porCaminho = new Map();
  for (const def of rotas) porCaminho.set(def.caminho, [...(porCaminho.get(def.caminho) || []), def]);
  for (const [caminho, defs] of porCaminho) {
    const permitido = defs.map((d) => d.metodo).join(', ');
    router.all(
      caminho,
      (req, res, next) => { req.defAgenda = defs.find((d) => d.metodo === req.method); return req.defAgenda ? next() : metodoNaoPermitido(res, permitido); },
      autenticar(provedor),
      (req, res, next) => (req.defAgenda.capacidade ? exigirOutra(req.defAgenda.capacidade, req.defAgenda.escrita)(req, res, next) : req.defAgenda.escrita ? exigirEdicao(req, res, next) : exigirLeitura(req, res, next)),
      (req, res, next) => { res.locals.gateEscrita = req.defAgenda.escrita; desembrulhar(res); next(); },
      json,
      (req, res, next) => req.defAgenda.handler(req, res, next),
    );
  }
  router.use('/agenda', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasAgenda, agendaLigada };
