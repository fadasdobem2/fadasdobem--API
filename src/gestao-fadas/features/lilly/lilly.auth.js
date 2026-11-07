'use strict';

/**
 * Autenticação do serviço Lilly: `Authorization: Bearer <LILLY_SERVICE_TOKEN>`, comparação em tempo constante (fail closed).
 * Sem token configurado (ou curto demais) a rota responde 503; credencial ausente ou errada, 401. Nunca registra o token.
 * Este token NÃO é uma sessão de usuária: só abre as rotas `/lilly/*`.
 */

const { createHash, timingSafeEqual } = require('crypto');
const { tokenDeServico, TOKEN_MINIMO } = require('./lilly.config');
const { falha } = require('./lilly.respostas');

const digest = (texto) => createHash('sha256').update(texto, 'utf8').digest();

function credencialDe(req) {
  const cabecalho = `${req.get('authorization') || ''}`.trim();
  const partes = /^Bearer\s+(\S+)$/i.exec(cabecalho);
  return partes ? partes[1] : '';
}

function exigirTokenDeServico(req, res, next) {
  const esperado = tokenDeServico();
  if (esperado.length < TOKEN_MINIMO) {
    console.error('[lilly:auth] LILLY_SERVICE_TOKEN ausente ou curto: rotas bloqueadas.');
    return falha(res, 503, 'LILLY_NOT_CONFIGURED', 'Integração Lilly não configurada.');
  }
  const enviado = credencialDe(req);
  if (enviado && timingSafeEqual(digest(enviado), digest(esperado))) return next();
  console.warn('[lilly:auth] recusado (credencial ausente ou invalida)');
  return falha(res, 401, 'LILLY_UNAUTHORIZED', 'Credencial inválida.');
}

module.exports = { exigirTokenDeServico, credencialDe };
