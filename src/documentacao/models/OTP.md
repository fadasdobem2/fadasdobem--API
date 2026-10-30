# Tabela `otps`

**Propósito:** OTPs de recuperação/step-up. `attempts_count` + `locked_until` impedem brute force; `consumption` via `consumed_at` previne reuso mesmo antes de TTL.

Campos obrigatórios do negócio: `code`, `expires_at`, `attempts_count` (com defaults operacionais de `max_attempts` por linha para flexibilizar flows distintos).

**Segurança:** em ambientes públicos finalize transformando `code` em hash — o serviço de auth ficará responsável por essa migração; o modelo já documenta esse risco.

| Campo | Função |
|-------|--------|
| `user_id`, `purpose` | Escopo granular do código |
| `code` | Valor entregue ao canal (tratar confidencialidade) |
| `expires_at` | Expiração absoluta |
| `attempts_count`, `max_attempts`, `locked_until` | Anti-bruteforce |
| `consumed_at` | Marca one-time usage |
| `delivery_channel` | EMAIL/SMS/WHATSAPP etc. |
| `ip_address_created`, `user_agent_created` | Forense suporte |

Registro **não** paranóido — expirar/cleanup via job.
