'use strict';

/**
 * Regras da rota de Consultas, porte de `features/consultas/real-consultations-http.server.ts` e das regras de query de
 * `features/auth/real-access.server.ts` (B): `parseQuery`, `parseRealQuery`, `periodFields`, `TAROT_ID`, `PAGE`, `DAY`.
 *
 * Ordem das verificações da B: (1) permissão (aqui: o RBAC `consultas.ver`, antes do controller); (2) parâmetros;
 * (3) `end` não antes de `start` e no máximo 366 dias; (4) leitura; (5) página além da última. Todo parâmetro inválido
 * é 400 INVALID_INPUT; parâmetro repetido é inválido; parâmetro desconhecido é ignorado.
 */

const AppError = require('../../../../utils/AppError');
const { diaReal, periodoReal } = require('./periodo');
const { idLegadoTexto } = require('./leitura-legado');

const MENSAGEM_INVALID_INPUT = 'Confira o período e a página e tente novamente.';

function entradaInvalida() {
  return new AppError(MENSAGEM_INVALID_INPUT, 400, { codigo: 'INVALID_INPUT' });
}

// Cada validador devolve { ok, valor }.
const DIA = (texto) => (typeof texto === 'string' && diaReal(texto) ? { ok: true, valor: texto } : { ok: false });
const ID_TAROLOGO = (texto) => (typeof texto === 'string' && /^[1-9]\d*$/.test(texto) && idLegadoTexto(texto) !== null ? { ok: true, valor: texto } : { ok: false });
const PAGINA = (texto) => {
  if (typeof texto !== 'string' || !/^[1-9]\d*$/.test(texto)) return { ok: false };
  const n = Number(texto);
  return Number.isSafeInteger(n) ? { ok: true, valor: n } : { ok: false };
};

/**
 * `query` = `req.query` do Express. Devolve { start, end, tarotId?, page } ou lança INVALID_INPUT.
 * `start`/`end` padrão = `hoje` (dia operacional do servidor); `page` padrão 1.
 */
function lerQueryConsultas(query, hoje) {
  const q = query || {};
  const campos = [['start', DIA, hoje], ['end', DIA, hoje], ['tarotId', ID_TAROLOGO, undefined], ['page', PAGINA, 1]];
  const lido = {};
  for (const [nome, validar, padrao] of campos) {
    const dado = q[nome];
    // Parâmetro repetido (array) ou aninhado (objeto) é inválido: qual valer não é um palpite que valha a pena.
    if (dado === undefined) {
      if (padrao !== undefined) lido[nome] = padrao;
      continue;
    }
    const r = validar(dado);
    if (!r.ok) throw entradaInvalida();
    lido[nome] = r.valor;
  }
  if (!periodoReal(lido)) throw entradaInvalida();
  return lido;
}

module.exports = { MENSAGEM_INVALID_INPUT, entradaInvalida, lerQueryConsultas };
