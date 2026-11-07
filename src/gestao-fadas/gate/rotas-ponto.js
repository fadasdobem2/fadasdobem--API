'use strict';

/**
 * Fatia Ponto e escala do gate (pacote da Nice, docs/banco/17_Ponto_Escala_Atividade_v702.md): `/staff-clock?resource=...`, o MESMO contrato HTTP que o front da Nice chama
 * (`features/atendimento/staff-clock-remote.ts`). Diferenças deliberadas da cadeia padrão do gate: o front lê o erro como TEXTO
 * (`{ error: <frase> }`, não `{ error: { code, message } }`), então esta rota responde nesse formato; a recepção de eventos
 * (`resource=ingest`) não usa sessão, e sim token de servidor.
 *
 * Só existe com `GF_FATIA_PONTO=true`. Desligada, passa adiante (`next('router')`) e quem responde é a rota do próprio front
 * (que diz que o ponto aguarda o banco do servidor). A gravação exige também `GESTAO_FADAS_ESCRITA_ENABLED=true`.
 */

const express = require('express');
const { Router } = require('express');
const controller = require('../features/ponto/ponto.controller');
const { enviarJson, COPIA } = require('./http');
const { aplicarContexto } = require('./contexto');

const pontoLigado = (env = process.env) => `${env.GF_FATIA_PONTO || ''}`.trim().toLowerCase() === 'true';
const NOSNIFF = { 'X-Content-Type-Options': 'nosniff' };
const falha = (res, status, texto, extra = {}) => enviarJson(res, status, { error: texto }, { ...NOSNIFF, ...extra });
const PERMITIDOS = ['GET', 'POST', 'PUT'];

function autenticar(provedor) {
  return async (req, res, next) => {
    let r;
    try { r = await provedor.validar(req); } catch (_e) { r = { status: 'unavailable' }; }
    if (r.status === 'absent') return falha(res, 401, 'Entre para continuar.');
    if (r.status === 'invalid') return falha(res, 401, COPIA.SESSION_ENDED);
    if (r.status === 'access-unavailable') return falha(res, 403, COPIA.NO_ACCESS);
    if (r.status !== 'identity') return falha(res, 503, COPIA.SERVICE_UNAVAILABLE);
    try { aplicarContexto(req, r); } catch (_e) { return falha(res, 503, COPIA.SERVICE_UNAVAILABLE); }
    return next();
  };
}

/** Gravações só do próprio site: origem igual ao host e nada de pedido de outro site. */
function origemPropria(req, res, next) {
  if (req.method === 'GET') return next();
  const origem = req.headers.origin;
  let mesmo = false;
  try { mesmo = Boolean(origem) && new URL(origem).host === req.headers.host; } catch (_e) { mesmo = false; }
  if (!mesmo || req.headers['sec-fetch-site'] === 'cross-site') return falha(res, 403, 'Origem não autorizada.');
  return next();
}

const exigirJson = (req, res, next) => (req.method === 'GET' || req.is('application/json') ? next() : falha(res, 415, 'Envie JSON.'));

function criarRotasPonto(provedor) {
  const router = Router();
  const json = express.json({ limit: '256kb', strict: true });
  router.all('/staff-clock', (req, res, next) => {
    if (!pontoLigado()) return next('router');
    if (!PERMITIDOS.includes(req.method)) return falha(res, 405, 'Método não permitido.', { Allow: PERMITIDOS.join(', ') });
    res.json = (corpo) => enviarJson(res, res.statusCode || 200, corpo, NOSNIFF);
    const recurso = `${req.query.resource || ''}`;
    if (recurso === 'availability' && req.method === 'GET') return controller.disponibilidade(req, res);
    // A recepção do diário é de servidor para servidor: sem sessão, sem cookie.
    if (recurso === 'ingest') return exigirJson(req, res, () => json(req, res, (e) => (e ? next(e) : controller.recepcao(req, res, next))));
    return autenticar(provedor)(req, res, () => origemPropria(req, res, () => exigirJson(req, res, () => json(req, res, (e) => (e ? next(e) : controller.comSessao(req, res, next))))));
  });
  router.use('/staff-clock', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return falha(res, 400, 'JSON inválido.');
    if (err && err.type === 'entity.too.large') return falha(res, 413, 'Conteúdo muito extenso.');
    if (err && err.name === 'PontoErro') return falha(res, err.status, err.message);
    console.error(`[ponto] indisponível: ${(err && err.name) || 'desconhecido'}`);
    return falha(res, 503, 'Não foi possível acessar o ponto no servidor. Confira a conexão e a configuração.');
  });
  return router;
}

module.exports = { criarRotasPonto, pontoLigado };
