# Tabela `oauth_accounts`

**Propósito:** identidades federadas associadas aos `users`.

---

| Observação especial |
|---------------------|
| O par (`provider`, `provider_user_id`) só é único enquanto a linha estiver **viva** (`deleted_at IS NULL`), via índice parcial Postgres. |
