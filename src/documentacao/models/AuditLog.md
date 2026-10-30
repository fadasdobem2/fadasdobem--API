# Tabela `audit_logs`

**Propósito:** auditoria forte das ações manuais de Gestoras/operadores autorizados. JSON `old_value`/`new_value` guarda deltas completos antes/depois. `target_entity` + `target_id` permite consultas rápidas além das FK opcionais de domínios específicos.

**Notas:**
- não usa `deleted_at`;
- registros devem permanecer imutáveis após INSERT;
- `correlation_id` propaga traces cross-serviço.

Campos obrigatórios do cliente: derivados das exigências `admin_id`, `action`, (`target_entity`/`target_id` semanticamente equivalem aos campos solicitados cobrindo o alvo auditado — use `metadata` quando o alvo não for UUID).

| Campo | Detalhes |
|-------|----------|
| `admin_id` | Gestora/atendimento privilegiado |
| `action` | Texto estruturado (`MODULE_VERB_OBJECT`) recomendável |
| `target_entity`, `target_id` | Âmbito alvo principal |
| `old_value`, `new_value`, `metadata` | Comparação antes/depois + contextos |
| `ip_address`, `user_agent`, `occurred_at` | Trilhas forenses |
