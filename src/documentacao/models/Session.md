# Tabela `sessions`

**Propósito:** um único modelo de consulta **ao vivo** com camada telecom unificada (**Agora** RTC web como caminho activo principal; Intelbras desactivado no produto actual),
cronômetro **2+X+2** (`src/features/sessions/session.constants.js`) e auditoria monetária imutável após liquidação.

Ver também fluxos de produto: [`../REGRAS_DE_NEGOCIO.md`](../REGRAS_DE_NEGOCIO.md).

---

## Dois níveis de `status`

| Camada | Coluna Sequelize | ENUM / valores |
|--------|-------------------|----------------|
| Ciclo da **consulta** (pagamento/agenda/atendimento) | `status` | `SESSION_STATUSES` — `SCHEDULED`, `WAITING_PAYMENT`, `READY`, `ACTIVE`, `ENDED`, … |
| Ciclo **telecom / mídia** (cronômetro, webhooks Plataforma) | `telecom_status` | `TELECOM_STATUSES` — `PENDING`, `ACTIVE`, `WARNING`, `COMPLETED`, `ERROR` |

O segundo corresponde, na prática, ao “status” da sessão média quando a documentação fala apenas da chamada RTC/PBX — **sem substituir** o `sessions.status` operacional já usado pela fila e checkout.

---

## Provedores e canal

| Campo | Uso |
|-------|-----|
| `telecom_provider` | `AGORA`, `INTELBRAS`, `WHATSAPP` (`Session.TELECOM_PROVIDERS`). |
| `provider_channel_id` | Canal lógico **únido**: nome do canal Agora; canal SIP Asterisk ou id equivalente Intelbras; id futuro WhatsApp. Fallback legado `agora_channel_id`. |

### Agora RTC

| Campo | Descrição |
|-------|-----------|
| `agora_uid_client` / `agora_uid_specialist` | UIDs inteiras no SDK (`BIGINT`). Nulos quando não for Agora. |
| `agora_rtc_token_cipher` | Só quando realmente persistir cipher (preferir TTL curto/JIT na API). |
| `rtc_end_reason` | Texto bruto (ex. reason código no NCS `104`). |
| `rtc_duration_seconds` | Duração em segundos calculada quando o último lado sai (`104`). |

### Intelbras / PABX (legado)

Campos `intelbras_*` mantêm-se no schema para histórico. O módulo **`features/telecom` (Intelbras)** está **desactivado** — ver `src/features/telecom/DESATIVADO.md`. Não assumir webhooks Intelbras activos em `sessions.routes.js`.

---

## Cronômetro 2+X+2 — minutos nos dados

Os defaults de produto vivem em **`session.constants.js`** (`FREE_INITIAL_MINUTES`, `WARNING_REMAINING_MINUTES`, `BILLING_TICK_INTERVAL_MS`).
Colunas de snapshot paralelas (`cron_config_*`) continuam DECIMAL para histórico/override futuro mas devem ficar **alinhadas** aos mesmos valores (2).

| Campo | Tipo | Observação |
|-------|------|------------|
| `free_minutes_used` | INTEGER | Minutos já contados na zona **gratuita** inicial (`X` só começa após esse bloco). |
| `paid_minutes_used` | INTEGER | Minutos **inteiros** na zona cobrada já decorridos. |
| `started_at`, `ended_at` | TIMESTAMP | Marcos de início/fim telecom (join NCS ou Bridge AMI). |

O **tick de bilhetagem** é esboço em `sessions.service.js` (`runBillingTickSweep`) com intervalo recomendável `BILLING_TICK_INTERVAL_MS`.

---

## Monetário (DECIMAL estrito onde aplicável)

| Campo | Escala típica |
|-------|----------------|
| `minute_price_applied_snapshot` | DECIMAL(14,4) |
| `specialist_commission_pct_snapshot` | DECIMAL(14,4) |
| `total_cost`, fees e comissões snapshot | DECIMAL(14,4) |

---

## Encerramento

`ended_reason_code` é ENUM Postgres ampliável por migração. Inclui códigos de telemetria típicos e, para o motor de telecom/bilhetagem:

- **`MANUAL`**
- **`NO_BALANCE_HARD_CUT`** (corte quando o saldo deixa de cobrir minutos inteiros arredondados)
- **`NETWORK_ERROR`**

Lista completa no código (`Session.SESSION_END_REASONS`).

---

## Magic link

`magic_link_token` / `magic_link_expires_at` existem no schema (unicidade parcial `sessions_magic_token_deleted_null_uidx`). **Consumo HTTP** (troca por sessão web autenticada) ainda **não** está fechado na API — ver [`../REGRAS_DE_NEGOCIO.md`](../REGRAS_DE_NEGOCIO.md) secção Magic link.

---

## Integração de desconexão (Strategy)

O “**como** desligar” é isolado em `features/sessions/telecom.manager.js` (`disconnectSession`); o caminho **Agora** usa `kick` REST. Intelbras permanece apenas como ramo legado se reactivado no código.
