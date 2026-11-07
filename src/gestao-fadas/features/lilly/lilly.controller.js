'use strict';

/**
 * Controllers finos da fatia Lilly. Cada rota só valida a forma do pedido e chama o serviço do assunto (eventos/, acoes/, notas/).
 * O contexto (snapshot) vem dos montadores de contexto/; ações sem executor registrado são recusadas (403 desligada, 422 sem executor).
 */

const { montarContexto, registrar } = require('./contexto/contexto.servico');
const { normalizarChave } = require('./idempotencia/chave');
const { falha, sucesso } = require('./lilly.respostas');
const { enviarJson } = require('../../gate/http');
const acoes = require('./acoes/acoes.servico');
const { resolverEvento: resolverEventoServico } = require('./eventos/eventos.resolver');
const { listarNotasDoHorario } = require('./notas/notas-horario.servico');

/** Dependências trocáveis em teste (leitor da Umbler, verificador de eventos do site). */
const dependencias = { eventos: {} };
const definirDependencias = (d) => { dependencias.eventos = { ...d }; };

const objeto = (v) => v && typeof v === 'object' && !Array.isArray(v);

/**
 * `POST /lilly/context`: corpo inválido = 400. O snapshot é montado por `contexto/contexto.servico.js`; falha de UMA fonte vira `complete:false`
 * naquele assunto (200). Falha inesperada do conjunto = 500 sem detalhe (a Lilly trata 5xx como incerto); só o nome do erro vai ao registro.
 */
async function contexto(req, res) {
  if (!objeto(req.body) || !objeto(req.body.event)) return falha(res, 400, 'INVALID_INPUT', 'Informe o evento do contexto.');
  try {
    const { snapshot, cobertura } = await montarContexto(req.body);
    registrar(req.body.event.type, snapshot, cobertura);
    return sucesso(res, snapshot);
  } catch (e) {
    console.error('[lilly] falha inesperada no contexto:', e && e.name);
    return falha(res, 500, 'LILLY_INTERNAL', 'Falha interna.');
  }
}

/** Handlers async: falha inesperada vira 500 sem detalhe (a Lilly trata 5xx em POST como incerto e concilia). Erro com `status`/`code` próprios sai como veio. */
const seguro = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (e) {
    if (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 600 && typeof e.code === 'string') return falha(res, e.status, e.code, e.message);
    if (e && e.name === 'BancoNovoError') return falha(res, 503, 'LILLY_STORAGE_UNAVAILABLE', 'Armazenamento indisponível.');
    console.error('[lilly] falha inesperada:', e && e.name);
    return falha(res, 500, 'LILLY_INTERNAL', 'Falha interna.');
  }
};

const responder = (res, r) => enviarJson(res, r.status, r.corpo);

const resolverEvento = seguro(async (req, res) => {
  const { provider, event } = req.body || {};
  if (!['umbler', 'fadas'].includes(provider) || !objeto(event)) return falha(res, 400, 'INVALID_INPUT', 'Informe o provedor e o evento.');
  return responder(res, await resolverEventoServico({ provider, event }, dependencias.eventos));
});

const validarAcao = seguro(async (req, res) => {
  if (!objeto(req.body) || !objeto(req.body.action) || typeof req.body.action.kind !== 'string') return falha(res, 400, 'INVALID_INPUT', 'Informe a ação.');
  const { action, conversation, legacyBotRequest } = req.body;
  return responder(res, await acoes.validarAcao({ action, conversation, legacyBotRequest }));
});

const executarAcao = seguro(async (req, res) => {
  const chave = normalizarChave(req.get('idempotency-key'));
  if (!chave) return falha(res, 400, 'INVALID_INPUT', 'Informe a chave de idempotência.');
  if (!objeto(req.body) || !objeto(req.body.action) || typeof req.body.action.kind !== 'string') return falha(res, 400, 'INVALID_INPUT', 'Informe a ação.');
  return responder(res, await acoes.executarAcao({ chaveBruta: chave.original, action: req.body.action }));
});

const conciliarAcao = seguro(async (req, res) => responder(res, await acoes.conciliarAcao(req.params.chave)));

const notasDoHorario = seguro(async (req, res) => {
  const { tarologistId, date } = req.query;
  if (typeof tarologistId !== 'string' || !tarologistId.trim() || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return falha(res, 400, 'INVALID_INPUT', 'Informe o tarólogo e a data (AAAA-MM-DD).');
  }
  return sucesso(res, await listarNotasDoHorario({ tarologistId, date }));
});

module.exports = { contexto, resolverEvento, validarAcao, executarAcao, conciliarAcao, notasDoHorario, definirDependencias };
