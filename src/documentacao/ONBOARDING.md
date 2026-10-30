# Onboarding — como ler este repositório (`fadasdobem--api`)

Este ficheiro existe para que **qualquer pessoa** (ou outro agente de IA) saiba **por onde começar** e **onde está a verdade** sobre cada tema.

---

## 1. Ordem de leitura recomendada (30–90 minutos)

| Ordem | Documento | O que aprende |
|------|-----------|----------------|
| 1 | [README na raiz do pacote](../../README.md) | Visão executiva, pilares (ledger, mutex, billing), fases declaradas. |
| 2 | [README desta pasta](./README.md) | Arquitetura `features` / `providers` / `models`, Fases 1–2, leads Chatwoot, motor IA. |
| 3 | [REGRAS_DE_NEGOCIO.md](./REGRAS_DE_NEGOCIO.md) | Trilhos Site vs WhatsApp, o que **não** fazer no login, magic link (estado), cadastro progressivo. |
| 4 | [ENV_REFERENCE.md](./ENV_REFERENCE.md) | Variáveis de ambiente críticas (auth, CORS, CSRF, MP, Agora, DB, Redis). |
| 5 | [features/Integração_Rotas_v1.md](./features/Integração_Rotas_v1.md) | Mapa HTTP `/api/v1/*` com segurança (cookies vs público). |
| 6 | [features/Auth.md](./features/Auth.md) | Auth em profundidade (cookies, CSRF, refresh, rate limits). |
| 7 | [features/Payments.md](./features/Payments.md) + [features/Sessions.md](./features/Sessions.md) + [features/Queues.md](./features/Queues.md) | Dinheiro, consulta ao vivo, fila. |
| 8 | [ANTHROPIC_FLOW_ENGINE.md](./ANTHROPIC_FLOW_ENGINE.md) | Claude + Chatwoot + estados de fluxo. |

Para **contrato campo a campo** da base de dados: pasta [`models/`](./models/) + [`models/Relacionamentos_FKs.md`](./models/Relacionamentos_FKs.md).

---

## 2. Onde está o código (espelho rápido)

| Tema | Pasta principal |
|------|-----------------|
| HTTP montado em `/api` | `app.js` → `src/routes/index.js` |
| Auth | `src/features/auth/` |
| CSRF global | `src/middlewares/csrf.middleware.js` |
| Auth JWT (cookie) | `src/middlewares/auth.middleware.js` + `src/features/auth/auth.cookies.helper.js` |
| Sessões / billing / Agora | `src/features/sessions/` |
| Pagamentos MP | `src/features/payments/` |
| Fila | `src/features/queues/` |
| Chatwoot webhook | `src/features/chatwoot/` |
| Regras comerciais (timeouts, reserva minutos) | `src/config/business.config.js` |
| Lista e-mail descartável | `src/config/disposableEmails.config.js` |

---

## 3. Monorepo e docs de terceiros

Este pacote é **só a API**. O front-end Next.js vive em **`fadasdobem--front/`** (outro diretório no mesmo monorepo). Integração browser: `NEXT_PUBLIC_API_URL` apontando para `…/api/v1`, `credentials: true`, CORS alinhado com `CORS_ORIGINS` na API.

**Manuais de fornecedores** (não normativos do produto): pasta [`../documentacao-externa/`](../documentacao-externa/) (Agora, Anthropic, Chatwoot, Evolution, Intelbras legado).

---

## 4. Manutenção desta documentação

- Sempre que alterar **contrato HTTP**, **cookies**, **env obrigatório** ou **regra de negócio**, actualizar nesta ordem: `features/Auth.md` ou domínio afectado → `Integração_Rotas_v1.md` → `ENV_REFERENCE.md` → `REGRAS_DE_NEGOCIO.md` se for regra de produto.
- Itens ainda não implementados ficam em [BACKLOG_FASE_2.md](./BACKLOG_FASE_2.md) com estado explícito.

*Última revisão estrutural: documentação alinhada a cookies httpOnly + CSRF + CORS (Maio 2026).*
