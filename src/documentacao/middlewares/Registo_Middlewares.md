# Registo — `src/middlewares/*.js`

| Ficheiro | Responsabilidade | Notas |
|----------|------------------|--------|
| `csrf.middleware.js` | **`doubleCsrfProtection`** (`csrf-csrf`): valida `X-CSRF-Token` vs cookie `__Host-fdb_csrf` em `POST`/`PUT`/`PATCH`/`DELETE`. Exporta `generateCsrfToken`, `clearCsrfCookie`. | **Ignora** paths que terminam em `/chatwoot/webhook`, `/payments/webhook`, `/sessions/agora-webhook`. Requer `CSRF_SECRET` (≥32). |
| `auth.middleware.js` | Lê access JWT do cookie **`__Secure-fdb_access`** → `jwt.verify` com `JWT_SECRET` / `jwtVerifyOptions()`; carrega `User` + `client_profile`; exige `token_use === 'access'` e conta activa. | **Sem** fallback `Authorization: Bearer` no fluxo web actual. |
| `rateLimit.middleware.js` | Limitadores `express-rate-limit` para login, registo, *forgot password* (chave IP e/ou e-mail normalizado). Usa **`RedisStore`** (`rate-limit-redis`) quando há Redis → contador global ao cluster; sem Redis cai em `MemoryStore`. | `AUTH_RATE_LIMIT_DISABLED=true` ignora limites em homolog. Exporta vários middlewares nomeados (`loginRegisterIpLimiter`, etc.). |
| `authorization.middleware.js` | Módulo RBAC HTTP: `requireStaffAccess`, `requirePermission`, `requireAnyPermission`, `requirePermissionWithStepUp`, `attachAccessContext` **e `requireUserRole(...papéis)`** — guard genérico por papel de produto (`CLIENTE`/`TAROLOGA`/`GESTORA`). | `requireUserRole` substituiu os antigos `clienteRole`/`tarologaRole`/`gestoraRole` (data-driven; código de erro `FORBIDDEN_ROLE`). |
| `mpSignature.middleware.js` | Valida cabeçalho `x-signature` Mercado Pago (HMAC SHA-256 sobre *manifest* com `data.id`, `request-id`, `ts`). | Aplicado ao **POST** `/v1/payments/webhook`. Pode falhar antes do controller se assinatura inválida (`AppError`). |
| `notFound.middleware.js` | Resposta 404 padronizada para rotas não coincidentes. | Registado **depois** de todas as rotas em `app.js`. |
| `errorHandler.middleware.js` | Captura erros (incl. `AppError`): status, mensagem segura ao cliente, log em desenvolvimento. | Último middleware da cadeia. |

**Imports frequentes:** `AppError`, `responderErro` / helpers de `src/utils/response.util.js`.

> **Papéis de produto:** os antigos `tarologaRole`/`clienteRole`/`gestoraRole.middleware.js` foram **removidos** e consolidados em `requireUserRole(...)` no `authorization.middleware.js` (RBAC). Uso: `requireUserRole('TAROLOGA')`, `requireUserRole('CLIENTE')`.

---

*Última actualização: escalabilidade multi-instância (pool BD, rate-limit/RBAC/socket sobre Redis) + consolidação dos guards de papel no RBAC (Jul 2026).*
