'use strict';

const jwt = require('jsonwebtoken');
const { jwtVerifyOptions } = require('../../config/auth.config');
const { getRedisConnection } = require('../redis/redis.connection');

/** Namespace canónico Socket.io montado sobre o mesmo servidor HTTP Express. */
const ROOM_PREFIX_SPECIALIST_QUEUE = 'specialist_queue:';

/** @type {import('socket.io').Server|null} */
let io = null;
/** Clientes Redis dedicados do adapter (para fechar no shutdown). */
let adapterPubClient = null;
let adapterSubClient = null;

function specialistQueueRoom(specialistId) {
  return `${ROOM_PREFIX_SPECIALIST_QUEUE}${specialistId}`;
}

/**
 * Extrai Bearer do handshake (`auth.token` ou header `authorization`).
 */
function resolveHandshakeJwt(socket) {
  const rawAuth = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof rawAuth === 'string' && rawAuth.trim()) {
    return rawAuth.trim().replace(/^Bearer\s+/i, '');
  }
  const header =
    socket.handshake.headers.authorization || socket.handshake.headers.Authorization;
  if (!header || typeof header !== 'string') return '';
  const [scheme, token] = header.split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return '';
  return token.trim();
}

/**
 * Liga o adapter Redis do Socket.io. Sem ele, uma emissão (`queue_updated`,
 * `turn_started`) só chega aos sockets ligados À MESMA instância — no scale-out
 * o realtime quebra silenciosamente para quem estiver noutra instância.
 * O adapter faz a fan-out via pub/sub Redis para todas as instâncias.
 *
 * Sem Redis configurado → mantém o adapter in-memory (ok p/ instância única).
 * @param {import('socket.io').Server} ioServer
 */
function attachRedisAdapter(ioServer) {
  const base = getRedisConnection();
  if (!base || base === false) {
    console.log('[socket] Redis ausente — adapter in-memory (ok p/ instância única).');
    return;
  }
  try {
    // eslint-disable-next-line global-require
    const { createAdapter } = require('@socket.io/redis-adapter');
    // Pub/sub precisa enfileirar comandos até conectar (o cliente partilhado tem a fila offline desligada).
    const pubClient = base.duplicate({ enableOfflineQueue: true });
    const subClient = base.duplicate({ enableOfflineQueue: true });
    pubClient.on('error', (e) => console.warn('[socket] pubClient erro:', e?.message || e));
    subClient.on('error', (e) => console.warn('[socket] subClient erro:', e?.message || e));
    ioServer.adapter(createAdapter(pubClient, subClient));
    adapterPubClient = pubClient;
    adapterSubClient = subClient;
    console.log('[socket] Redis adapter ativo (realtime multi-instância).');
  } catch (err) {
    console.warn('[socket] Falha ao ativar Redis adapter, seguindo in-memory:', err?.message || err);
  }
}

/**
 * @param {import('http').Server} httpServer
 */
function initSocketGateway(httpServer) {
  if (io) {
    console.warn('[socket] initSocketGateway ignorado — instância já existente.');
    return io;
  }

  const { Server } = require('socket.io');
  const corsOrigin =
    process.env.SOCKET_CORS_ORIGIN ||
    process.env.CORS_ORIGIN ||
    '*';

  io = new Server(httpServer, {
    cors: {
      origin: corsOrigin === '*' ? true : corsOrigin.split(',').map((s) => s.trim()),
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  attachRedisAdapter(io);

  io.use((socket, next) => {
    try {
      const raw = resolveHandshakeJwt(socket);
      if (!raw) {
        return next(new Error('AUTH_TOKEN_MISSING'));
      }
      const payload = jwt.verify(raw, process.env.JWT_SECRET, jwtVerifyOptions());
      if (payload.token_use !== 'access') {
        return next(new Error('AUTH_WRONG_TOKEN_KIND'));
      }
      socket.userId = payload.sub;
      socket.specialistRooms = new Set();
      return next();
    } catch (_e) {
      return next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    socket.emit('authenticated', {
      user_id: socket.userId,
      message: 'Ligado ao gateway em tempo real.',
    });

    socket.on('subscribe_specialist_queue', (specialistId) => {
      const sid = `${specialistId ?? ''}`.trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sid)) {
        socket.emit('error', { code: 'INVALID_SPECIALIST_ID' });
        return;
      }
      const room = specialistQueueRoom(sid);
      socket.join(room);
      socket.specialistRooms.add(room);
      socket.emit('subscribed_specialist_queue', { specialist_id: sid, room });
    });

    socket.on('unsubscribe_specialist_queue', (specialistId) => {
      const sid = `${specialistId ?? ''}`.trim();
      const room = specialistQueueRoom(sid);
      socket.leave(room);
      socket.specialistRooms.delete(room);
    });

    socket.on('disconnect', () => {
      socket.specialistRooms?.clear();
    });
  });

  console.log('[socket] Gateway Socket.io inicializado (JWT no handshake).');
  return io;
}

function getIo() {
  return io;
}

/** Shutdown gracioso: fecha o servidor Socket.io e os clientes Redis dedicados do adapter. */
async function shutdownSocketGateway() {
  if (io) {
    try {
      await new Promise((resolve) => io.close(() => resolve()));
    } catch {
      /* noop */
    }
    io = null;
  }
  for (const client of [adapterPubClient, adapterSubClient]) {
    if (!client) continue;
    try {
      await client.quit();
    } catch {
      try {
        client.disconnect();
      } catch {
        /* noop */
      }
    }
  }
  adapterPubClient = null;
  adapterSubClient = null;
}

/**
 * Actualiza todas as vistas inscritas na room da taróloga (painel público/app).
 */
function emitQueueUpdate(specialistId, queueData = {}) {
  if (!io) return;
  const room = specialistQueueRoom(specialistId);
  io.to(room).emit('queue_updated', queueData);
}

function emitTurnStarted(specialistId, payload = {}) {
  if (!io) return;
  const room = specialistQueueRoom(specialistId);
  io.to(room).emit('turn_started', payload);
}

module.exports = {
  initSocketGateway,
  shutdownSocketGateway,
  getIo,
  specialistQueueRoom,
  emitQueueUpdate,
  emitTurnStarted,
};
