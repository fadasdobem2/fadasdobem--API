'use strict';

/**
 * Fatia Cadastros do gate (Maturacao/29 seção 9): catálogo de tarólogos e extensão de clientes sob `/catalog/*` e o contrato de
 * `/tarologos-cadastro` do front (Cadastro de tarólogos), tudo no Postgres novo. Mesma cadeia da B (método, sessão, permissão,
 * parâmetros, leitura/gravação), DTO puro e erro `{error:{code,message}}` no catálogo; o `/tarologos-cadastro` fala o formato próprio
 * do front (`{ error: "texto" }`, sem código).
 *
 * Só existe com `GF_FATIA_CADASTROS=true`: desligada, `/catalog...` responde 404 NOT_FOUND antes do método e da sessão, e
 * `/tarologos-cadastro` segue para a rota pública que responde 503 como antes. A sessão só anuncia `realFeatures.cadastros` ligada.
 */

const express = require('express');
const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const rotas = require('../features/cadastros/cadastros.routes');
const cadastro = require('../features/cadastros/cadastro-tarologo.service');
const { enviarErro, enviarJson, responderFalha } = require('./http');
const { registrar, autenticar } = require('./rotas-operacoes');
const { aplicarContexto } = require('./contexto');

const cadastrosLigado = (env = process.env) => `${env.GF_FATIA_CADASTROS || ''}`.trim().toLowerCase() === 'true';
/** Ficha real de Clientes (Maturacao/32): só anuncia `realFeatures.clients`; usa as rotas de Cadastros, Pagamentos e Restrições (cada uma com a sua flag). */
const clientesLigado = (env = process.env) => `${env.GF_FATIA_CLIENTES || ''}`.trim().toLowerCase() === 'true';

const CAB = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const LIMITE = 1200000; // bytes do corpo do cadastro (a B: 1_200_000)

/** Resposta no formato do front: `{ error: "texto" }` ou o corpo. */
function responder(res, { status, corpo }) {
  res.removeHeader('X-Powered-By');
  res.status(status);
  for (const [k, v] of Object.entries({ 'Content-Type': 'application/json', ...CAB })) res.setHeader(k, v);
  return res.end(JSON.stringify(corpo));
}
const erro = (res, status, texto, extra = {}) => responder(res, { status, corpo: { error: texto, ...extra } });

/** Origem de uma gravação: a configurada para o gate (`FADAS_ORIGIN`) ou a do próprio servidor. */
const origemDoGate = (req, env = process.env) => `${env.FADAS_ORIGIN || ''}`.trim() || `${req.protocol}://${req.get('host')}`;

/** Corpo JSON até o limite da B; devolve o objeto ou responde o erro (415, 413, 400). */
function lerCorpo(req, res) {
  const tipo = `${req.headers['content-type'] || ''}`.toLowerCase();
  if (!tipo.startsWith('application/json')) { erro(res, 415, 'Envie o conteúdo em JSON.'); return Promise.resolve(null); }
  return new Promise((resolve) => {
    express.json({ limit: LIMITE, strict: true })(req, res, (e) => {
      if (e) {
        if (e.type === 'entity.too.large') erro(res, 413, 'O formulário ultrapassa o limite de tamanho. Reduza a foto.');
        else erro(res, 400, 'Conteúdo inválido.');
        return resolve(null);
      }
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) { erro(res, 400, 'Conteúdo inválido.'); return resolve(null); }
      return resolve(req.body);
    });
  });
}

const negarEditor = (res, ausente) => erro(res, 403, 'Sua conta precisa de autorização administrativa para acessar os cadastros.', { needsSignIn: ausente });

/** `editor` = administradora com sessão válida. Aplica o contexto (req.user) quando for. */
async function sessaoDeEditor(provedor, req) {
  let r;
  try { r = await provedor.validar(req); } catch (_e) { return { editor: false, ausente: false }; }
  if (r.status === 'identity' && r.identity.role === 'administradora') {
    try { aplicarContexto(req, r); } catch (_e) { return { editor: false, ausente: false }; }
    return { editor: true, ausente: false };
  }
  return { editor: false, ausente: r.status === 'absent' || r.status === 'invalid' };
}

function rotaCadastro(provedor) {
  return async (req, res, next) => {
    if (!cadastrosLigado()) return next();
    try {
      if (!['GET', 'POST', 'PUT'].includes(req.method)) return req.method === 'OPTIONS' || req.method === 'HEAD' ? next() : erro(res, 405, 'Método não permitido.');
      if (req.method !== 'GET') {
        const origem = req.headers.origin;
        if (origem !== origemDoGate(req) || req.headers['sec-fetch-site'] === 'cross-site') return erro(res, 403, 'Origem não autorizada.');
      }
      const q = req.query || {};
      if (req.method === 'GET' && q.token !== undefined) return responder(res, await cadastro.lerPorToken(String(q.token)));
      const publico = req.method === 'POST';
      let sessao = { editor: false, ausente: true };
      // Em POST só a ação de link exige a administradora; o corpo decide, então a sessão se resolve depois de lê-lo.
      if (!publico) {
        sessao = await sessaoDeEditor(provedor, req);
        if (!sessao.editor) return negarEditor(res, sessao.ausente);
      }
      if (req.method === 'GET') {
        if (q.approved === '1') return responder(res, await cadastro.lerAprovados());
        if (q.id || q.tarotId) return responder(res, await cadastro.lerFicha({ id: q.id ? String(q.id) : '', tarotId: q.tarotId ? String(q.tarotId) : '' }));
        return responder(res, await cadastro.lerLista());
      }
      const corpo = await lerCorpo(req, res);
      if (!corpo) return undefined;
      if (req.method === 'PUT') return responder(res, await cadastro.salvar(req, corpo));
      if (corpo.action !== undefined) {
        sessao = await sessaoDeEditor(provedor, req);
        if (!sessao.editor) return negarEditor(res, sessao.ausente);
        return responder(res, await cadastro.criarLink(req, corpo, origemDoGate(req)));
      }
      return responder(res, await cadastro.receberEnvio(corpo));
    } catch (e) {
      console.error(`[gate] cadastro de tarólogos indisponível: ${(e && e.name) || 'erro'}`); if (process.env.GF_DEBUG_X) console.error(e);
      return erro(res, 503, 'Não foi possível salvar ou carregar o cadastro. Seu rascunho foi mantido. Tente novamente.');
    }
  };
}

function criarRotasCadastros(provedor) {
  const router = Router();
  router.use('/catalog', (req, res, next) => (cadastrosLigado() ? next() : enviarErro(res, 'NOT_FOUND')));
  const json = express.json({ limit: '2mb' });
  const leitura = (req, res, next) => (req.perfilGate === 'tarologa' ? next() : exigirCapacidade('canViewTarologists')(req, res, next));
  for (const def of rotas) {
    const cliente = def.caminho.startsWith('/catalog/clients');
    registrar(router, provedor, {
      metodo: def.metodo, caminho: def.caminho, escrita: def.escrita,
      handler: [(req, res, next) => (def.escrita || cliente ? next() : leitura(req, res, next)), json, def.handler],
    });
  }
  router.use('/catalog', (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') return enviarJson(res, 400, { error: { code: 'INVALID_INPUT', message: 'Confira os dados informados e tente novamente.' } });
    if (err && err.type === 'entity.too.large') return enviarErro(res, 'PAYLOAD_TOO_LARGE');
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  router.all('/tarologos-cadastro', rotaCadastro(provedor));
  return router;
}

module.exports = { criarRotasCadastros, cadastrosLigado, clientesLigado, origemDoGate };
