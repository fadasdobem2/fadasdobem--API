# Feature `sessions/`

**Propósito:** ciclo de **sessões ao vivo**: criação (modalidade TEXTO | VOZ | VIDEO), **telecom unificado em Agora.io** (RTC web), bilhetagem **2+X+2**, webhooks NCS, encerramento e billing incremental.

**Pasta:** `src/features/sessions/`

| Ficheiro | Papel |
|----------|-------|
| `sessions.routes.js` | Rotas HTTP `/v1/sessions` |
| `sessions.controller.js` | Auth em rotas protegidas; webhook Agora NCS **sem** auth |
| `sessions.service.js` | `createSession`, token Agora, NCS async, `runBillingTickSweep` |
| `session.constants.js` | Cortesia inicial, WARNING, intervalo billing |
| `telecom.manager.js` | Estratégia de disconnect por `telecom_provider` (caminho activo: **AGORA**) |

**Rotas destacadas:**

- `POST /` — **Cookie** access; corpo típico `specialist_id`, `modality`; VIDEO → canais Agora.
- `GET /:id/token` — token RTC; sessões com `telecom_provider = AGORA`.
- `POST /agora-webhook` — payload NCS; resposta **200 imediato**, processamento assíncrono; **sem CSRF** (webhook servidor-a-servidor).

**Telecom Intelbras WideVoice (legado):**

- O módulo `features/telecom` (Intelbras REST) está **desactivado** para o fluxo principal de produção. Ver **`src/features/telecom/DESATIVADO.md`**. A rota `POST /v1/sessions/intelbras-webhook` **não** está registada em `sessions.routes.js` na árvore actual — não documentar como endpoint activo.

**Motores paralelos:**

- Cronômetro: `runBillingTickSweep` (interval em `app.js` via constantes CHRONO).

**Variáveis (exemplos):** `AGORA_*` (ver `.env.example` e `providers/Agora.md`).

**Models:** [Session.md](../models/Session.md) — inclui campos `magic_link_token` / `magic_link_expires_at` para fluxo WhatsApp futuro; ver [REGRAS_DE_NEGOCIO.md](../REGRAS_DE_NEGOCIO.md).

---

*Última actualização: Agora como único webhook de sessão em rotas; Intelbras desactivado (Maio 2026).*
