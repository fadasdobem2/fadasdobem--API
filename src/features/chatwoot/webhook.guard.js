'use strict';

/**
 * Peças comuns de autenticação de webhooks (Chatwoot e Agora NCS):
 *  - comparação em tempo constante e HMAC;
 *  - corpo bruto (req.rawBody, com fallback para re-serialização do JSON);
 *  - "visto uma vez" (replay e idempotência) em Redis quando existir, com fallback em memória do processo;
 *  - contador com expiração (teto diário).
 * Nenhum segredo, assinatura ou corpo é escrito em log.
 */

const crypto = require('crypto');

/** Memória do processo: usada só quando não há Redis (ou o Redis falha). Em multi-processo é parcial. */
const memoria = new Map();
const MEMORIA_MAX = 20000;

/** Cliente Redis injetável para teste; undefined = usa o compartilhado da API. */
let redisInjetado;

function redis() {
  if (redisInjetado !== undefined) return redisInjetado;
  try {
    // eslint-disable-next-line global-require
    const c = require('../../providers/redis/redis.connection').getRedisConnection();
    return c && c !== false ? c : null;
  } catch {
    return null;
  }
}

function _setRedisParaTeste(cliente) {
  redisInjetado = cliente;
}

function _limparMemoriaParaTeste() {
  memoria.clear();
}

function podarMemoria(agora) {
  if (memoria.size < MEMORIA_MAX) return;
  for (const [k, v] of memoria) {
    if (v.exp <= agora) memoria.delete(k);
  }
  // Ainda cheio: descarta as mais antigas (ordem de inserção).
  while (memoria.size >= MEMORIA_MAX) {
    memoria.delete(memoria.keys().next().value);
  }
}

/**
 * Reivindica a chave. true = primeira vez (pode processar); false = já vista.
 * Falha de Redis cai para a memória (nunca para "aceitar sempre").
 */
async function claimOnce(key, ttlSegundos) {
  const cli = redis();
  if (cli) {
    try {
      const r = await cli.set(`wh:${key}`, '1', 'EX', Math.max(1, Math.floor(ttlSegundos)), 'NX');
      return r === 'OK';
    } catch {
      // cai para memória
    }
  }
  const agora = Date.now();
  const atual = memoria.get(key);
  if (atual && atual.exp > agora) return false;
  podarMemoria(agora);
  memoria.set(key, { exp: agora + ttlSegundos * 1000, n: 0 });
  return true;
}

/** Libera uma chave reivindicada (operação falhou e pode ser repetida). */
async function releaseClaim(key) {
  const cli = redis();
  if (cli) {
    try {
      await cli.del(`wh:${key}`);
    } catch {
      // segue para memória
    }
  }
  memoria.delete(key);
}

/**
 * Soma `valor` ao contador `key` (janela `ttlSegundos` desde a primeira soma) e devolve o novo total.
 * Valor negativo desfaz uma reserva.
 */
async function addToCounter(key, valor, ttlSegundos) {
  const cli = redis();
  if (cli) {
    try {
      const k = `whc:${key}`;
      const total = Number(await cli.incrbyfloat(k, valor));
      if ((await cli.ttl(k)) < 0) await cli.expire(k, Math.floor(ttlSegundos));
      return total;
    } catch {
      // cai para memória
    }
  }
  const agora = Date.now();
  let atual = memoria.get(`c:${key}`);
  if (!atual || atual.exp <= agora) {
    podarMemoria(agora);
    atual = { exp: agora + ttlSegundos * 1000, n: 0 };
  }
  atual.n = Math.round((atual.n + valor) * 10000) / 10000;
  memoria.set(`c:${key}`, atual);
  return atual.n;
}

/** Comparação em tempo constante de duas strings quaisquer (hash antes: tamanhos iguais, sem vazar o comprimento). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a ?? ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b ?? ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function hmacHex(algoritmo, segredo, dados) {
  return crypto.createHmac(algoritmo, segredo).update(dados).digest('hex');
}

/** Corpo bruto exato que o remetente assinou. Sem `req.rawBody`, re-serializa o JSON (só confere se o formato coincidir). */
function getRawBody(req) {
  if (Buffer.isBuffer(req.rawBody)) return req.rawBody;
  if (typeof req.rawBody === 'string') return Buffer.from(req.rawBody, 'utf8');
  try {
    return Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
  } catch {
    return Buffer.alloc(0);
  }
}

function envTrue(nome) {
  return ['true', '1', 'yes'].includes(`${process.env[nome] || ''}`.trim().toLowerCase());
}

function envInt(nome, padrao) {
  const n = Number.parseInt(`${process.env[nome] || ''}`.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

/** Bypass explícito de verificação: nunca em produção, mesmo com o flag ligado. */
function bypassPermitido(nomeFlag) {
  if (!envTrue(nomeFlag)) return false;
  return `${process.env.NODE_ENV || ''}`.trim().toLowerCase() !== 'production';
}

module.exports = {
  claimOnce,
  releaseClaim,
  addToCounter,
  safeEqual,
  hmacHex,
  getRawBody,
  envTrue,
  envInt,
  bypassPermitido,
  _setRedisParaTeste,
  _limparMemoriaParaTeste,
};
