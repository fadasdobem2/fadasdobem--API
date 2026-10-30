# Feature `auth/`

**Propósito:** registo, login, refresh com rotação, logout, recuperação de palavra-passe, verificação de e-mail, perfil `me`, auditoria e limites de taxa. **Autenticação ao browser:** JWT em **cookies httpOnly** (não no corpo JSON) + **CSRF** em escritas.

**Pasta:** `src/features/auth/`

| Ficheiro | Papel |
|----------|-------|
| `auth.routes.js` | Montagem Express em `/v1/auth` |
| `auth.controller.js` | Handlers HTTP; define cookies; inclui `csrfToken` no JSON de sucesso após login/registo/refresh |
| `auth.service.js` | Regras de negócio, Sequelize `User` / `Client` / `RefreshToken` / `OTP`; **ainda** gera strings JWT internamente — o controller move-os para cookies |
| `auth.cookies.helper.js` | Nomes e opções dos cookies `__Secure-fdb_access` e `__Secure-fdb_refresh` |
| `auth.constants.js` | Política de palavra-passe, bcrypt cost, mensagens, `normalizeEmail` |
| `auth.audit.helper.js` | Auditoria de eventos sensíveis |
| `auth.emailPending.job.js` | Job de contas sem e-mail confirmado |
| `oauth/` | Login social Google/Facebook (Authorization Code + PKCE Google) |

**Dependências típicas:** `User`, `Client`, `RefreshToken`, `OTP`; `rateLimit.middleware.js`; `auth.middleware.js` (rotas protegidas); `csrf.middleware.js` (emitido via controller).

---

## Segurança HTTP (estado actual)

### Cookies (JWT)

| Cookie | Conteúdo | Path | Atributos |
|--------|-----------|------|-----------|
| `__Secure-fdb_access` | Access JWT | `/api` | `httpOnly`, `Secure`, `SameSite=Strict` |
| `__Secure-fdb_refresh` | Refresh JWT | `/api/v1/auth` | idem |

O **corpo JSON de sucesso** de `login`, `register` e `refresh-token` **não** inclui `access_token` nem `refresh_token`. Inclui `usuario`, `access_expires_in`, `refresh_expires_in`, **`csrfToken`** (string para o header nas mutações seguintes).

### Leitura do access token

`src/middlewares/auth.middleware.js` lê **apenas** o cookie `__Secure-fdb_access`. **Não** há fallback a `Authorization: Bearer` para o fluxo web actual.

### CSRF (double-submit)

- Pacote: **`csrf-csrf`** (substituto mantido do `csurf`).
- Cookie: `__Host-fdb_csrf` (httpOnly, Secure, SameSite=Strict, path `/`).
- Header esperado: **`X-CSRF-Token`** (case-insensitive no Express).
- Métodos validados: `POST`, `PUT`, `PATCH`, `DELETE` (sob o mount `/api`).
- **Ignorado** (webhooks com assinatura própria): paths que terminam em  
  `/chatwoot/webhook`, `/payments/webhook`, `/sessions/agora-webhook`  
  (ver `src/middlewares/csrf.middleware.js`).

### Emissão de CSRF

1. **Pré-login:** `GET /api/v1/auth/csrf-token` — público; resposta `{ sucesso, mensagem, dados: { csrfToken } }`.
2. **Pós-login / refresh:** novo `csrfToken` vem em `dados` da mesma resposta que seta cookies — o identificador de sessão CSRF liga-se ao access JWT (ver comentários em `auth.controller.js`).

### Logout

`POST /api/v1/auth/logout` com cookies válidos: revoga refresh no serviço quando possível, limpa cookies de auth **e** cookie CSRF.

---

## Rotas `/api/v1/auth`

| Método | Caminho | Auth | Notas |
|--------|---------|------|--------|
| GET | `/csrf-token` | Não | Emite CSRF para sessão anónima |
| POST | `/register` | Não | Rate limits: IP 5/15m, email 10/15m, **registo** 3/dia/IP |
| POST | `/login` | Não | Rate limits: IP 5/15m, email 10/15m |
| POST | `/refresh-token` | Cookie refresh | Lê refresh do cookie; rotação de `jti` no Postgres |
| POST | `/forgot-password` | Não | Quotas próprias (e-mail + IP) |
| POST | `/reset-password` | Não | — |
| GET | `/verify-email` | Não | Query `token` |
| GET | `/me` | Cookie access | Perfil |
| PATCH | `/me` | Cookie access | Cliente: campos permitidos (nome, tratar_por, data_nascimento, …) |
| POST | `/logout` | Cookie access (+ refresh no cookie) | Limpa cookies |
| POST | `/resend-verification` | Cookie access | — |
| GET | `/oauth/status` | Não | Provedores OAuth habilitados |
| GET | `/oauth/google/start` | Não | Inicia fluxo Google (redirect) |
| GET | `/oauth/google/callback` | Não | Callback Google → cookies + redirect front |
| GET | `/oauth/facebook/start` | Não | Inicia fluxo Facebook |
| GET | `/oauth/facebook/callback` | Não | Callback Facebook |
| POST | `/oauth/complete-profile` | Cookie access | Pós-OAuth: tratar_por, data_nascimento, termos |

---

## Corpo esperado (contratos principais)

### `POST /register`

- `email` (string)
- `password` (string) — política em `auth.constants.js` (`assertPasswordPolicy`: mínimo 8 caracteres, letras e números, e nível de força ≥ “boa” conforme regras actuais)
- `accepted_terms_version` (string não vazia), ex.: alinhada ao front `NEXT_PUBLIC_TERMS_VERSION`

Normalização: e-mail com `trim().toLowerCase()` via `normalizeEmail`. Domínios descartáveis: `src/config/disposableEmails.config.js`. E-mail duplicado: **HTTP 409**.

### `POST /login`

- `email`, `password`

Credenciais inválidas: **401** com mensagem genérica (`LOGIN_CREDENTIALS_GENERIC`).

---

## Variáveis de ambiente (auth + segurança HTTP)

Resumo: [ENV_REFERENCE.md](../ENV_REFERENCE.md). Directamente ligadas a auth:

- `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN`, `JWT_ISSUER`, `JWT_AUDIENCE`
- `CSRF_SECRET` (≥ 32 caracteres)
- `CORS_ORIGINS` (lista exacta; obrigatório com front cross-origin + cookies)
- `AUTH_RATE_LIMIT_DISABLED` (só homolog)
- `TRUST_PROXY` (recomendado em PRD — afecta `anon:` do CSRF pré-login por IP)

---

## Documentação relacionada

- Modelos: [User.md](../models/User.md), [Client.md](../models/Client.md), [OTP.md](../models/OTP.md)
- Mapa de rotas: [Integração_Rotas_v1.md](./Integração_Rotas_v1.md)
- Regras de produto (carrinho, WhatsApp, R1): [REGRAS_DE_NEGOCIO.md](../REGRAS_DE_NEGOCIO.md)
- Lacunas planeadas: [BACKLOG_FASE_2.md](../BACKLOG_FASE_2.md)

---

*Última actualização: alinhamento a cookies httpOnly + CSRF + CORS (Maio 2026).*
