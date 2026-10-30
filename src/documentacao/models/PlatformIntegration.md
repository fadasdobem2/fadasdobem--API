# Tabela `platform_integrations`

**Propósito:** armazena as **credenciais operacionais e o estado vivo** das integrações administradas pelo **Painel da Gestora** — em especial canal **WhatsApp** via **Evolution API** e parâmetros **globais do Chatwoot**. A camada REST da Fadas do Bem atuará como **proxy seguro**, servindo apenas dados sensíveis cifrados e estados atualizados para o front interno sem expor tooling externo.

---

| Campo | Tipo lógico | Nulo | Papel na regra de negócio |
|-------|-------------|------|---------------------------|
| `id` | UUID | Não | Chave primária surrogate. |
| `instance_name` | String | Não | Label da instância exposta ao painel (Evolution Instance ID amigável / alias operacional Chatwoot). |
| `provider` | Enum | Não | `EVOLUTION_API`, `CHATWOOT_GLOBAL` ou `OTHER` até novos gateways oficiais entrarem na governança. |
| `connection_status` | Enum | Não | `CONNECTING`, `CONNECTED`, `DISCONNECTED`, `QRCODE` — permite UX de reconexão e leituras do job-worker. |
| `qr_code_base64` | Text | Sim | Último QR devolvido para **pareamento WhatsApp visível apenas no domínio autenticado da Gestora**; deve ser saneado/atualizado após sucesso ou expiração. |
| `chatwoot_account_id` | String(64) | Sim | Correlação com o tenant/conta oficial Chatwoot usada pela plataforma. |
| `chatwoot_inbox_id` | String(64) | Sim | Canal de entrada compartilhado ou dedicado aos leads omnichannel quando `provider` exigir esse vínculo. |
| `access_token_cipher` | Text | Sim | Token/credential **somente já cifrado pela aplicação** — nunca persistir plaintext de API keys Evolution/Chatwoot. |
| `last_connected_at` | Timestamp | Sim | Marcos de SLA e histórico de disponibilidade. |
| `disconnected_reason` | Text | Sim | Mensagem última causa de falha (401, timeout webhook, revoked etc.) para troubleshooting acelerado pela Gestora. |
| `configured_by_user_id` | UUID | Sim | Gestora (**`users`** com papel apropriado) que registrou/atualizou o bloco pela última vez — trilhas de segurança. |
| timestamps + `deleted_at` | — | Soft delete | Permite arquivamento de configs legadas mantendo evidência GDPR-friendly. |

**Índices relevantes:**

- Índices simples sobre `provider` e `connection_status` para filtros rápidos do painel administrativo e monitoramento.
- **Índice único parcial** `platform_integrations_provider_instance_active_uidx` em (`provider`,`instance_name`) onde `deleted_at IS NULL`: evita dois registros simultaneamente ativos espelhando o mesmo recurso físico quando a Gestora reconfigura pela UI.
