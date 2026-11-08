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
| `contexto/` | snapshot do `POST /lilly/context` (seção abaixo) |

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

Verificação: `npm run verificar:gf-lilly-base` (sem banco), `npm run verificar:gf-lilly-dados` e `npm run verificar:gf-lilly-contexto` (Postgres descartável).

## Snapshot (`contexto/`, `POST /lilly/context`)

`contexto.servico.js` (orquestrador) deriva o escopo do evento (`contexto.escopo.js`: conversas, cliente, tarólogos, fila do dia), roda um montador por assunto e junta no envelope (`contexto.base.js`). Fontes trocáveis em teste: `fontes.js` (`legado` somente leitura, banco novo, `gf_lilly_*`, catálogo, saldo).

| Montador | Assuntos |
|---|---|
| `montador.clientes.js` + `contexto.cadastro.js` + `contexto.telefone.js` | `clients`, `phoneLookup` (busca completa por telefone) |
| `montador.tarologos.js`, `montador.horarios.js` | `tarologists`, `schedules`, `scheduleNotes` |
| `montador.agenda.js`, `montador.consultas.js` + `consultas.canal.js` | `appointments`, `consultations` |
| `montador.pagamentos.js` | `payments` (legado R5 + Postgres + referências do provedor) |
| `montador.conversa.js` | `links`, `messages`, `notices`, `consultationQuotes`, `conversation(s)` |
| `montador.configuracao.js` | `financialSettings.pixKey`, `restrictions`, `divergences`, `clientProfileBaseUrl` |
| `contexto.cobertura.js`, `contexto.limites.js` | cobertura por assunto e limites |

- **complete (3.11):** só `true` quando TODOS os assuntos exigidos pelo evento terminaram com cobertura total. Falha de fonte ou limite estourado => o array do assunto sai VAZIO e `complete:false`. `morningReview` e `queueDurationMetrics` (com `capacityCheck`) são SEM FONTE: `complete:false`. Evento sem conversa nem cliente (ex.: `action_result` só com `actionId`): `complete:false`.
- **Telefone:** a Lilly casa por `fullPhone` (`+55DDNNNNNNNNN`, 8 não casa com 9 dígitos); o painel casa por `clientPhoneMatches`. A API pré-filtra pelos 8 últimos dígitos (legado `usuarios` + WhatsApp da ficha), decide como o painel, devolve `+55 DD número` e, quando só o nono dígito casa, o número no formato do observado com `phoneMatch:'ninth_digit'`. `phoneLookup {phone, complete:true}` só se a busca cobriu tudo (erro, > 50 candidatas, sem DDD ou `ddd` x `ddd_real` divergentes = incompleta). Só roda se a conversa ainda não tem vínculo ativo e verificado.
- **Canal da consulta:** o painel guarda `WhatsApp Áudio/Texto/Ligação`, `Telefone`; a Lilly só aceita `WhatsApp`, `PABX`, `Texto/Áudio`, `WhatsApp: texto/áudio`, `WhatsApp Texto/Áudio`. Tabela em `consultas.canal.js` (Texto e Áudio => `WhatsApp: texto/áudio`; Ligação => `WhatsApp`; Telefone => `PABX`; desconhecido => ausente).
- **Status:** `consultas/status.js` + ajustes do doc 60 §10 no montador (`Finalizada pelo tarólogo` => `ended`; `Anulada` => `cancelled`). Consulta preparada sai sem `startedAt`.
- **Pix:** só de `gf_precos_versoes` (resolvido por `changedFields`); a chave de demonstração nunca sai; sem versão, `financialSettings` ausente.
- **Fuso:** São Paulo fixo em -03:00; horário de 00h às 05h59 do dia operacional D cai no calendário de D+1.
- **SEM FONTE (ausentes):** `handoffs`, `deliveryReceipts`, `queueDurationMetrics`, `morningReview`, `tarologistHistories`, `contact`; em tarólogos `conversationId`, `umblerContactId`, `umblerChannelId`, `aliases`, `nameArticle`; em pagamentos `allocatedAmount`; em clientes `outstandingDebt` (regra não definida); em agendamentos `amount`, `notePresent`, `confirmed`.
- **Privacidade:** colunas de `usuarios` só da lista branca (sem senha, login, CPF, e-mail, nascimento, endereço); texto livre (observações, motivos) nunca sai. O registro por pedido tem só tipo, `complete` e contagens por assunto.

## Executores das ações (etapa 3)

`executores/index.js` registra os 13 `kind` (carregado por `acoes.servico.js`). Gestão: `schedule` (`agenda.schedule.js`, POST /agenda), `remove_appointment` e `reschedule` (`agenda.alterar.js`, saída `cancel` e PATCH /agenda/:id), `start_consultation` (`consulta.start.js`, POST /consultations/:id/start, relógio do servidor), `payment` (`pagamento*.js`, POST /payments; refs em `gf_lilly_pagamento_refs`), `update_client`/`register_client` (`cliente*.js`, PATCH /catalog/clients/:id; cadastro novo recusado, ponto de extensão em `cadastro-legado.js`), `tarologist_schedule_note` (`nota-horario.js`). Só-Umbler (`note`, `public_reply`, `mark_attention`, `update_contact`, `knowledge_proposal`): só `validar` (`so-umbler.js`).
Os serviços da equipe rodam com uma conta de serviço (`LILLY_SERVICE_USER_ID`, UUID de um usuário da A, perfil atendente; a auditoria exige usuário real), na transação deles; a guarda confirma depois. Flag nova `GF_LILLY_CADASTRO_LEGADO_ENABLED` (desligada; ligada responde 4xx "não implementado"). Nenhum executor escreve no legado: só os serviços existentes, sob as flags `GF_LEGADO_*`.
Verificação: `npm run verificar:gf-lilly-acoes`. Integração com o código REAL da Lilly (clone da Nice, somente leitura; `LILLY_SERVER_DIR` aponta para ele): `npm run verificar:gf-lilly-integracao`.

## Lilly v708/v709 da Nice (cadastro de quem pagou sem dados, Pix automático, mais tempo, equipe, R)

Tudo no **banco novo** (Postgres, `gf_*`); o legado MySQL continua somente leitura (a migração 002 MySQL da Nice não se aplica). Migração `20261211000000-gestao-fadas-lilly-v708.js`; CHECKs em `novo/esquema-checks.js` (`CHECKS_LILLY_V708` para a coluna acrescentada, porque a migração do espelho aplica toda a lista de `CHECKS_ESPELHO`).

| Assunto | Onde | Regra |
|---|---|---|
| Situação cadastral | `gf_clientes_ext.situacao_cadastral` (NULL, `dados_pendentes`, `completo`) e `sem_email` | NUNCA backfill; não é `perfil_pagamento` (Pré/Pós). A API CALCULA a situação (nome conhecido, telefone, nascimento, e-mail ou `noEmail:true`) e recusa a que não confere (`executores/cliente.campos.js`) |
| Cliente nova | `gf_clientes_novos` + `executores/cliente.registro.js` / `cliente.atualizacao.js` / `cliente.extensao.js` | `register_client` sem ID cria no banco novo (flag `GF_LILLY_CADASTRO_NOVO_ENABLED`, desligada). Nomes vazios, nascimento NULL, ID da sequência `gf_clientes_novos_id_seq` (faixa >= 1.000.000.000, que o legado não alcança; `clientes/cliente-novo.js`), ID só depois do commit, vínculo verificado criado, telefone único, `registrationApproval` conferida (`cliente.aprovacao.js`; `GF_LILLY_CADASTRO_EXIGE_APROVACAO` a exige) |
| Pagamento | `executores/pagamento*.js` | campos e regras em `pagamento.campos.js`; automático `authorizedBy 'lilly:mercado_pago'` com evento do comprovante (`autorizacao.js`); unicidade global da referência (app + índices únicos sem caixa); estornado/anulado não relança (`LILLY_PAYMENT_REVERSED`); lançamento lido no contexto como `confirmed` com pagador, autenticação e data |
| Mais tempo | `gf_lilly_mais_tempo` + `executores/mais-tempo.js` | um ciclo por pedido; mesmo evento não duplica; posterior abre outro ciclo; a tabela proíbe `altera_duracao`/`encerra_consulta` verdadeiros; a consulta e os pagamentos nem são tocados |
| Equipe | `eventos/eventos.interno.js`, `executores/team-reply.js` | `MemberDirectMessage`/`MemberGroup`/`PrivateMemberGroup` resolvem com `staffAuthorized`, `staffId`, `staffMemberId`, `messageId`; **decisão da Nice: todos os atendentes online autorizam** (`LILLY_STAFF_TODOS_AUTORIZAM`, padrão ligado; `false` volta à lista); `team_reply` só é validado, nunca gravado em `/lilly/actions` |
| Contexto | `contexto/montador.retorno.js`, `retorno.sessoes.js`, `contexto.cadastro.js` | `tarologistReturnMetrics` (R; flag `GF_LILLY_RETORNO_METRICAS_ENABLED`, desligada, fonte só o banco novo; sem dado = omitido, nunca 0); `operationalDate` pelo calendário 06h; `situacao_cadastral` e, só para quem o fluxo tocou, nome completo, nascimento, e-mail e `noEmail` |

Verificação: `npm run verificar:gf-lilly-v708` (Postgres descartável; inclui mutantes refutados).

**Próximas etapas:** ligar o gancho `montarContexto` do `validate` (`executores.dependencias.js`) a `contexto/contexto.servico.js` (`montarContexto(body)` devolve `{ snapshot, cobertura }`), leitura de conversa/mensagem da Umbler no provider.
