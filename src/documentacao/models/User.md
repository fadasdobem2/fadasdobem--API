# Tabela `users`

**Propósito:** conta raiz para os quatro papéis (CLIENTE, TARÓLOGA, GESTORA, ATENDENTE). Centraliza credenciais, LGPD/versionamento de aceite e metadados de login.

---

| Campo | Tipo lógico | Nulo | Regra / observação |
|-------|-------------|------|--------------------|
| `id` | UUID | Não | PK. |
| `email` | String(320) | Não | **Sem `unique` na coluna:** unicidade apenas entre registros vivos (`deleted_at IS NULL`) via índice parcial Postgres `users_email_deleted_at_null_uidx`. Isso permite reaproveitar o email após soft delete GDPR. |
| `password_hash` | String | Sim | OAuth-only sem senha armazenada. |
| `role` | Enum | Não | Permissão macro dominial. |
| `is_active` | Boolean | Não | Liga/desliga acesso rápido. |
| LGPD (`accepted_terms_*`) | Strings/Dates | Sim | Versionamento de termos obrigatórios. |
| Chatwoot (`chatwoot_*`) | String | Lead provisório. |
| `openai_thread_id` | String(128) | Sim | **`thread.id` oficial da Threads API/OpenAI Assistants.** Permite preservar estado conversacional Omnichannel mesmo que o modelo seja atualizado nos bastidores. Deve ficar órfão se o modelo de privacidade exigir apagar threads — nesse caso, limpar campo + `deleted_at`/LGPD correlato. Índice simples opcional ajuda relatórios. |
| onboarding / avatar / antifraud extras | diversos | Ver model. |
| timestamps + `deleted_at` | Paranoid | Soft delete de contas sensíveis. |
