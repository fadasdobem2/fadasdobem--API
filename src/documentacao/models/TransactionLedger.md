# Tabela `transaction_ledger`

**Propósito:** dupla entrada append-only. `amount` é **sempre** `DECIMAL(14,4)` com validação de não-negatividade.

| Campo | Observação |
|-------|------------|
| `debit_account_id`, `credit_account_id` | Contas opostas do evento. |
| `amount` | Decimal estrito (quatro casas). |
| `reference_type`, `reference_id` | Agrupador de eventos multi-perna. |
| `idempotency_key` | Unique global (tabela não é paranoid). |
