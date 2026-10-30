const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const { responderErro } = require('../utils/response.util');
const { normalizeEmail } = require('../features/auth/auth.constants');
const { tryNormalizeMobilePhone } = require('../features/auth/auth.phone.helper');
const { getRedisConnection } = require('../providers/redis/redis.connection');

/**
 * Store partilhado por instância. Sem `store`, o express-rate-limit usa `MemoryStore`,
 * cujo contador vive só neste processo — com N instâncias o limite fica N× mais frouxo
 * (proteção anti-brute-force furada). Com Redis, o contador é global ao cluster.
 *
 * Cada limiter recebe o SEU próprio `RedisStore` (o store guarda o `windowMs` no `init`)
 * e um `prefix` distinto para isolar os espaços de chave.
 *
 * Sem Redis configurado → devolve `undefined` e cai no `MemoryStore` (ok p/ instância única).
 * @param {string} prefix
 * @returns {import('express-rate-limit').Store | undefined}
 */
// Uma espera por cliente (evita um ouvinte por store).
const prontoPorCliente = new WeakMap();

function buildRateLimitStore(prefix) {
  const client = getRedisConnection();
  if (!client || client === false) return undefined;
  // O cliente partilhado tem a fila offline desligada: um comando antes da conexão falha e, no `new RedisStore`
  // (que carrega o script na construção), derrubava a API na subida. Aqui o comando espera o Redis ficar pronto.
  const pronto = () => {
    if (client.status === 'ready') return Promise.resolve();
    if (!prontoPorCliente.has(client)) {
      prontoPorCliente.set(client, new Promise((resolve, reject) => {
        client.once('ready', resolve);
        client.once('end', () => reject(new Error('Redis encerrado antes de ficar pronto')));
      }));
    }
    return prontoPorCliente.get(client);
  };
  return new RedisStore({
    prefix,
    sendCommand: async (...args) => {
      await pronto();
      return client.call(...args);
    },
  });
}

const FIFTEEN_MIN_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_IP = 5;
const MAX_ATTEMPTS_PER_EMAIL = 10;
const REGISTER_MAX_PER_IP_PER_DAY = 3;
const FORGOT_MAX_PER_EMAIL_PER_HOUR = 3;
const FORGOT_MAX_PER_IP_PER_DAY = 10;
const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function rateLimitHandler(options) {
  return (req, res, _next, rlOptions) => {
    const retrySeconds = Math.ceil(rlOptions.windowMs / 1000);
    return responderErro(
      res,
      429,
      'Limite de tentativas atingido. Aguarde antes de tentar novamente.',
      {
        codigo: 'RATE_LIMIT_AUTH',
        retry_after_seconds: retrySeconds,
      }
    );
  };
}

/** Homologação / staging: desativar com `AUTH_RATE_LIMIT_DISABLED=true` no `.env` (evita 429 ao alternar cliente/taróloga). */
function skipAuthRateLimit() {
  const v = `${process.env.AUTH_RATE_LIMIT_DISABLED || ''}`.trim().toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Login / cadastro por IP — 5 / 15 min (R10).
 */
const loginRegisterIpLimiter = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  max: MAX_ATTEMPTS_PER_IP,
  store: buildRateLimitStore('rl:login-ip:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  skip: skipAuthRateLimit,
  keyGenerator(req) {
    return `auth-ip:${req.ip || 'unknown'}`;
  },
  handler: rateLimitHandler(),
});

/**
 * Login por e-mail normalizado — 10 / 15 min (R10).
 */
const loginEmailLimiter = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  max: MAX_ATTEMPTS_PER_EMAIL,
  store: buildRateLimitStore('rl:login-email:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  skip: skipAuthRateLimit,
  keyGenerator(req) {
    const e = normalizeEmail(req.body?.email).trim();
    return e ? `auth-email:${e}` : `auth-email:fallback:${req.ip || ''}`;
  },
  handler: rateLimitHandler(),
});

/** Cadastro: 3 contas novas por dia por origem IP (R10). */
const registerDailyIpLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  max: REGISTER_MAX_PER_IP_PER_DAY,
  store: buildRateLimitStore('rl:reg-day-ip:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  keyGenerator(req) {
    return `reg-day-ip:${req.ip || 'unknown'}`;
  },
  handler: rateLimitHandler(),
});

/** Cadastro: mesmo eixo e-mail que login quando body tem email — 10/15min (R10 por e-mail nas tentativas de auth). */
const registerEmailLimiter = loginEmailLimiter;

/**
 * Esqueci senha por e-mail normalizado — 3 / hora (R10 / R6).
 */
const forgotPasswordEmailHourLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  max: FORGOT_MAX_PER_EMAIL_PER_HOUR,
  store: buildRateLimitStore('rl:forgot-email-h:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  keyGenerator(req) {
    const e = normalizeEmail(req.body?.email).trim();
    return e ? `forgot-email-h:${e}` : `forgot-email-h:fallback:${req.ip}`;
  },
  handler: rateLimitHandler(),
});

/**
 * Esqueci senha por telefone normalizado — 3 / hora.
 */
const forgotPasswordPhoneHourLimiter = rateLimit({
  windowMs: ONE_HOUR_MS,
  max: FORGOT_MAX_PER_EMAIL_PER_HOUR,
  store: buildRateLimitStore('rl:forgot-phone-h:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  keyGenerator(req) {
    const raw = `${req.body?.phone ?? req.body?.whatsapp ?? req.body?.celular ?? ''}`.trim();
    const digits = raw ? tryNormalizeMobilePhone(raw) : null;
    return digits ? `forgot-phone-h:${digits}` : `forgot-phone-h:fallback:${req.ip}`;
  },
  handler: rateLimitHandler(),
});

/**
 * Esqueci senha por origem — 10 / dia (R10).
 */
const forgotPasswordIpDayLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  max: FORGOT_MAX_PER_IP_PER_DAY,
  store: buildRateLimitStore('rl:forgot-day-ip:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  keyGenerator(req) {
    return `forgot-day-ip:${req.ip || 'unknown'}`;
  },
  handler: rateLimitHandler(),
});

/** Trabalhe Conosco — F1 oraculista + vagas (IP, 15 min). */
const trabalheConoscoIpLimiter = rateLimit({
  windowMs: FIFTEEN_MIN_MS,
  max: 20,
  store: buildRateLimitStore('rl:tc-ip:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  skip: skipAuthRateLimit,
  keyGenerator(req) {
    return `tc-ip:${req.ip || 'unknown'}`;
  },
  handler: rateLimitHandler(),
});

/** Trabalhe Conosco — máx. submissões por IP / dia. */
const trabalheConoscoDailyIpLimiter = rateLimit({
  windowMs: ONE_DAY_MS,
  max: 10,
  store: buildRateLimitStore('rl:tc-day-ip:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: false,
  skip: skipAuthRateLimit,
  keyGenerator(req) {
    return `tc-day-ip:${req.ip || 'unknown'}`;
  },
  handler: rateLimitHandler(),
});

/** @deprecated usar loginRegisterIpLimiter — mantém export para compatibilidade */
const authCredentialsLimiter = loginRegisterIpLimiter;

module.exports = {
  authCredentialsLimiter,
  loginRegisterIpLimiter,
  loginEmailLimiter,
  registerDailyIpLimiter,
  registerEmailLimiter,
  forgotPasswordEmailHourLimiter,
  forgotPasswordPhoneHourLimiter,
  forgotPasswordIpDayLimiter,
  trabalheConoscoIpLimiter,
  trabalheConoscoDailyIpLimiter,
  FIFTEEN_MIN_MS,
  MAX_ATTEMPTS_PER_IP,
};
