# Tabela `queues`

**Propósito:** filas de entrada dos clientes aguardando atendimento. `specialist_id` nulo indica “qualquer especialista disponível”; o status cobre SLA, cancelamentos automáticos e reinícios da jornada.

---

| Campo | Tipo | Observação |
|-------|------|------------|
| `client_id` | UUID | Solicitante. |
| `specialist_id` | UUID opcional | Reserva objetiva opcional antes da sessão financeira final. |
| `status` | Enum | `WAITING`, `MATCHED`, `INVITED`, cancel/expirado. |
| `joined_at`, `left_at` | Date | Mede abandono e tempo em fila. |
| `preferred_modality` | Enum | Texto / Voz / Vídeo. |
| `priority_score` | SMALLINT | Desempate comercial. |
| `metadata` | JSONB | Origem de tráfego, tags de campanha. |

Usa `paranoid` para soft delete administrativo.
