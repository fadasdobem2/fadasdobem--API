# Tabela `clients`

**Propósito:** perfil comercial do cliente: cadastro progressivo (campos socioeconômicos nuláveis), LGPD indireto via `users`, precificação dinâmica + override manual.

---

| Campo | Tipo | Nulo | Observação |
|-------|------|------|------------|
| `user_id` | UUID | Não | **Sem `unique` simples na coluna:** índice único parcial `clients_user_deleted_at_null_uidx` garante exatamente um perfil ativo por usuário. |
| `cpf` | String | Sim | Quando preenchido, índice único parcial `clients_cpf_deleted_at_null_uidx` evita duplicidade **somente** para linhas vivas com CPF não nulo. |
| `pricing_level_id` | UUID | Sim | FK lógica → `pricing_levels`. |
| `manual_price_override` | Boolean | Não | Congela regras automáticas. |
| Endereço / apelidos / notas internas | diversos | Ver model. |

Para matriz completa de FKs e índices parciais, ver [`Relacionamentos_FKs.md`](./Relacionamentos_FKs.md).
