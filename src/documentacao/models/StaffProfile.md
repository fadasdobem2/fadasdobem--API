# Tabela `staff_profiles`

**Propósito:** estender Gestoras e Atendentes com dados operacionais (setor interno). O vínculo 1:1 com `users` mantém dados sensíveis longe do público cliente.

---

| Campo | Tipo lógico | Nulo | Observação |
|-------|-------------|------|-------------|
| `id` | UUID | Não | PK. |
| `user_id` | UUID | Não | Índice único → `users.id`. |
| `display_name` | String | Sim | Nome exibido nos painéis internos/suporte público opcional. |
| `department` | String | Sim | Ex.: “CX”, “Fraude”. |
| `internal_notes`, `employee_code` | Text / String | Somente Gestora | Registro interno RH/Operação. |
