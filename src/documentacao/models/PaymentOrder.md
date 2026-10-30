# Tabela `payment_orders`

**Propósito:** registrar passagens econômicas originadas/fornecidas pelo ecossistema Mercado Pago (Payments / Merchant Orders / Webhooks Notifications) com rastreio obsessivo para suporte.

**Idempotência:** `external_reference` não usa `unique` direto na coluna; unicidade apenas para linhas vivas via índice parcial Postgres `payment_orders_external_ref_deleted_at_null_uidx`.

**Cofre obrigatório:** `raw_webhook_payload` (JSONB). O serviço deve anexar cada payload recebido (array ou envelope versionado recomendados) antes de sobrescrever campos espelho.

---

## Domínios de campos

### Internos da plataforma

| Campo | Observação |
|-------|-----------|
| `client_id`, `user_id` | Dono econômico × pagador alternativo |
| `external_reference` | Âncora idempotente combinada ao checkout |
| `idempotency_key_internal` | Opcional; índice único só quando valor não nulo e linha ativa |
| `amount` | `DECIMAL(14,4)` |
| `currency` | ISO-4217 (default `BRL`) |
| `status` | Workflow interno (PAID / CHARGEBACK / ...) |
| `payment_method` | ENUM legível (PIX/CC) paralelo aos IDs crus MP |

### IDs oficiais MP

| Campo | Descrição |
|-------|-----------|
| `mp_payment_id` | ID Payments API como string para evitar perda de precisão |
| `mp_merchant_order_id` | ID merchant order pai quando webhook expõe essa navegação |

### Método e status (snapshot suporte)

| Campo |
|-------|
| `mp_payment_method_id` (pix, visa, ...) |
| `mp_payment_type_id` (credit_card, bank_transfer, ...) |
| `mp_status` (approved, rejected, charged_back...) |
| `mp_status_detail` (motivos granulares, ex.: `cc_rejected_bad_filled_date`) |

### PIX

| Campo |
|-------|
| `pix_qr_code` (copia-e-cola) |
| `pix_qr_code_base64` |
| `pix_expires_at` |

### Cartão e chargebacks

| Campo |
|-------|
| `card_last_four_digits` |
| `installments` (INTEGER) |
| `chargeback_status` (+ campos corporativos `chargeback_*` legados já existentes) |

### Monetário líquido MP

| Campo |
|-------|
| `mp_fee_amount` `DECIMAL(14,4)` |
| `mp_net_received_amount` `DECIMAL(14,4)` |

### NFS-e MP

| Campo |
|-------|
| `mp_nfe_status` ENUM (`PENDING`, `ISSUED`, `ERROR`) |
| `mp_nfe_url` string com link público quando emitido |

### Auditoria Notifications

| Campo |
|-------|
| `raw_webhook_payload` JSONB (histórico bruto obrigatório — merge no serviço) |
