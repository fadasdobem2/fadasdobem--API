# Tabela `client_credit_lots`

**Propósito:** lotes de crédito `AVULSO` vs `PACOTE_SESSAO_UNICA`.

| Campo | Precisão |
|-------|-----------|
| `initial_amount`, `remaining_amount` | `DECIMAL(14,4)` — alinhamento com webhook/lotes fracionários. |

| Campo extra | Observação |
|-------------|-------------|
| `expires_at` | `NULL` apenas para pacotes evergreen / avulsos estratégicos. |
