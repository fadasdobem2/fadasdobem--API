'use strict';

/**
 * Fatia Formas de atendimento do gate (v711): `GET|PUT /professional-services`, o contrato de `/api/professional-services` do front (PABX, Áudio e
 * Texto de HOJE, por profissional). Erro como TEXTO (`{ error }`). Leitura: qualquer perfil; gravação: a profissional (a si) ou a administradora,
 * com a Origem do front (`FADAS_ORIGIN`) e JSON. Só existe com `GF_FATIA_FORMAS=true`; desligada, passa adiante.
 */

const express = require('express');
const { Router } = require('express');
const { repositorio } = require('../features/formas/formas.store');
const service = require('../features/formas/formas.service');
const { novosDadosNoPostgres } = require('../novo/modo');
const { enviarJson, COPIA } = require('./http');
const { aplicarContexto } = require('./contexto');
const { origemPermitida } = require('./sessao-nativa-http');

const formasLigado = (env = process.env) => `${env.GF_FATIA_FORMAS || ''}`.trim().toLowerCase() === 'true';
const NOSNIFF = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' };
const falha = (res, status, texto, extra = {}) => enviarJson(res, status, { error: texto }, { ...NOSNIFF, ...extra });

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

function gravacaoDoFront(req, res, next) {
  if (req.method === 'GET') return next();
  const permitida = origemPermitida();
  if (!permitida) return falha(res, 503, COPIA.SERVICE_UNAVAILABLE);
  if (req.headers.origin !== permitida || req.headers['sec-fetch-site'] === 'cross-site') return falha(res, 403, 'Origem não autorizada.');
  if (!req.is('application/json')) return falha(res, 415, 'Envie JSON.');
  return next();
}

function criarRotasFormas(provedor) {
  const router = Router();
  const json = express.json({ limit: '4kb', strict: true });
  router.all('/professional-services', (req, res, next) => {
    if (!formasLigado()) return next('router');
    if (!['GET', 'PUT'].includes(req.method)) return falha(res, 405, 'Método não permitido.', { Allow: 'GET, PUT' });
    return autenticar(provedor)(req, res, () => gravacaoDoFront(req, res, () => json(req, res, async (e) => {
      if (e) return next(e);
      const ator = { accountId: req.user.id, role: req.perfilGate, ...(req.user.tarotId ? { tarotId: req.user.tarotId } : {}) };
      const r = await service.tratar({ metodo: req.method, query: req.query, corpo: req.body, ator }, { store: novosDadosNoPostgres() ? repositorio : undefined });
      return enviarJson(res, r.status, r.corpo, NOSNIFF);
    })));
  });
  router.use('/professional-services', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return falha(res, 400, 'Conteúdo inválido.');
    if (err && err.type === 'entity.too.large') return falha(res, 413, 'Conteúdo muito extenso.');
    return falha(res, 503, 'Não foi possível acessar as formas de atendimento.');
  });
  return router;
}

module.exports = { criarRotasFormas, formasLigado };
