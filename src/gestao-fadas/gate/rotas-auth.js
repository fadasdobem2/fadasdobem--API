'use strict';

/**
 * `/auth/login|logout|session` e `/ops/health` do gate. Contrato: `specs/002-real-login/contracts/auth-http.md` e
 * `specs/003-kinghost-cicd/contracts/health.md` da B. Nesta versão login/logout/session são PROXY da B (o provedor
 * decide); o gate só garante o formato da B quando a B está fora (503) e o método certo (405 + Allow).
 */

const { Router } = require('express');
const http = require('./http');
const { enviarJson, enviarErro, metodoNaoPermitido } = http;

/** Escreve a resposta repassada do provedor (status, cabeçalhos, Set-Cookie e corpo) ou 503 se ele não respondeu. */
function escreverResposta(res, resposta) {
  if (!resposta) return enviarErro(res, 'SERVICE_UNAVAILABLE');
  res.removeHeader('X-Powered-By');
  res.status(resposta.status);
  res.set({ 'Cache-Control': 'no-store', ...(resposta.corpo ? { 'Content-Type': 'application/json; charset=utf-8' } : {}), ...resposta.headers });
  return res.end(resposta.corpo || undefined);
}

const LIMITE_CORPO = 16 * 1024; // BODY_LIMIT_BYTES da B

/** Corpo bruto do login/logout quando o app ainda não o leu (se `express.json` já rodou, `req.body` já existe). */
function lerCorpoBruto(req) {
  if (req.body !== undefined || req.readableEnded) return Promise.resolve(true);
  return new Promise((resolve) => {
    const partes = [];
    let total = 0;
    req.on('data', (p) => {
      total += p.length;
      if (total <= LIMITE_CORPO) partes.push(p);
    });
    req.on('end', () => { req.body = Buffer.concat(partes); resolve(total <= LIMITE_CORPO); });
    req.on('error', () => resolve(false));
  });
}

function criarRotasAuth(provedor) {
  const router = Router();
  const rota = (caminho, metodo, acao) => {
    router.all(caminho, async (req, res) => {
      if (req.method !== metodo) return metodoNaoPermitido(res, metodo);
      try {
        if (metodo === 'POST' && !(await lerCorpoBruto(req))) return enviarErro(res, 'PAYLOAD_TOO_LARGE');
        return escreverResposta(res, await provedor[acao](req));
      } catch (_e) {
        return enviarErro(res, 'SERVICE_UNAVAILABLE');
      }
    });
  };
  rota('/auth/login', 'POST', 'login');
  rota('/auth/logout', 'POST', 'logout');
  rota('/auth/session', 'GET', 'sessao');
  return router;
}

module.exports = { criarRotasAuth, escreverResposta };
