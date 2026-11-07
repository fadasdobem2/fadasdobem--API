# Fatia Lilly (API A)

Rotas que o serviço Lilly da Nice chama no Gestão. Contrato completo em `Maturacao/59_LILLY_CONTRATO_API.md` (repositório do projeto).

**Estado (etapa 1, fundação):** autenticação por token de serviço, flag, semântica de erro, idempotência e tradução de status. As rotas já respondem o contrato certo, **sem efeito**: contexto incompleto, evento não resolvido, validação negada, ação recusada.

| Arquivo | Papel |
|---|---|
| `lilly.config.js` | flags e segredo (`GF_FATIA_LILLY`, `LILLY_SERVICE_TOKEN`, `GF_LILLY_ACOES_ENABLED`) |
| `lilly.auth.js` | Bearer do serviço, tempo constante, fail closed |
| `lilly.respostas.js` | 4xx = recusa definitiva; 5xx só para falha real (a Lilly trata 5xx em POST como incerto) |
| `lilly.routes.js` / `lilly.controller.js` | as 6 rotas, controllers finos |
| `idempotencia/chave.js` | chave original preservada + interna estável; hash só do que define a operação |
| `consultas/status.js` | status do Gestão para o vocabulário da Lilly (`prepared`, `in_progress`, ...) |
| `contexto/contexto.base.js` | relógio, dia operacional 06h-06h, `complete` |

**Próximas etapas:** tabelas `gf_lilly_*` (vínculos, eventos, notas do horário, autorizações), `events/resolve`, montadores do snapshot (um por assunto), `validate` e `actions` (agenda, início de consulta, pagamento, cadastro), conciliação. Cada arquivo abaixo de ~300 linhas.

Verificação: `npm run verificar:gf-lilly-base`.
