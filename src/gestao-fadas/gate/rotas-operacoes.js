'use strict';

/**
 * Leituras `/operations/*` e `/payouts/*` do gate. Cada rota segue a ORDEM do guarda da B (`guardRealRoute`):
 *   método (405 + Allow) -> sessão (401/403/503) -> permissão do perfil (403) -> parâmetros (400) -> leitura (503 se falhar).
 * A regra de negócio NÃO é reescrita: os controllers de `features/**` já devolvem o DTO da B dentro do envelope da A
 * (`{sucesso, mensagem, dados}`); aqui o envelope é removido (a B responde o DTO puro) e os erros viram o formato da B.
 * Rotas da B -> controllers da A:
 *   operations/clients[/:id[/consultations|/receipts]] -> clientes; operations/consultations -> consultas;
 *   operations/receipts[/undated] -> pagamentos; operations/tarologists -> tarologos; payouts/* -> repasse.
 */

const { Router } = require('express');
const { exigirCapacidade } = require('../_comum/politica-acesso');
const clientes = require('../features/clientes/clientes.controller');
const consultas = require('../features/consultas/consultas.controller');
const pagamentos = require('../features/pagamentos/pagamentos.controller');
const tarologos = require('../features/tarologos/tarologos.controller');
const repasse = require('../features/repasse/repasse.controller');
const { enviarJson, enviarErro, metodoNaoPermitido, responderFalha } = require('./http');
const { aplicarContexto } = require('./contexto');

/** Resposta da A `{sucesso:true, dados}` vira o DTO puro da B; cabeçalhos `no-store`, sem ETag. */
function desembrulhar(res) {
  res.json = (corpo) => enviarJson(res, res.statusCode || 200, corpo && corpo.sucesso === true && 'dados' in corpo ? corpo.dados : corpo);
}

/** Sessão: 401 SESSION_REQUIRED/SESSION_INVALID, 403 ACCOUNT_ACCESS_UNAVAILABLE, 503 (como `sessionResponse` da B). */
function autenticar(provedor) {
  return async (req, res, next) => {
    let r;
    try { r = await provedor.validar(req); } catch (_e) { r = { status: 'unavailable' }; }
    if (r.status === 'absent') return enviarErro(res, 'SESSION_REQUIRED');
    if (r.status === 'invalid') return enviarErro(res, 'SESSION_INVALID');
    if (r.status === 'access-unavailable') return enviarErro(res, 'ACCOUNT_ACCESS_UNAVAILABLE');
    if (r.status !== 'identity') return enviarErro(res, 'SERVICE_UNAVAILABLE');
    try { aplicarContexto(req, r); } catch (e) { return responderFalha(res, e); }
    return next();
  };
}

/**
 * Registra uma rota com a cadeia da B. `capacidade` (opcional) é a de `permissions.ts`; `escrita` troca as mensagens de
 * recusa; `preparar(req)` ajusta o request ao controller (nomes de parâmetro) antes da leitura.
 */
function registrar(router, provedor, { metodo = 'GET', caminho, capacidade, escrita = false, preparar, handler, porMetodo = false }) {
  const cadeia = [
    (req, res, next) => (req.method === metodo ? next() : porMetodo ? next('route') : metodoNaoPermitido(res, metodo)),
    autenticar(provedor),
    ...(capacidade ? [exigirCapacidade(capacidade, { escrita })] : []),
    (req, res, next) => { res.locals.gateEscrita = escrita; desembrulhar(res); if (preparar) preparar(req); next(); },
    handler,
  ];
  router[porMetodo ? metodo.toLowerCase() : 'all'](caminho, ...cadeia);
}

/** `canReadRealOperations` (consultas, recebimentos, tarólogos) e `canManagePayouts` (repasse) valem os mesmos perfis. */
const OPERACOES = 'canReadRealOperations';

function criarRotasOperacoes(provedor, extras = []) {
  const router = Router();
  const rota = (def) => registrar(router, provedor, def);

  // Extensão: exportações e escritas ligadas por outros módulos (ver ./rotas-extras.js). Vêm antes para poderem ter
  // o mesmo caminho de uma leitura com outro método.
  for (const ex of extras) {
    const metodo = String(ex.metodo || 'GET').toUpperCase();
    router[metodo.toLowerCase()](ex.caminho, autenticar(provedor),
      ...(ex.capacidade ? [exigirCapacidade(ex.capacidade, { escrita: Boolean(ex.escrita) })] : []),
      (req, res, next) => { res.locals.gateEscrita = Boolean(ex.escrita); desembrulhar(res); next(); }, ex.handler);
  }

  // Clientes: o controller confere `canReadRealClients` e o recorte do perfil (403 ACCESS_DENIED), na ordem da B.
  rota({ caminho: '/operations/clients', handler: clientes.listar });
  rota({ caminho: '/operations/clients/:id', handler: clientes.obter });
  rota({ caminho: '/operations/clients/:id/consultations', handler: clientes.consultas });
  rota({ caminho: '/operations/clients/:id/receipts', handler: clientes.recebimentos });

  rota({ caminho: '/operations/consultations', capacidade: OPERACOES, handler: consultas.listar });
  rota({ caminho: '/operations/receipts/undated', capacidade: OPERACOES, handler: pagamentos.listarSemDataPaga });
  rota({ caminho: '/operations/receipts', capacidade: OPERACOES, handler: pagamentos.listar });
  rota({
    caminho: '/operations/tarologists', capacidade: OPERACOES, handler: tarologos.listar,
    // A B não aceita parâmetro aqui; a A aceita `?incluir=extensao`, que não faz parte do contrato do front.
    preparar: (req) => { req.query = {}; },
  });

  // Repasse: na B só `canManagePayouts`; a mensagem de 400 do segmento é a de gravação (`invalidInput` de real-payouts).
  rota({
    caminho: '/payouts/agreements/:tarotId', capacidade: OPERACOES, escrita: true, handler: repasse.acordo,
    preparar: (req) => { req.params = { ...req.params, id: req.params.tarotId }; },
  });
  rota({
    caminho: '/payouts/openings/:ref', capacidade: OPERACOES, escrita: true, handler: repasse.aberturas,
    preparar: (req) => { req.params = { ...req.params, id: req.params.ref }; },
  });

  // Tudo que falhar depois da sessão: formato da B (400/403/404 com código, o resto 503 sem detalhe).
  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    return responderFalha(res, err, { escrita: Boolean(res.locals && res.locals.gateEscrita) });
  });
  return router;
}

module.exports = { criarRotasOperacoes, autenticar, desembrulhar, registrar };
