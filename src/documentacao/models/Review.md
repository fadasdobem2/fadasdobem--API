# Tabela `reviews`

**Propósito:** feedback pós-consulta (nota + comentário moderável por Gestora).

---

| Campo especial |
|----------------|
| `session_id`: não usa `unique` direto na coluna; apenas índice parcial garante revisão máxima ativa por sessão (`reviews_session_deleted_null_uidx`). |
