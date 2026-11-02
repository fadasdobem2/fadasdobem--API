const path = require('path');
const http = require('http');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');

const routes = require('./src/routes');
const { doubleCsrfProtection } = require('./src/middlewares/csrf.middleware');
const { sequelize } = require('./src/config/database');
const notFoundMiddleware = require('./src/middlewares/notFound.middleware');
const errorHandlerMiddleware = require('./src/middlewares/errorHandler.middleware');
const { responderSucesso } = require('./src/utils/response.util');
const { warmupAssistantsSilent } = require('./src/providers/openai/openai.setup');
const { API_VERSION_SEMVER } = require('./src/config/version');
/** Motor cronômetro 2+X+2 — varredura de saldo não pode derrubar o processo HTTP. */
const sessionChrono = require('./src/features/sessions/session.constants');
const sessionsService = require('./src/features/sessions/sessions.service');
const { runMigrations } = require('./scripts/run-migrations');
require('./src/models');

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3000;

function setupGracefulShutdown(httpServer) {
  let exiting = false;

  /** @param {NodeJS.Signals | string} signal */
  async function gracefulExit(signal) {
    if (exiting) return;
    exiting = true;

    console.log(`[lifecycle] Sinal ${signal} — iniciando shutdown gracioso (HTTP → BullMQ → BD).`);

    const envRaw = `${process.env.GRACEFUL_SHUTDOWN_MS || ''}`.trim();
    const parsedMs = envRaw ? Number.parseInt(envRaw, 10) : NaN;
    const maxMs = Number.isFinite(parsedMs)
      ? Math.min(Math.max(parsedMs, 5000), 120000)
      : 28000;

    const forceTimer = setTimeout(() => {
      console.error(`[lifecycle] Timeout ${maxMs}ms no shutdown — forçando process.exit(1).`);
      process.exit(1);
    }, maxMs);

    await new Promise((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    }).catch((err) => {
      console.warn('[lifecycle] server.close:', err?.message || err);
    });

    try {
      const { shutdownDeliveryMessaging } = require('./src/queues/delivery.queue');
      await shutdownDeliveryMessaging();
    } catch (e) {
      console.error('[lifecycle] shutdownDeliveryMessaging:', e?.stack || e);
    }

    try {
      const { shutdownSocketGateway } = require('./src/providers/socket/socket.gateway');
      await shutdownSocketGateway();
    } catch (e) {
      console.warn('[lifecycle] shutdownSocketGateway:', e?.message || e);
    }

    try {
      const { stopRbacCacheBus } = require('./src/rbac/rbac.cache-bus');
      await stopRbacCacheBus();
    } catch (e) {
      console.warn('[lifecycle] stopRbacCacheBus:', e?.message || e);
    }

    try {
      await sequelize.close();
    } catch (e) {
      console.warn('[lifecycle] sequelize.close:', e?.message || e);
    }

    /** Cliente Redis partilhado por último — usado por rate-limit, lock, mutex e cache-bus (pub). */
    try {
      const { closeSharedRedis } = require('./src/providers/redis/redis.connection');
      await closeSharedRedis();
    } catch (e) {
      console.warn('[lifecycle] closeSharedRedis:', e?.message || e);
    }

    clearTimeout(forceTimer);
    console.log('[lifecycle] Shutdown concluído.');
    process.exit(0);
  }

  process.once('SIGTERM', () => {
    gracefulExit('SIGTERM').catch((err) => {
      console.error('[lifecycle] erro em SIGTERM:', err?.stack || err);
      process.exit(1);
    });
  });
  process.once('SIGINT', () => {
    gracefulExit('SIGINT').catch((err) => {
      console.error('[lifecycle] erro em SIGINT:', err?.stack || err);
      process.exit(1);
    });
  });
}

setupGracefulShutdown(server);

const { initSocketGateway } = require('./src/providers/socket/socket.gateway');
initSocketGateway(server);

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', Number(process.env.TRUST_PROXY_COUNT) || 1);
}

app.use(helmet());

/**
 * CORS: NUNCA usar `*` em ambiente que aceita credenciais.
 * `CORS_ORIGINS` é uma lista separada por vírgula com os hosts permitidos.
 * Requisições sem `Origin` (curl, Postman, server-to-server) são liberadas;
 * o browser sempre envia Origin em chamadas cross-origin com credentials.
 */
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:3001')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      return cb(null, allowedOrigins.includes(origin));
    },
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    exposedHeaders: [],
  })
);

// `rawBody` guarda os bytes originais: a assinatura dos webhooks (Chatwoot, Agora) é calculada sobre eles.
const jsonGlobal = express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } });
// Lote de migração por planilha (Maturacao/55): o corpo passa de 1 MB, então o gate (limite próprio de 40 MB) lê esta rota sozinho.
app.use((req, res, next) => (req.method === 'POST' && req.path === '/api/migration/apply' && process.env.GESTAO_FADAS_ENABLED === 'true' && process.env.GF_FATIA_MIGRACAO === 'true' ? next() : jsonGlobal(req, res, next)));
app.use(cookieParser());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

/** Mini front estático (`public/agora-test.html`, `public/intelbras-test.html`, …) — mesma origem que `/api` evita CORS. */
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
/** Uploads de candidatas (contratos, fotos) — servidos estaticamente. */
app.use('/uploads/specialist-candidates', express.static(path.join(__dirname, 'uploads', 'specialist-candidates'), { index: false }));
app.use('/uploads/job-applications', express.static(path.join(__dirname, 'uploads', 'job-applications'), { index: false }));

/**
 * CSRF — Double Submit Cookie. Roda em TODA chamada de `/api/*` que altere estado
 * (POST/PUT/PATCH/DELETE). Webhooks externos (validados por assinatura própria)
 * são pulados via `skipCsrfProtection` em csrf.middleware.js.
 */
// Página de dados de teste do ambiente local (mostra a senha de teste): fora de produção e só com DADOS_TESTE_ENABLED=true.
{
  const { criarRotaDadosTeste, dadosTesteHabilitado } = require('./src/dev/dados-teste.routes');
  if (dadosTesteHabilitado()) app.use('/dados-teste', criarRotaDadosTeste());
}
// Gate do Gestão Fadas: fala o contrato HTTP da API B (front do suspiro). Tem a própria regra de origem/sessão,
// por isso entra antes do CSRF da A. Só com o módulo e o gate ligados.
if (process.env.GESTAO_FADAS_ENABLED === 'true' && process.env.GESTAO_FADAS_GATE_ENABLED === 'true') {
  require('./src/gestao-fadas/gate').montarGate(app);
}
app.use('/api', doubleCsrfProtection, routes);

app.get('/ping', (_req, res) => {
  return responderSucesso(
    res,
    { pong: true, versao: API_VERSION_SEMVER },
    'pong',
    200
  );
});

/** Snapshot do pool Sequelize (não bloqueante) — útil p/ diagnosticar saturação de conexões. */
function dbPoolSnapshot() {
  try {
    const p = sequelize.connectionManager?.pool;
    if (!p) return { disponivel: false };
    return {
      disponivel: true,
      size: p.size,
      em_uso: p.using,
      ociosas: p.available,
      aguardando: p.waiting,
      max: sequelize.options?.pool?.max ?? null,
      min: sequelize.options?.pool?.min ?? null,
    };
  } catch {
    return { disponivel: false };
  }
}

/** Estado do Redis partilhado (não bloqueante — lê `client.status` do ioredis). */
function redisSnapshot() {
  try {
    // eslint-disable-next-line global-require
    const { getRedisConnection } = require('./src/providers/redis/redis.connection');
    const client = getRedisConnection();
    if (client === false) return { configurado: false, motivo: 'ioredis_ausente' };
    if (!client) return { configurado: false, motivo: 'sem_env' };
    return { configurado: true, status: client.status || 'desconhecido' };
  } catch {
    return { configurado: false, motivo: 'erro' };
  }
}

app.get('/health', (_req, res) => {
  const anthropicApiKeyPresent = Boolean(
    process.env.ANTHROPIC_API_KEY && String(process.env.ANTHROPIC_API_KEY).trim()
  );
  return responderSucesso(
    res,
    {
      servico: 'fadasdobem-api',
      versao: API_VERSION_SEMVER,
      porta: Number(port),
      anthropic_api_key_configurada: anthropicApiKeyPresent,
      banco: { pool: dbPoolSnapshot() },
      redis: redisSnapshot(),
    },
    'API disponível.',
    200
  );
});

/**
 * Raiz — health checks de plataforma costumam usar GET / sem path.
 * Evita 404 ruidoso no errorHandler.
 */
app.get('/', (_req, res) => {
  return responderSucesso(
    res,
    {
      servico: 'fadasdobem-api',
      versao: API_VERSION_SEMVER,
      porta: Number(port),
      documentacao_raiz: { health: '/health', ping: '/ping', api: '/api/v1/health' },
    },
    'API no ar. Use /health ou /ping para probes.',
    200
  );
});

/** Browsers pedem favicon por defeito — resposta vazia evita erro 404 nos logs. */
app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

app.use(notFoundMiddleware);
app.use(errorHandlerMiddleware);

async function start() {
  try {
    await sequelize.authenticate();
    try {
      await runMigrations();
    } catch (migrationErr) {
      if (
        process.env.NODE_ENV === 'development' &&
        `${process.env.SKIP_MIGRATIONS_ON_FAILURE || ''}`.trim().toLowerCase() === 'true'
      ) {
        console.warn(
          '[migrations] falha ignorada em dev (SKIP_MIGRATIONS_ON_FAILURE=true):',
          migrationErr?.message || migrationErr
        );
      } else {
        throw migrationErr;
      }
    }

    const billingMs = Math.max(Number(sessionChrono.BILLING_TICK_INTERVAL_MS) || 10000, 1000);
    /** TTL do lock ≥ 2× o intervalo p/ cobrir um tick lento sem soltar o lock cedo demais. */
    const billingLockTtlMs = Math.max(Number(process.env.BILLING_LOCK_TTL_MS) || 30000, billingMs * 2);
    const { withDistributedLock } = require('./src/providers/redis/distributed-lock');
    console.log(`[BillingEngine] Motor de cobrança rodando (${billingMs}ms, lock TTL ${billingLockTtlMs}ms).`);

    /**
     * Anti-cobrança-dupla em duas camadas:
     *  1) `billingTickRunning` — evita sobreposição de ticks na MESMA instância (tick > intervalo).
     *  2) lock distribuído (Redis) — em N instâncias, só uma roda a varredura por tick.
     *     Sem Redis configurado, degrada para execução única (dev/instância só).
     */
    let billingTickRunning = false;
    setInterval(async () => {
      if (billingTickRunning) return;
      billingTickRunning = true;
      try {
        await withDistributedLock('billing:tick', billingLockTtlMs, async () => {
          await sessionsService.runBillingTickSweep();
        });
      } catch (err) {
        console.error('[BillingEngine] tick falhou:', err?.message || err);
      } finally {
        billingTickRunning = false;
      }
    }, billingMs);

    // Esquema: migrações em `migrations/` correm no arranque (ver `runMigrations()` em `start()`).
    // SEQUELIZE_SYNC=true opt-in (dev ou bootstrap manual); evite alter em PRD.
    const syncOn = process.env.SEQUELIZE_SYNC === 'true';
    const useForce = process.env.SEQUELIZE_SYNC_FORCE === 'true';

    if (syncOn || useForce) {
      if (useForce) {
        console.warn(
          '[sequelize] sequelize.sync({ force: true }) irá APAGAR e recriar todas as tabelas.'
        );
        await sequelize.sync({ force: true });
      } else {
        await sequelize.sync({ alter: process.env.SEQUELIZE_SYNC_ALTER === 'true' });
      }
    }

    warmupAssistantsSilent().catch((e) =>
      console.warn('[openai.setup] Aquecimento do assistente ignorado:', e.message)
    );

    const { warmDisposableBlocklist } = require('./src/config/disposableEmails.config');
    await warmDisposableBlocklist();

    server.listen(port, () => {
      console.log(`API escutando na porta ${port}`);
      const {
        scheduleEmailPendingReviewJob,
      } = require('./src/features/auth/auth.emailPending.job');
      const {
        scheduleSpecialistReservationSweepJob,
      } = require('./src/features/specialists/specialist.jobs');
      const {
        scheduleTrabalheConoscoRetentionJob,
      } = require('./src/features/trabalhe-conosco/trabalhe-conosco.retention.job');
      const { attachWorkerIfEnabled } = require('./src/queues/delivery.queue');
      scheduleEmailPendingReviewJob();
      scheduleSpecialistReservationSweepJob();
      scheduleTrabalheConoscoRetentionJob();
      attachWorkerIfEnabled();
      // Gestão Fadas, fatia Presença: vence a confirmação 60+5 no servidor (só com GF_FATIA_PRESENCA=true e escrita habilitada).
      if (process.env.GESTAO_FADAS_ENABLED === 'true') require('./src/gestao-fadas/features/presenca/presenca.job').agendar();
      // Gestão Fadas, trava da ficha do ASP (Maturacao/53): confere o que o painel gravou no legado (só com GF_LEGADO_VERIFICACAO=true).
      if (process.env.GESTAO_FADAS_ENABLED === 'true') require('./src/gestao-fadas/legado-escrita/verificacao.job').agendar();
    });
  } catch (err) {
    console.error('Falha ao iniciar a API:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
