# Provider `umbler/`

**Ficheiros:** `src/providers/umbler/umbler.client.js` e `umbler.webhook.auth.js`

**Propósito:** falar com a API v1 do Umbler Talk (`https://app-utalk.umbler.com/api`, Bearer) para a Lilly e o Gestão: ler contatos, notas, campos e robôs, e escrever **nota de equipe** na conversa da cliente.

**Segurança:**
- Leitura sempre liberada; **escrita só com `UMBLER_ESCRITA_ENABLED=true`** (padrão desligado, a chamada nem sai da API).
- O token só existe no servidor. Erros da Umbler são traduzidos sem corpo nem token.
- Webhook de entrada: cabeçalho `X-Umbler-Webhook-Token` (tempo constante). Sem `UMBLER_WEBHOOK_TOKEN` a rota responde 503.

**Funções:** `lerContato`, `buscarContatoPorTelefone`, `listarNotas`, `listarCamposPersonalizados`, `listarRobos`, `listarWebhooks`, `criarNota(contactId, texto)`.

**Variáveis:** `UMBLER_API_TOKEN`, `UMBLER_ORGANIZATION_ID`, `UMBLER_BASE_URL`, `UMBLER_ESCRITA_ENABLED`, `UMBLER_WEBHOOK_TOKEN`, `UMBLER_WEBHOOK_AUTH_DISABLED`.

**Conta do Fadas (lida em 06/11/2026, só leitura):** 1 organização; setores "Geral" e "Atendimento"; 14 canais; campos de contato `IdCliente`, `Informacoes`, `PerfilStatus`, `TratarPor`; 7 robôs; nenhum webhook registrado. Os webhooks da Umbler são criados como ação dentro de um robô (eventos: Message, NewChat, MemberTransfer, ChatClosed, ChatSectorChanged, ChatPrivateStatusChanged, ChatTagChanged, MessageFileUploaded).

**Pendente (depende do pacote da Lilly):** nota no chat privado com atendente e setor mantidos e conversa continuando não lida; rota que recebe o webhook; vínculo `IdCliente` x cliente do Fadas.

**Verificação:** `npm run verificar:umbler`.
