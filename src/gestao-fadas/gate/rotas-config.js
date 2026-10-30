'use strict';

/**
 * Fatia Configurações do gate (Maturacao/33): `GET|PUT /welcome` lendo e gravando `gf_welcome` (editor da Tela de entrada).
 * Só existe com `GF_FATIA_CONFIG=true`; desligada, a rota cai na rota pública antiga (texto padrão, edição 503), como antes.
 * Contrato do front (`features/auth/welcome-service.ts`): erro `{ error: 'texto' }`; leitura pública sem sessão (só ativos);
 * editor e PUT exigem sessão de administradora; PUT checa Origem, JSON e 400 KB, e a revisão otimista dá 409.
 */

const express = require('express');
const { Router } = require('express');
const { aplicarContexto } = require('./contexto');
const { origemPermitida } = require('./sessao-nativa-http');
const svc = require('../features/config/welcome.service');

const configLigado = (env = process.env) => `${env.GF_FATIA_CONFIG || ''}`.trim().toLowerCase() === 'true';
const CAB = { 'Cache-Control': 'no-store', Vary: 'Cookie' };

function enviar(res, status, corpo) {
  res.removeHeader('X-Powered-By');
  res.status(status);
  for (const [k, v] of Object.entries({ 'Content-Type': 'application/json', ...CAB })) res.setHeader(k, v);
  return res.end(JSON.stringify(corpo));
}
const falha = (res, e) => (e instanceof svc.WelcomeHttpError ? enviar(res, e.status, { error: e.message, ...e.extra }) : enviar(res, 503, { error: svc.MSG.indisponivelGravar }));

const modoEditor = (req) => {
  const i = req.originalUrl.indexOf('?');
  return i >= 0 && new URLSearchParams(req.originalUrl.slice(i + 1)).get('editor') === '1';
};

/** Perfil da sessão (`administradora`...) ou null sem sessão válida; 503 se o provedor falhar. */
async function perfilDaSessao(provedor, req) {
  let r;
  try { r = await provedor.validar(req); } catch (_e) { throw new svc.WelcomeHttpError(503, svc.MSG.indisponivelLer); }
  if (r.status === 'identity') { aplicarContexto(req, r); return { perfil: req.perfilGate, usuarioId: req.user.id }; }
  if (r.status === 'access-unavailable') throw new svc.WelcomeHttpError(403, svc.MSG.semPermissao);
  if (r.status === 'unavailable') throw new svc.WelcomeHttpError(503, svc.MSG.indisponivelLer);
  return { perfil: null, usuarioId: null };
}

function criarRotasConfig(provedor) {
  const router = Router();
  const json = express.json({ limit: '400kb', type: () => true });

  router.all('/welcome', async (req, res, next) => {
    if (!configLigado()) return next();
    const metodo = req.method === 'HEAD' ? 'GET' : req.method;
    if (metodo !== 'GET' && metodo !== 'PUT') return next(); // OPTIONS e 405: rota pública
    try {
      if (metodo === 'GET' && !modoEditor(req)) return enviar(res, 200, await svc.lerPublico());
      const sessao = await perfilDaSessao(provedor, req);
      svc.exigirAdministradora(sessao.perfil);
      if (metodo === 'GET') return enviar(res, 200, await svc.lerRegistro());
      const permitida = origemPermitida();
      if (!permitida || req.headers.origin !== permitida) return enviar(res, 403, { error: 'Origem não autorizada.' });
      if (!`${req.headers['content-type'] || ''}`.toLowerCase().startsWith('application/json')) return enviar(res, 415, { error: 'Envie o conteúdo em JSON.' });
      return json(req, res, async (erroCorpo) => {
        if (erroCorpo) return enviar(res, erroCorpo.type === 'entity.too.large' ? 413 : 400, { error: erroCorpo.type === 'entity.too.large' ? 'O conteúdo ultrapassa o limite de tamanho.' : svc.MSG.corpoInvalido });
        try { return enviar(res, 200, await svc.gravar({ perfil: sessao.perfil, usuarioId: sessao.usuarioId, corpo: req.body })); } catch (e) { return falha(res, e); }
      });
    } catch (e) {
      return falha(res, e);
    }
  });

  return router;
}

module.exports = { criarRotasConfig, configLigado };
