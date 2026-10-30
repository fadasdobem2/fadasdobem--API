'use strict';

const crypto = require('crypto');
const { getRedisConnection } = require('./redis.connection');

/** Lua: só apaga a chave se o token ainda for nosso (compare-and-del, evita libertar lock alheio). */
const RELEASE_LUA =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

function resolveClient() {
  const c = getRedisConnection();
  return c && c !== false ? c : null;
}

/**
 * Executa `fn` sob um lock distribuído (Redis `SET NX PX`).
 *
 * Semântica pensada para tarefas sensíveis (ex.: cobrança) em N instâncias:
 *  - **Redis não configurado** (`getRedisConnection()` → `false`/`null`): assume-se
 *    instância única e `fn` roda direto (`ran: true`).
 *  - **Lock obtido**: roda `fn` e liberta no fim (CAS por token).
 *  - **Lock ocupado por outra instância**: NÃO roda (`ran: false, skipped: true`).
 *  - **Erro no Redis ao adquirir**: NÃO roda (`ran: false, error`). Escolha conservadora —
 *    é preferível pausar a tarefa a arriscar execução concorrente (ex.: cobrança dupla)
 *    durante uma indisponibilidade do Redis.
 *
 * @param {string} key  identificador lógico do lock (sem prefixo).
 * @param {number} ttlMs  validade do lock (deve cobrir a duração máxima de `fn`).
 * @param {() => Promise<any>} fn
 * @returns {Promise<{ ran: boolean, skipped?: boolean, error?: Error, result?: any }>}
 */
async function withDistributedLock(key, ttlMs, fn) {
  const redis = resolveClient();
  if (!redis) {
    const result = await fn();
    return { ran: true, result };
  }

  const lockKey = `lock:${key}`;
  const token = crypto.randomBytes(16).toString('hex');
  const ttl = Number(ttlMs) > 0 ? Math.floor(Number(ttlMs)) : 30000;

  let acquired = false;
  try {
    const res = await redis.set(lockKey, token, 'NX', 'PX', ttl);
    acquired = res === 'OK';
  } catch (err) {
    console.warn(`[dist-lock] falha ao adquirir '${lockKey}' — tarefa pausada neste tick:`, err?.message || err);
    return { ran: false, error: err instanceof Error ? err : new Error(String(err)) };
  }

  if (!acquired) return { ran: false, skipped: true };

  try {
    const result = await fn();
    return { ran: true, result };
  } finally {
    try {
      await redis.eval(RELEASE_LUA, 1, lockKey, token);
    } catch (err) {
      // TTL garante que o lock expira mesmo se o release falhar.
      console.warn(`[dist-lock] falha ao libertar '${lockKey}':`, err?.message || err);
    }
  }
}

module.exports = { withDistributedLock };
