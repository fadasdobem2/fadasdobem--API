# Fatia Lilly (API A)

Rotas que o serviço Lilly da Nice chama no Gestão. Contrato completo em `Maturacao/59_LILLY_CONTRATO_API.md` (repositório do projeto).

**Estado (etapa 1, fundação; a etapa 2 de dados está abaixo):** autenticação por token de serviço, flag, semântica de erro, idempotência e tradução de status. As rotas já respondem o contrato certo, **sem efeito**: contexto incompleto, evento não resolvido, validação negada, ação recusada.

| Arquivo | Papel |
|---|---|
| `lilly.config.js` | flags e segredo (`GF_FATIA_LILLY`, `LILLY_SERVICE_TOKEN`, `GF_LILLY_ACOES_ENABLED`) |
| `lilly.auth.js` | Bearer do serviço, tempo constante, fail closed |
| `lilly.respostas.js` | 4xx = recusa definitiva; 5xx só para falha real (a Lilly trata 5xx em POST como incerto) |
| `lilly.routes.js` / `lilly.controller.js` | as 6 rotas, controllers finos |
| `idempotencia/chave.js` | chave original preservada + interna estável; hash só do que define a operação |
| `consultas/status.js` | status do Gestão para o vocabulário da Lilly (`prepared`, `in_progress`, ...) |
| `contexto/contexto.base.js` | relógio, dia operacional 06h-06h, `complete` |

## Fundação de dados (etapa 2)

Migração `20261203000000-gestao-fadas-lilly.js` e models: `gf_lilly_vinculos`, `gf_lilly_eventos` (só acrescenta, gatilho), `gf_lilly_acoes`, `gf_lilly_notas_horario`, `gf_lilly_pagamento_refs`, `gf_lilly_cotacoes`, `gf_lilly_avisos`.

| Pasta | Papel |
|---|---|
| `dados/` | repositórios finos (um por tabela) recebendo `executor`; `executor.js` traz `avulso`, `emTransacao` e helpers de jsonb/data |
| `eventos/` | `events/resolve`: `eventos.resolver.js` (orquestra e grava), `eventos.umbler.js`, `eventos.autoria.js`, `eventos.site.js`, `eventos.config.js` (ambiente) |
| `acoes/` | `acoes.registro.js` (executores por `kind`, nasce vazio), `acoes.guarda.js` (uma vez por chave), `acoes.conciliacao.js` (GET), `acoes.servico.js` (liga ao controller) |
| `notas/` | `GET /lilly/schedule-notes` e `gravarNotaHorario` (para a ação `tarologist_schedule_note`) |

Ambiente novo: `UMBLER_ORGANIZATION_ID` (organização esperada), `LILLY_STAFF_AUTORIZADA` (ids de membro autorizados, vírgula), `LILLY_UMBLER_MEMBER_IDS` (opcional, contas da própria Lilly), `LILLY_ACAO_INCERTA_APOS_S` (opcional, padrão 120).

### Decisões
- D1: `provider` 'umbler' e 'fadas' aceitos. 'fadas' vira `source:'site'`, ator `system`, conferido em `gf_pagamentos`/`gf_consultas_ext`.
- D2: evento Umbler que não é mensagem volta como evento `actor:'system'` com `data.activityCode`.
- D3/D7: recusa conhecida é 4xx; falha da verificação externa (rede, 5xx, leitor ausente, organização não configurada) é 503; nunca 5xx depois de commit.
- D4/D9: GET sempre 200; chave desconhecida, recusada ou só-Umbler = `not_executed`; em execução antiga ou incerta = `uncertain`; em execução recente = `pending`.
- D5/D6: hash só de kind/conversa/cliente/tarólogo/payload; chave original em `chave_original`, interna = ela mesma ou sha256.
- D10: todo evento resolvido com `staffAuthorized:true` fica em `gf_lilly_eventos`; `buscarEventoAutorizado` é a prova que o executor de pagamento exige.
- `staffAuthorized` = membro na lista do ambiente, nota privada, ator staff. Texto, webhook e nome de perfil nunca contam.
- Em `actions`: efeito e marca 'confirmada' na MESMA transação (o 'em_execucao' entra antes do efeito); recusa desfaz o efeito e fica 'recusada'; erro inesperado não guarda nada (500, a Lilly concilia); executor `transacional:false` deixa 'incerta' e a repetição responde 503.

Verificação: `npm run verificar:gf-lilly-base` (sem banco) e `npm run verificar:gf-lilly-dados` (Postgres descartável).

**Próximas etapas:** montadores do snapshot (`contexto/`), executores por `kind` (`executores/`), leitura de conversa/mensagem da Umbler no provider.
