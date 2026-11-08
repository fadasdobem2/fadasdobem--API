'use strict';

/**
 * Fatia E-mails do gate (v711): `/email?resource=...`, o MESMO contrato HTTP de `/api/email` do front da Nice (Configurações > E-mails, convite por
 * e-mail, recuperação de acesso e link do convite). O front lê o erro como TEXTO (`{ error: <frase> }`), então esta rota responde nesse formato.
 * Públicos (sem sessão; o token do link ou o e-mail digitado é a credencial): `availability`, `inspect`, `accept`, `recovery`. O resto exige a
 * administradora. Gravações exigem a Origem do front (`FADAS_ORIGIN`) e JSON. Só existe com `GF_FATIA_EMAIL=true`; desligada, passa adiante.
 * O envio real depende também de `GF_EMAIL_ENVIO_ENABLED=true`, da chave `GF_EMAIL_CHAVE_SEGREDO` e de `GF_EMAIL_ORIGEM_PUBLICA` (https).
 */

const express = require('express');
const { Router } = require('express');
const controller = require('../features/email/email.controller');
const { enviarJson, COPIA } = require('./http');
const { aplicarContexto } = require('./contexto');
const { origemPermitida } = require('./sessao-nativa-http');

const emailLigado = (env = process.env) => `${env.GF_FATIA_EMAIL || ''}`.trim().toLowerCase() === 'true';
const NOSNIFF = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' };
const falha = (res, status, texto, extra = {}) => enviarJson(res, status, { error: texto }, { ...NOSNIFF, ...extra });
const PERMITIDOS = ['GET', 'POST', 'PUT'];
const PUBLICOS = new Set(['availability', 'inspect', 'accept', 'recovery']);

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

function origemDoFront(req, res, next) {
  if (req.method === 'GET') return next();
  const permitida = origemPermitida();
  if (!permitida) return falha(res, 503, COPIA.SERVICE_UNAVAILABLE);
  if (req.headers.origin !== permitida || req.headers['sec-fetch-site'] === 'cross-site') return falha(res, 403, 'Origem não autorizada.');
  return next();
}

const exigirJson = (req, res, next) => (req.method === 'GET' || req.is('application/json') ? next() : falha(res, 415, 'Envie JSON.'));

function criarRotasEmail(provedor) {
  const router = Router();
  const json = express.json({ limit: '64kb', strict: true });
  const executar = async (req, res, next) => {
    try {
      const r = await controller.tratar(req);
      return enviarJson(res, r.status, r.corpo, NOSNIFF);
    } catch (e) { return next(e); }
  };
  router.all('/email', (req, res, next) => {
    if (!emailLigado()) return next('router');
    if (!PERMITIDOS.includes(req.method)) return falha(res, 405, 'Método não permitido.', { Allow: PERMITIDOS.join(', ') });
    const recurso = `${req.query.resource || 'settings'}`;
    const corpo = () => origemDoFront(req, res, () => exigirJson(req, res, () => json(req, res, (e) => (e ? next(e) : executar(req, res, next)))));
    return PUBLICOS.has(recurso) ? corpo() : autenticar(provedor)(req, res, corpo);
  });
  router.use('/email', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return falha(res, 400, 'Dados inválidos.');
    if (err && err.type === 'entity.too.large') return falha(res, 413, 'Conteúdo muito extenso.');
    console.error(`[email] indisponível: ${(err && err.name) || 'desconhecido'}`);
    return falha(res, 503, 'O serviço de e-mails está indisponível.');
  });
  return router;
}

module.exports = { criarRotasEmail, emailLigado };
