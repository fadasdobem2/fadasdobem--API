# Tabela `user_devices`

**Propósito:** armazenar push tokens válidos por dispositivo (FCM/APNs/Web). Possibilita recuperação paralela quando o mesmo usuário está em dois aparelhos.

---

| Campo | Tipo lógico | Nulo | Regra / observação |
|-------|-------------|------|--------------------|
| `id` | UUID | Não | PK. |
| `user_id` | UUID | Não | FK para `users`. |
| `push_token` | String | Não | Deve deduplicate via serviço (rotacionar antes de atualizar duplicidade). |
| `platform` | Enum | Não | Distinção IOS/ANDROID/WEB para payloads corretos. |
| `device_name`, `app_version` | String | Sim | Diagnóstico de regressões e campanhas. |
| `last_seen_at`, `is_active` | Date / Bool | Liga/desliga pushes sem apagar logs. |
| timestamps + `deleted_at` | — | Soft delete para revogar dispositivos sem perder auditoria temporal. |
