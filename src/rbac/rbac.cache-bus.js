'use strict';

const crypto = require('crypto');
const { getRedisConnection } = require('../providers/redis/redis.connection');

/**
 * Barramento de invalidação de cache RBAC entre instâncias.
 *
 * O `authorization.service` mantém um cache LOCAL (Map, TTL curto) por performance.
 * Numa única instância isso basta. Em N instâncias, mudar um papel/permissão só
 * limpava o cache de UMA instância — as outras serviam decisão de autorização
 * obsoleta por até ao TTL (problema de correção/segurança, não só de performance).
 *
 * Solução: quando uma instância invalida, publica no canal Redis; TODAS as instâncias
 * (incluindo esta) recebem e limpam o cache local imediatamente. Sem Redis configurado,
 * o bus é no-op e o comportamento é o de instância única.
 */
const CHANNEL = 'rbac:cache:invalidate';
const INSTANCE_ID = crypto.randomBytes(8).toString('hex');

let started = false;
let pub = null;
let sub = null;
/** @type {{ onUser?: (id: string) => void, onAll?: () => void }} */
let handlers = {};

function resolveClient() {
  const c = getRedisConnection();
  return c && c !== false ? c : null;
}

/**
 * Liga o subscriber e regista os callbacks de limpeza LOCAL.
 * Idempotente. Deve ser chamado uma vez no arranque do módulo RBAC.
 * @param {{ onUser?: (id: string) => void, onAll?: () => void }} h
 */
function startRbacCacheBus(h) {
  handlers = h || {};
  if (started) return;
  started = true;

  const base = resolveClient();
  if (!base) return; // sem Redis → só cache local (instância única)

  try {
    pub = base;
    // O subscriber precisa enfileirar o SUBSCRIBE até conectar (o cliente partilhado tem a fila offline desligada).
    sub = base.duplicate({ enableOfflineQueue: true });

    sub.on('error', (err) => console.warn('[rbac:cache-bus] sub erro:', err?.message || err));
    sub.subscribe(CHANNEL, (err) => {
      if (err) {
        console.warn('[rbac:cache-bus] subscribe falhou:', err.message);
        return;
      }
      console.log('[rbac:cache-bus] invalidação cross-instância ativa (Redis pub/sub).');
    });

    sub.on('message', (chan, raw) => {
      if (chan !== CHANNEL) return;
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (!msg || msg.origin === INSTANCE_ID) return; // já limpámos localmente no publish
      if (msg.t === 'all') handlers.onAll?.();
      else if (msg.t === 'user' && msg.id) handlers.onUser?.(msg.id);
    });
  } catch (err) {
    console.warn('[rbac:cache-bus] init falhou, seguindo só com cache local:', err?.message || err);
    pub = null;
    sub = null;
  }
}

function publish(payload) {
  if (!pub) return;
  try {
    pub.publish(CHANNEL, JSON.stringify({ ...payload, origin: INSTANCE_ID }));
  } catch (err) {
    console.warn('[rbac:cache-bus] publish falhou:', err?.message || err);
  }
}

function publishInvalidateUser(userId) {
  const id = `${userId || ''}`.trim();
  if (id) publish({ t: 'user', id });
}

function publishInvalidateAll() {
  publish({ t: 'all' });
}

/** Fecha o subscriber dedicado (shutdown gracioso). `pub` é o cliente partilhado (fecha em closeSharedRedis). */
async function stopRbacCacheBus() {
  const s = sub;
  sub = null;
  pub = null;
  started = false;
  if (!s) return;
  try {
    await s.quit();
  } catch {
    try {
      s.disconnect();
    } catch {
      /* noop */
    }
  }
}

module.exports = {
  startRbacCacheBus,
  stopRbacCacheBus,
  publishInvalidateUser,
  publishInvalidateAll,
};
