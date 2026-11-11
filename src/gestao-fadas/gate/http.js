'use strict';

/**
 * Formato HTTP da API B (suspiro), em um lugar só. Porte de `features/auth/auth-http.server.ts` (jsonResponse,
 * errorResponse, ERRORS) e de `features/auth/real-access.server.ts` (operationsError).
 *
 * Regras da B copiadas aqui:
 *   - TODA resposta (sucesso ou erro) sai com `Cache-Control: no-store` e `Content-Type: application/json; charset=utf-8`;
 *   - o erro é `{ error: { code, message } }` com mensagens de produto em PT-BR;
 *   - sem ETag e sem `X-Powered-By` (o Express os poria sozinho; aqui o corpo é escrito com `res.end`).
 */

const AppError = require('../../utils/AppError');

/** Textos de produto da B (`features/auth/real-session.ts`). */
const COPIA = Object.freeze({
  SERVICE_UNAVAILABLE: 'Não foi possível acessar o serviço. Tente novamente.',
  SESSION_ENDED: 'Sua sessão expirou ou foi encerrada. Entre novamente.',
  NO_ACCESS: 'Sua conta ainda não pode acessar o sistema. Procure a administração.',
});

/** `ERRORS` de auth-http.server.ts: código -> [status, mensagem]. */
const ERROS = Object.freeze({
  INVALID_INPUT: [400, 'Confira o usuário e a senha informados e tente novamente.'],
  INVALID_CREDENTIALS: [401, 'Usuário ou senha incorretos.'],
  ORIGIN_NOT_ALLOWED: [403, 'Não foi possível confirmar a origem da solicitação. Recarregue a página e tente novamente.'],
  ACCOUNT_ACCESS_UNAVAILABLE: [403, COPIA.NO_ACCESS],
  NOT_FOUND: [404, 'Não encontrado.'],
  METHOD_NOT_ALLOWED: [405, 'Método não permitido.'],
  PAYLOAD_TOO_LARGE: [413, 'Os dados enviados são grandes demais.'],
  UNSUPPORTED_MEDIA_TYPE: [415, 'Formato de dados não aceito.'],
  TRY_LATER: [429, 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
  SESSION_REQUIRED: [401, 'Entre para continuar.'],
  SESSION_INVALID: [401, COPIA.SESSION_ENDED],
  SERVICE_UNAVAILABLE: [503, COPIA.SERVICE_UNAVAILABLE],
});

/** `ERRORS` de real-access.server.ts (rotas operacionais): o 400 fala do período e da página. */
const ERROS_OPERACAO = Object.freeze({
  INVALID_INPUT: [400, 'Confira o período e a página e tente novamente.'],
  ACCESS_DENIED: [403, 'Esta informação não está disponível para a sua função.'],
  CLIENT_NOT_FOUND: [404, 'Cadastro de cliente não encontrado.'],
});
/** `WRITE_MESSAGES`: as mesmas recusas em palavras de gravação (usadas pelas rotas de repasse para segmento inválido). */
const MENSAGENS_ESCRITA = Object.freeze({
  INVALID_INPUT: 'Confira os dados informados e tente novamente.',
  ACCESS_DENIED: 'Esta ação não está disponível para a sua função.',
  CLIENT_NOT_FOUND: ERROS_OPERACAO.CLIENT_NOT_FOUND[1],
});

/** Códigos de gravação do contrato 28 (Maturacao/28 seção 1.3); `RULE_VIOLATION` leva a mensagem do front, vinda do service. */
const ERROS_GRAVACAO = Object.freeze({
  VERSION_CHANGED: [409, 'Os dados mudaram desde que você abriu a tela. Atualize e tente novamente.'],
  OCCUPANCY_CONFLICT: [409, 'Há outra consulta aberta para esta cliente ou tarólogo. Encerre-a antes de iniciar outra.'],
  RULE_VIOLATION: [422, 'Confira os dados informados e tente novamente.'],
  WRITE_DISABLED: [503, 'Não foi possível acessar o serviço. Tente novamente.'],
});

/** Escreve JSON como a B: sem ETag, sem X-Powered-By, sempre `no-store`. */
function enviarJson(res, status, corpo, cabecalhos = {}) {
  res.removeHeader('X-Powered-By');
  res.status(status);
  res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cabecalhos });
  return res.end(JSON.stringify(corpo));
}

/** `errorResponse` da B (códigos de autenticação). */
function enviarErro(res, codigo, cabecalhos = {}) {
  const [status, message] = ERROS[codigo];
  return enviarJson(res, status, { error: { code: codigo, message } }, cabecalhos);
}

/** `operationsError` da B (INVALID_INPUT, ACCESS_DENIED, CLIENT_NOT_FOUND); `escrita` troca a mensagem. */
function enviarErroOperacao(res, codigo, escrita = false) {
  const [status, message] = ERROS_OPERACAO[codigo];
  return enviarJson(res, status, { error: { code: codigo, message: escrita ? MENSAGENS_ESCRITA[codigo] : message } });
}

/** 405 com `Allow`, como `acceptRoute` da B. */
function metodoNaoPermitido(res, permitido) {
  return enviarErro(res, 'METHOD_NOT_ALLOWED', { Allow: permitido });
}

/**
 * Traduz o que uma feature da A lançou para o erro da B. Os services lançam `AppError` com `dados.codigo`:
 *   - INVALID_INPUT / ACCESS_DENIED / CLIENT_NOT_FOUND: viram o mesmo código da B;
 *   - qualquer outro 400 (validação do service sem código) é INVALID_INPUT;
 *   - todo o resto (legado fora, tabela ausente, bug) é 503 SERVICE_UNAVAILABLE, sem detalhe: a B nunca devolve
 *     SQL, valor ou stack, e nunca uma resposta parcial.
 */
function responderFalha(res, err, { escrita = false } = {}) {
  const codigo = err instanceof AppError && err.dados && typeof err.dados === 'object' ? err.dados.codigo : null;
  if (codigo === 'CLIENT_DUPLICATE_REVIEW') return enviarJson(res, 409, { error: { code: codigo, message: err.message }, duplicateReview: err.dados.duplicateReview });
  if (codigo === 'NOT_FOUND') return enviarErro(res, 'NOT_FOUND');
  // `operationKeyConflict` da B (real-access.server.ts): mesma chave de operação com outro corpo.
  if (codigo === 'OPERATION_KEY_CONFLICT') {
    return enviarJson(res, 409, { error: { code: 'OPERATION_KEY_CONFLICT', message: 'Esta operação já foi registrada com outros dados. Atualize a página e confira.' } });
  }
  if (codigo && ERROS_GRAVACAO[codigo]) {
    const [status, padrao] = ERROS_GRAVACAO[codigo];
    return enviarJson(res, status, { error: { code: codigo, message: (codigo === 'RULE_VIOLATION' || (err.dados && err.dados.usarMensagem)) && err.message ? err.message : padrao } });
  }
  if (codigo && ERROS_OPERACAO[codigo]) return enviarErroOperacao(res, codigo, escrita);
  if (err instanceof AppError && err.statusCode === 400) return enviarErroOperacao(res, 'INVALID_INPUT', escrita);
  if (err instanceof AppError && err.statusCode === 401) return enviarErro(res, 'SESSION_INVALID');
  if (err instanceof AppError && err.statusCode === 403) return enviarErroOperacao(res, 'ACCESS_DENIED', escrita);
  if (err instanceof AppError && err.statusCode === 404) return enviarErroOperacao(res, 'CLIENT_NOT_FOUND', escrita);
  console.error(`[gate] indisponível: ${err instanceof AppError ? `${err.statusCode} ${(err.dados && err.dados.codigo) || ''}` : (err && err.name) || 'desconhecido'}`);
  return enviarErro(res, 'SERVICE_UNAVAILABLE');
}

module.exports = {
  COPIA, ERROS, ERROS_OPERACAO, ERROS_GRAVACAO, MENSAGENS_ESCRITA,
  enviarJson, enviarErro, enviarErroOperacao, metodoNaoPermitido, responderFalha,
};
