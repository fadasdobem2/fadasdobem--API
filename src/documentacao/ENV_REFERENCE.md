# Referência de variáveis de ambiente (`fadasdobem--api`)

Lista **operacional** das variáveis mais relevantes. A fonte canónica com comentários longos continua a ser **[`.env.example`](../../.env.example)** na raiz do pacote — copie para `.env` e preencha.

---

## Aplicação e HTTP

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `NODE_ENV` | Recomendado | `development` / `production`. |
| `PORT` | Não | Default `3000`. |
| `API_PUBLIC_URL` | Recomendado | URL pública da API (links em e-mails, verify-email). |
| `TRUST_PROXY` | PRD atrás de proxy | `true` para `req.ip` e rate limit correctos. |
| `TRUST_PROXY_COUNT` | Opcional | Saltos de proxy (default `1`). |
| `GRACEFUL_SHUTDOWN_MS` | Opcional | Timeout de shutdown HTTP + filas (default lógico no código). |

---

## CORS e CSRF (browser com cookies)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `CORS_ORIGINS` | **Sim em PRD** com front separado | Lista separada por vírgulas de **origins exactas** (ex.: `https://app.fadasdobem.com.br`). **Nunca** `*` com `credentials: true`. |
| `CSRF_SECRET` | **Sim** | Mínimo 32 caracteres; segredo HMAC do double-submit (`csrf-csrf`). Gerar: `openssl rand -hex 32`. |

> `CORS_ORIGIN` (singular) legado no `.env.example` — preferir `CORS_ORIGINS`; o código usa `CORS_ORIGINS`.

---

## JWT e sessão

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `JWT_SECRET` | **Sim** | Mínimo 32 caracteres. Access token assinado com isto. |
| `JWT_REFRESH_SECRET` | **Sim** | Mínimo 32 caracteres. Refresh token. |
| `JWT_EXPIRES_IN` | Não | Default `30m` (access). |
| `JWT_REFRESH_EXPIRES_IN` | Não | Default `12h` (refresh). |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Não | Defaults no `auth.config.js`. |

Os tokens são enviados ao cliente em **cookies httpOnly** (`__Secure-fdb_access`, `__Secure-fdb_refresh`); não dependem de `Authorization` no browser.

---

## Base de dados e cache

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `DATABASE_URL` | Um dos dois | URL Postgres completa **ou** `DB_*` abaixo. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Se sem URL | Credenciais Postgres. |
| `DB_SSL` | PRD cloud | `true` quando o provider exige SSL. |
| `REDIS_HOST`, `REDIS_PORT`, … | Se usar mutex/filas | Redis para `specialist_mutex`, filas BullMQ, etc. |

---

## Auth — rate limit (homolog)

| Variável | Descrição |
|----------|-----------|
| `AUTH_RATE_LIMIT_DISABLED` | `true` desativa 429 em login/registo (útil em staging). **Produção: false.** |

---

## OAuth (Google + Facebook) — Opção A

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `GOOGLE_OAUTH_CLIENT_ID` | Para Google | Client ID OAuth Web (Google Cloud Console). |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Para Google | Client secret. |
| `GOOGLE_OAUTH_REDIRECT_URI` | Não | Override; default `{API_PUBLIC_URL}/api/v1/auth/oauth/google/callback`. |
| `FACEBOOK_APP_ID` | Para Facebook | App ID Meta for Developers. |
| `FACEBOOK_APP_SECRET` | Para Facebook | App secret. |
| `FACEBOOK_OAUTH_REDIRECT_URI` | Não | Override; default `{API_PUBLIC_URL}/api/v1/auth/oauth/facebook/callback`. |
| `OAUTH_FRONT_SUCCESS_URL` | Recomendado | URL de retorno após login OK (ex.: `https://app.fadasdobem.com.br/entrar`). |
| `OAUTH_FRONT_ERROR_URL` | Não | URL base para erros OAuth (default: `{CORS_ORIGIN}/entrar`). |
| `OAUTH_STATE_SECRET` | Não | HMAC do cookie de contexto OAuth; default usa `CSRF_SECRET`. |

Rotas: `GET /api/v1/auth/oauth/status`, `.../google/start`, `.../google/callback`, idem Facebook, `POST /api/v1/auth/oauth/complete-profile` (autenticado).

---

## Mercado Pago

| Variável | Descrição |
|----------|-----------|
| `MP_ENV` | `sandbox` / `production`. |
| `MP_ACCESS_TOKEN_*` | Token conforme ambiente. |
| `MP_WEBHOOK_SECRET` | Validação HMAC `x-signature` no POST webhook. |
| `MP_PACKAGES_JSON` | Catálogo opcional (ver `payments.constants`). |

---

## Agora.io (RTC)

| Variável | Descrição |
|----------|-----------|
| `AGORA_APP_ID` | App ID. |
| `AGORA_APP_CERTIFICATE` | Certificado para gerar token RTC no servidor. |

---

## Chatwoot, Evolution, e-mail, IA

Ver secções correspondentes no `.env.example`: `CHATWOOT_*`, `EVOLUTION_*`, `RESEND_*`, `ACTIVE_AI_PROVIDER`, `ANTHROPIC_*`, `OPENAI_*`, `SOCKET_CORS_ORIGIN`, etc.

---

## Negócio Nice (opcional — defaults no código)

Definidas em `src/config/business.config.js`; podem ser sobrescritas por env. Exemplos no `.env.example`:

- `CLIENT_RESERVATION_MINUTES`
- `SESSION_MINIMUM_FLOOR_MINUTES`
- `SPECIALIST_RESERVATION_JOB_INTERVAL_MS`
- …

---

## Migrações e arranque perigoso

| Variável | Aviso |
|----------|--------|
| `SEQUELIZE_SYNC` / `SEQUELIZE_SYNC_FORCE` | Evitar em PRD; preferir `migrations/`. |

---

*Manter este ficheiro sincronizado quando novas env forem introduzidas no código.*
