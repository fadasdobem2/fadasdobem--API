# Módulo `features/telecom` — DESATIVADO

> **Status:** desativado em produção e dev. Mantemos os ficheiros como **referência histórica** e para reactivação rápida em laboratório, mas **nenhuma rota deste módulo está montada** em [`src/routes/index.js`](../../routes/index.js).

## Porque foi desativado

A central **Intelbras** integrada via **WideVoice** (`POST api.php` → `clicktocall`, monitor SIP, `core.hangup`, etc.) não cobre o conjunto mínimo de requisitos do produto:

- ❌ **Vídeo nativo 1‑a‑1** entre cliente e taróloga (a central só roteia chamadas telefónicas SIP/PSTN).
- ❌ **Controlo fino de mídia** (forçar “sem câmara” em modo voz, “sem desligar vídeo” em modo vídeo).
- ❌ **Token JIT** por participante para sessão efémera e canal isolado.
- ❌ **Webhook estável e granular** (estados intermédios, qualidade, motivos de corte) com baixa latência.
- ❌ **Suporte multiplataforma** (web, mobile) sem PBX/ramal por participante.
- ❌ **Custos previsíveis por minuto** alinhados ao motor de bilhetagem da plataforma.

A plataforma de tempo real **agora.io** cobre todos estes pontos. Decidimos consolidar:

- **Modalidade `VIDEO`** → Agora RTC, vídeo + áudio publicados, **vídeo não pode ser desligado** (UI obriga `localVideoTrack` sempre ativo).
- **Modalidade `VOZ`** → Agora RTC, **apenas microfone**, **câmara nunca é pedida** ao browser (não há `localVideoTrack`).
- **Modalidade `TEXTO`** → não usa motor de tempo real.

Sessões antigas com `telecom_provider = 'INTELBRAS'` continuam a respeitar o webhook gravado (compatibilidade defensiva no `sessions.service.js`), mas **nenhuma nova sessão é criada com este provedor**.

## O que está “congelado” aqui

| Ficheiro | Propósito original | Estado |
| --- | --- | --- |
| [`telecom.widevoice-probe.routes.js`](./telecom.widevoice-probe.routes.js) | `GET /v1/telecom/widevoice/probe` — sanity da central. | Não montado. |
| [`telecom.lab.routes.js`](./telecom.lab.routes.js) | Endpoints de laboratório (click-to-call, liberar ramal, status…). | Não montado. |
| [`telecom.lab.controller.js`](./telecom.lab.controller.js) | Implementa endpoints de lab + inferência `format_destino`. | Não montado. |
| [`telecom.lab.defaults.helper.js`](./telecom.lab.defaults.helper.js) | Defaults do lab (`.env`). | Não usado. |

Os providers em [`src/providers/intelbras/`](../../providers/intelbras/) continuam carregáveis para o `telecom.manager.disconnectSession()` de sessões legadas, mas **não devem ser usados em fluxos novos**.

## Reactivação (caso a decisão mude)

1. Remontar as rotas em [`src/routes/index.js`](../../routes/index.js):
   ```js
   const telecomWideVoiceProbeRoutes = require('../features/telecom/telecom.widevoice-probe.routes');
   const telecomLabRoutes = require('../features/telecom/telecom.lab.routes');
   router.use('/v1/telecom', telecomWideVoiceProbeRoutes);
   router.use('/v1/telecom', telecomLabRoutes);
   ```
2. Repor a rota de webhook em [`sessions.routes.js`](../sessions/sessions.routes.js):
   ```js
   router.post('/intelbras-webhook', sessionsController.receiveIntelbrasWebhook);
   ```
3. Mudar `resolveSessionVideoTelecomDriver()` em [`sessions.service.js`](../sessions/sessions.service.js) para devolver `'WIDE_VOICE_VIDEO'` quando quiseres usar a Intelbras para vídeo (não recomendado — sem vídeo nativo).
4. Atualizar `.env` com `INTELBRAS_*` e reabilitar `SESSION_VIDEO_TELECOM_DRIVER`.

## Documentação relacionada

- [`docs/providers/Intelbras.md`](../../documentacao/providers/Intelbras.md)
- [`documentacao-externa/intelbras-widevoice-handoff-para-ia.md`](../../documentacao-externa/intelbras-widevoice-handoff-para-ia.md)
- [`documentacao-externa/agora.io-e-intelbras-documentacao.md`](../../documentacao-externa/agora.io-e-intelbras-documentacao.md) — comparativo Agora vs. Intelbras.
