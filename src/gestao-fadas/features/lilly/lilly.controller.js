'use strict';

/**
 * Controllers finos da fatia Lilly. Cada rota só valida a forma do pedido e chama o serviço do assunto; nesta etapa (fundação) as
 * rotas respondem com o contrato certo e SEM efeito: contexto incompleto, evento não resolvido, validação negada, ação recusada.
 */

const { envelope } = require('./contexto/contexto.base');
const { normalizarChave } = require('./idempotencia/chave');
const { acoesLiberadas } = require('./lilly.config');
const { falha, sucesso } = require('./lilly.respostas');

const objeto = (v) => v && typeof v === 'object' && !Array.isArray(v);

function contexto(req, res) {
  if (!objeto(req.body) || !objeto(req.body.event)) return falha(res, 400, 'INVALID_INPUT', 'Informe o evento do contexto.');
  return sucesso(res, { ...envelope(), clients: [], tarologists: [], appointments: [], consultations: [], payments: [], links: [], messages: [] });
}

function resolverEvento(req, res) {
  const { provider, event } = req.body || {};
  if (!['umbler', 'fadas'].includes(provider) || !objeto(event)) return falha(res, 400, 'INVALID_INPUT', 'Informe o provedor e o evento.');
  return falha(res, 422, 'LILLY_EVENT_UNRESOLVED', 'A resolução de eventos ainda não está habilitada.');
}

function validarAcao(req, res) {
  if (!objeto(req.body) || !objeto(req.body.action) || typeof req.body.action.kind !== 'string') return falha(res, 400, 'INVALID_INPUT', 'Informe a ação.');
  return sucesso(res, { allowed: false, reason: 'A validação de ações ainda não está habilitada.' });
}

function executarAcao(req, res) {
  const chave = normalizarChave(req.get('idempotency-key'));
  if (!chave) return falha(res, 400, 'INVALID_INPUT', 'Informe a chave de idempotência.');
  if (!objeto(req.body) || !objeto(req.body.action) || typeof req.body.action.kind !== 'string') return falha(res, 400, 'INVALID_INPUT', 'Informe a ação.');
  if (!acoesLiberadas()) return falha(res, 403, 'LILLY_ACTIONS_DISABLED', 'As ações da Lilly estão desligadas.');
  return falha(res, 422, 'LILLY_ACTION_UNSUPPORTED', 'Esta ação ainda não está habilitada.');
}

function conciliarAcao(req, res) {
  const chave = normalizarChave(req.params.chave);
  if (!chave) return falha(res, 400, 'INVALID_INPUT', 'Informe a chave de idempotência.');
  return sucesso(res, { committed: false, state: 'not_executed' });
}

function notasDoHorario(req, res) {
  const { tarologistId, date } = req.query;
  if (typeof tarologistId !== 'string' || !tarologistId.trim() || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return falha(res, 400, 'INVALID_INPUT', 'Informe o tarólogo e a data (AAAA-MM-DD).');
  }
  return sucesso(res, { notes: [] });
}

module.exports = { contexto, resolverEvento, validarAcao, executarAcao, conciliarAcao, notasDoHorario };
