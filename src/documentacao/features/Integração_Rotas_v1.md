# Rotas HTTP `/api/v1/*` (consolidado)

Referência rápida. Detalhes por domínio nos ficheiros da mesma pasta.

**Prefixo real:** `app.js` monta `routes` em **`/api`** → rotas versionadas em **`/api/v1/...`**.

**Segurança global (browser):**

- **`POST` / `PUT` / `PATCH` / `DELETE`** sob `/api/*` exigem header **`X-CSRF-Token`** válido (excepto webhooks listados abaixo).
- Rotas autenticadas usam cookie **`__Secure-fdb_access`** (JWT access). **Não** usar `Authorization: Bearer` no fluxo web actual.
- Cliente HTTP deve enviar **`Cookie`** + **`credentials: 'include'`** (ou equivalente) em chamadas cross-origin; o servidor usa **`Access-Control-Allow-Credentials: true`** e origins fechadas (`CORS_ORIGINS`).

| Método | Caminho (após `/api`) | Feature | Notas |
|--------|------------------------|---------|--------|
| GET | `/v1/auth/csrf-token` | auth | Público — emite `csrfToken` + cookie `__Host-fdb_csrf` |
| POST | `/v1/auth/register` | auth | Rate limits; cookies JWT + `csrfToken` no JSON |
| POST | `/v1/auth/login` | auth | idem |
| POST | `/v1/auth/refresh-token` | auth | Lê refresh do cookie; sem CSRF no body |
| POST | `/v1/auth/forgot-password` | auth | |
| POST | `/v1/auth/reset-password` | auth | |
| GET | `/v1/auth/verify-email` | auth | Query `token` |
| GET / PATCH | `/v1/auth/me` | auth | **Cookie** access |
| POST | `/v1/auth/logout` | auth | **Cookie** access; limpa auth + CSRF |
| POST | `/v1/auth/resend-verification` | auth | **Cookie** access |
| GET | `/v1/config/public` | config | Público |
| POST | `/v1/chatwoot/webhook` | chatwoot | Público; **CSRF ignorado**; assinatura Chatwoot |
| GET | `/v1/evolution-admin/integrations/status` | evolution | |
| GET | `/v1/evolution-admin/instances` | evolution | |
| POST | `/v1/evolution-admin/instances/:instanceName/reconnect` | evolution | |
| GET | `/v1/specialists` | specialists | Vitrine — lista |
| GET | `/v1/specialists/:id` | specialists | Vitrine — detalhe |
| PATCH | `/v1/specialists/me/profile` | specialists | Cookie + role **TARÓLOGA** |
| PATCH | `/v1/specialists/me/status` | specialists | idem |
| PUT | `/v1/specialists/me/schedule` | specialists | idem |
| POST | `/v1/queues/` | queues | Cookie + role **CLIENTE** |
| POST | `/v1/queues/:id/leave` | queues | idem |
| GET | `/v1/queues/specialist/:specialistId` | queues | Público |
| POST | `/v1/sessions` | sessions | Cookie |
| GET | `/v1/sessions/:id/token` | sessions | Cookie — token Agora |
| POST | `/v1/sessions/agora-webhook` | sessions | NCS Agora; **CSRF ignorado** |
| POST | `/v1/payments/pix` | payments | Cookie |
| POST | `/v1/payments/card` | payments | Cookie |
| GET/HEAD | `/v1/payments/webhook` | payments | Probe |
| POST | `/v1/payments/webhook` | payments | Mercado Pago; **CSRF ignorado**; `x-signature` |
| POST | `/v1/public/tarologa/candidates` | specialist-candidates | Público — F1 candidatura taróloga |
| GET | `/v1/public/tarologa/onboarding/:token` | specialist-candidates | Público — valida convite F2 |
| PUT | `/v1/public/tarologa/onboarding/:token/f2` | specialist-candidates | Público — submete F2 |
| GET/POST/PATCH… | `/v1/admin/specialist-candidates/*` | admin + specialist-candidates | Cookie + role **GESTORA** — funil candidatas |
| GET/POST/PATCH… | `/v1/admin/tarologa-candidates/*` | admin | Alias do funil candidatas |

*WebSocket (fila):* mesmo host/porta que a API; handshake conforme `documentacao/providers/Socket.md`.

*Probes:* `GET /health`, `GET /ping` na app; em `/api`: `GET /api/ping`, `GET /api/health`, `GET /api/v1/health`.

---

**Ferramentas (curl / Postman):** podem omitir `Origin`; CSRF + CORS destinam-se ao browser. Para testar mutações sem browser, obter primeiro `GET /v1/auth/csrf-token` com jar de cookies e reenviar `Cookie` + `X-CSRF-Token` nas linhas seguintes.

---

*Última actualização: cookies + CSRF + tabela de rotas (Maio 2026).*
