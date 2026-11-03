# Documentação completa da API A (ponta a ponta)

Este documento explica tudo que existe nesta API: a plataforma completa, o módulo Gestão Fadas (sistema provisório), como o banco legado ASP32 é usado, onde cada dado novo vive, como as regras de negócio são impostas no servidor, como verificar e como ocorre a transição para a plataforma definitiva.

Convenções: "front" é o front do sistema provisório (suspiro). "B" é a API original de apoio desse front, usada só como contrato de referência. "A" é esta API.

---

## 1. Visão geral

### 1.1 Dois sistemas, uma API

| | Sistema provisório (Gestão Fadas) | Plataforma completa (Fadasdobem) |
|---|---|---|
| Papel | Operação diária da Nice sobre o banco legado | Plataforma definitiva, ponta a ponta |
| Código | `src/gestao-fadas/` | `src/features/*`, `src/routes`, `src/models` |
| Rotas | `/api/*` no contrato da B (gate) e `/api/v1/gestao-fadas` | `/api/v1/*` |
| Dados | Lê o legado ASP32 (somente leitura) e grava dado novo no PostgreSQL (`gf_*`) | PostgreSQL da plataforma |
| Front | "suspiro" (Vite, build Node em modo real) | Front Next da plataforma |

A decisão vigente é que **o futuro é a plataforma completa** e que a API A absorve os módulos do sistema provisório. Enquanto o ASP32 segue em produção, o sistema provisório convive com ele sem alterá-lo.

### 1.2 Princípios que valem para tudo

1. **O legado não muda de estrutura.** Nunca se cria, altera ou remove tabela, coluna ou índice do banco legado.
2. **Dado novo vai para o PostgreSQL** da API A.
3. **A regra de negócio é a do código do front.** Quando documentos e código divergem, vale o código do front.
4. **O servidor é a autoridade.** Ele recalcula, decide e recusa com a mesma frase do front, e grava o resultado dele, nunca o do navegador.
5. **Sem segredo no repositório.** Segredos ficam em `.env` e `.local-dev/`, ambos fora do git.

---

## 2. Plataforma completa (`/api/v1/*`)

Montada em `src/routes/index.js`. Cada módulo fica em `src/features/<nome>`:

| Prefixo | Módulo | O que faz |
|---|---|---|
| `/v1/auth` | `auth` | Cadastro, login, refresh, recuperação, sessões de acesso |
| `/v1/config` | `config` | Configurações da plataforma |
| `/v1/chatwoot` | `chatwoot` | Webhooks e comandos de atendimento (assinados) |
| `/v1/evolution-admin` | `evolution` | Administração do WhatsApp (Evolution) |
| `/v1/specialists` | `specialists` | Especialistas (tarólogas), perfis e disponibilidade |
| `/v1/sessions` | `sessions` | Sessões ao vivo, cronômetro comercial e cobrança por minuto |
| `/v1/payments` | `payments` | Carteira, pagamentos e livro-razão (`transaction_ledger`) |
| `/v1/queues` | `queues` | Filas de atendimento |
| `/v1/admin` | `admin` | Administração e acessos da equipe |
| `/v1/payouts` | `payouts` | Repasses às especialistas |
| `/v1/diaries` | `diaries` | Diários |
| `/v1/account-recovery` | `account-recovery` | Recuperação de conta |
| `/v1/public/tarologa`, `/v1/public/jobs` | `specialist-candidates`, `job-applications`, `trabalhe-conosco` | Recrutamento público |
| (transversal) | `anthropic`, `openai`, `telecom` | IA conversacional e telefonia (Agora) |

O README original dessa parte (sessões, cobrança 2+X+2, IA, Mercado Pago) está em [PLATAFORMA_COMPLETA_README_ORIGINAL.md](PLATAFORMA_COMPLETA_README_ORIGINAL.md).

Transversais em `app.js`: Helmet, CORS por lista, cookies, proteção CSRF em `/api`, rate limit, Morgan, Socket.IO com adaptador Redis, filas BullMQ e desligamento gracioso (`GRACEFUL_SHUTDOWN_MS`).

---

## 3. Módulo Gestão Fadas (sistema provisório)

### 3.1 Estrutura de pastas

```
src/gestao-fadas/
  gestao-fadas.routes.js      montagem do módulo (prefixo /api/v1/gestao-fadas)
  gate/                       o "gate": fala o contrato HTTP da B em /api/*
  features/<fatia>/           rota -> controller -> service -> validação
  _comum/                     auditoria, políticas de acesso, exportação, janela/paginação
  _comum/dominio/             regras de negócio puras (CommonJS, relógio injetado)
  novo/                       banco novo (PostgreSQL): executor, models, CHECKs, leitura, escritor
  legado-escrita/             espelho opcional de escrita no legado (desligado)
  fontes/                     SQL de referência e migrações originais do sistema B
src/models/legado/            19 models do banco legado (somente leitura) + gf_* legados
src/dev/                      contas de teste e página /dados-teste (só dev, nunca produção)
migrations/                   migrações PostgreSQL (plataforma e gf_*)
scripts/                      verificadores, ouros, ensaios, ambiente local
```

### 3.2 O gate

O front não chama as rotas internas diretamente. Ele fala com o **gate** (`gate/`), um roteador que reproduz o contrato HTTP da B:

- `/api/auth/*`: sessão do front (login, refresh, logout, sessão atual).
- `/api/operations/*`: leituras do legado (consultas, recebimentos, clientes, tarólogos).
- `/api/payouts/*`: repasses (ligado por `FADAS_ENVIRONMENT=test` ou flag).
- `/api/ops/health`: saúde com verificação de esquema.
- `/api/welcome`, `/api/tarologos-cadastro` e as rotas das fatias (seção 5).

Comportamento comum: erro no envelope `{ error: { code, message } }`, rota de fatia desligada responde `404 NOT_FOUND` e some da sessão, escrita desligada responde `503 WRITE_DISABLED`.

**Sessão** (`GATE_SESSAO`):

- `nativa`: login da própria A, JWT em cookie, refresh por sessão no banco, limite de tentativas via Redis, conferência de `Origin` igual a `FADAS_ORIGIN` nas gravações. O JWT de acesso é checado contra a sessão viva (trocar senha ou bloquear derruba a sessão aberta).
- `proxy-b`: repassa a sessão para a API B.

A sessão (`GET /api/auth/session`) devolve o perfil e o objeto `realFeatures` com as fatias ligadas. O front só troca "exemplo" por "real" nas telas cuja fatia está anunciada.

**Perfis**: administradora, assistente, supervisora, atendente e taróloga. A política de acesso por rota fica em `_comum/politica-acesso.js`. A taróloga só enxerga o que é dela.

### 3.3 Como uma fatia é organizada

Cada fatia segue o mesmo molde:

1. **Migração** com tabelas `gf_*` e **CHECKs** (`novo/esquema-checks.js`), mais **models** em `novo/models/`.
2. **Domínio puro** em `_comum/dominio/`: regras portadas do front, em CommonJS, sem `Date.now()` e sem Intl (relógio e colação pt-BR determinísticos).
3. **Serviço** com: idempotência por `operationKey` (`gf_operacoes`), revisão otimista (`409 VERSION_CHANGED`), auditoria na mesma transação (`gf_auditoria`) e carimbo de autor e instante do servidor.
4. **Gate** com flag própria (`GF_FATIA_*`).
5. **Provedor no front** (`features/integration/<fatia>`), plugável: mesmos setters, estado inicial vazio no modo real, sem mudar design.
6. **Verificador** com banco descartável e **ouro** do código real do front.

---

## 4. O banco legado e a separação do sistema provisório

### 4.1 O que é o legado

O sistema antigo (ASP32) usa um banco MySQL/MariaDB que **continua em produção** e não pode ser alterado estruturalmente. A API A o acessa por `LEGADO_DB_*` com Sequelize.

- 19 models somente leitura em `src/models/legado/tabelas`: `tbl_usuario`, `usuarios`, `tbl_tarologos`, `tbl_atendente`, `tbl_consultas`, `tbl_formaconsulta`, `tbl_pagtoinformado`, `tbl_pagtoconfirmado`, `tbl_pagtoaberto`, `tbl_pagtonaolocalizado`, `tbl_opcaopagto`, `tbl_bancos`, `bandeira_cartao`, `contacorrente`, `cpf_status`, `obs_liberacao_consulta`, `paises`, `perfil_cliente`, `status_pagamento`.
- Convenções do legado tratadas no servidor: `fimConsulta` igual a zero significa consulta aberta, `tmpConsulta` e `vlBonus` estão em minutos, `vlDesconto` é percentual, dinheiro como texto/centavos, ids como string. As credenciais de clientes do legado **nunca** são modeladas.
- Em desenvolvimento a API usa um banco de DEV somente leitura. Produção nunca é tocada por testes.

### 4.2 Onde mora cada coisa

| Tipo de dado | Onde | Quem escreve |
|---|---|---|
| Clientes, tarólogos, consultas históricas, pagamentos históricos | Legado ASP32 | O ASP32 (a API só lê) |
| Tudo que o sistema provisório cria ou edita | PostgreSQL da API A (`gf_*`) | A API A |
| Espelho de consultas no legado | `tbl_consultas` | Adaptador opcional, **desligado** |

Decisão da Nice: o sistema novo pode ler e também inserir ou atualizar **dados** nas tabelas legadas, mas tabelas **novas** vão para outro banco. Por isso o dado novo mora no PostgreSQL local da A, e a escrita no legado existe apenas como espelho opcional e controlado.

### 4.3 Escrita no legado (espelho)

Código em `src/gestao-fadas/legado-escrita/`. Regras:

- Flag `GF_LEGADO_ESCRITA_ENABLED=false` por padrão e nunca ligada em ambiente local.
- Lista permitida de SQL com texto fixo: apenas `INSERT` e `UPDATE` de `tbl_consultas` e 4 leituras fixas. Recusa `DELETE`, DDL e qualquer outra tabela.
- **Achado crítico:** `tbl_consultas` é **MyISAM**, inclusive no DEV, então `ROLLBACK` não desfaz a escrita. Por isso o ensaio troca, só na sessão, a tabela real por uma cópia **temporária InnoDB** e destrói a conexão no fim. Provado em DEV: a tabela real fica com a mesma contagem de linhas, maior id e `AUTO_INCREMENT` antes e depois.
- **Não atômico em produção.** Para reduzir a janela de linha órfã: a intenção (`legado_estado=pendente` com uma chave natural) é gravada no PostgreSQL na mesma transação da consulta, antes de qualquer `INSERT` no legado; antes de inserir, procura-se no legado uma linha que já corresponda (uma livre: adota; nenhuma: insere; duas ou mais: erro "órfã ambígua", decisão humana); uma rotina de reconciliação refaz as pendentes antigas.
- **Entidades além de consultas** (`GF_LEGADO_CLIENTES`, `GF_LEGADO_TAROLOGOS`, desligadas): cliente (`usuarios`: `nome_id`, `nome2`, `whats`, `datanascimento`, sempre com `nivel = 0`) e tarólogo (`tbl_tarologos`: nome com no máximo 35 caracteres e situação). Mesma segurança do espelho de consultas: lista permitida de `UPDATE` (nunca `INSERT`, `DELETE` ou DDL), só os campos alterados são enviados, intenção pendente gravada na transação do PostgreSQL, escrita depois do commit, reconciliação e ensaio em cópia temporária. A leitura combinada usa o legado como fonte do campo espelhado e a extensão `gf_*` só para campo ainda pendente.
- **Legado primeiro** (`Maturacao/46`): para os campos que têm casa no legado, o pedido grava no legado e só depois o PostgreSQL guarda o que é novo, o vínculo e a auditoria. Se o legado falha, nada é salvo. Flags por entidade: `GF_LEGADO_CLIENTES`, `GF_LEGADO_TAROLOGOS`, `GF_LEGADO_CONSULTAS`, `GF_LEGADO_PAGAMENTOS`, `GF_LEGADO_NOTAS`, `GF_LEGADO_STATUS_TAROLOGO`, todas desligadas por padrão. A **trava de banco** `GF_LEGADO_ESCRITA_BANCOS` (vazia = nenhuma escrita) confere o banco conectado a cada escrita; o código recusa `fadasdobem` (produção) e `fadasdobem02` mesmo se listados. Mapeamento de canais para ids existentes do legado fica num único lugar (`legado-escrita/provisorio.js`) e é provisório.
- **Verificação pós-gravação** (`GF_LEGADO_VERIFICACAO`, `Maturacao/53`): a ficha de cliente do ASP regrava dezenas de colunas de uma vez e pode desfazer uma edição. Depois de gravar `nome_id`, `nome2` ou `datanascimento`, o sistema confere de novo em 2 min, 15 min e 2 h: se voltou exatamente ao valor antigo, reaplica uma vez; se mudou para outro valor, só registra a divergência.
- **Saldo calculado do legado** (`Maturacao/52`): `usuarios.saldo` e `valorAPagar` valem 0 em produção; o cálculo a partir dos pagamentos (status 0, 1 e 2) e das consultas do ASP existe, mas desde 31/10/2026 é só CONFERÊNCIA. O saldo de abertura vem da planilha de migração (`Maturacao/55`).
- **Sem casa no legado** (ficam só no PostgreSQL): Pré/Pós, orientação financeira, comissão, preços, restrições, agenda, horários, presença, recados, divergências, pendências, repasse e contas. **Dependem de resposta da Nice**: lançar, confirmar, corrigir e cancelar pagamento, Bônus e Cortesia, saldo e `valorAPagar`, notas da ficha, foto e biografia, tarólogo novo e atendente (15 perguntas, mais as 4 de `tbl_consultas`).
- Mapeamentos ainda a confirmar com a Nice: valor de WhatsApp em `idFormaConsulta`, `idFormaPagto` da pós-paga, tratamento de Devolvida/Anulada/Erro/Não houve, PABX e Telefone.

### 4.4 Separação entre sistema provisório e plataforma definitiva

Hoje:

```
ASP32 (produção) ──► banco legado ◄── leitura ── API A ──► front suspiro
                                         │
                                         └── dado novo ──► PostgreSQL (gf_*)
```

A separação é limpa por três motivos: (1) tudo do provisório está em `src/gestao-fadas/` e nas tabelas `gf_*`; (2) o legado só é lido, então o ASP32 não é afetado; (3) cada fatia tem flag, então liga e desliga sem tocar nas outras.

Transição prevista (a confirmar com a Nice): o banco do sistema provisório e o da plataforma completa são **o mesmo PostgreSQL** (a mesma conexão `DB_*`, as mesmas migrações; as tabelas `gf_*` convivem com as da plataforma). O que ainda é separado é o **legado ASP32**, que é MySQL/MariaDB e só é lido. Quando o ASP32 for desligado, os dados do legado precisam ser **migrados** do MySQL para o PostgreSQL (não é possível restaurar o backup direto entre motores diferentes). A forma dessa migração ainda será definida com a Nice. Depois dela, a API lê tudo do PostgreSQL e o espelho de escrita deixa de ser necessário.

---

## 5. As fatias, uma a uma

Cada fatia tem flag, migração, tabelas e rotas. Todas respondem `404` com a flag desligada.

| Fatia | Flag | Migração | Tabelas | Rotas principais |
|---|---|---|---|---|
| Banco novo (base) | `GF_NOVOS_DADOS=postgres` | `20261030120000` | `gf_auditoria`, `gf_operacoes`, `gf_welcome`, `gf_tarologos_ext`, `gf_repasse_*` (10) | repasse e exportações |
| Horários e escala | `GF_FATIA_HORARIOS` | `20261102000000` | `gf_escalas_semanais`, `gf_horarios_excecoes`, `gf_horarios_periodos` | `GET /schedules`, `PUT /schedules/:tarotId/weekly`, `PUT/DELETE /schedules/:tarotId/overrides` |
| Presença | `GF_FATIA_PRESENCA` | `20261103000300` | `gf_presenca_estado`, `gf_presenca_confirmacoes`, `gf_presenca_historico` | `GET /presence`, `POST /presence/:tarotId/{status,confirm,request,activity}` |
| Agenda e fila | `GF_FATIA_AGENDA` | `20261110000000` | `gf_agenda`, `gf_agenda_eventos`, `gf_agenda_ordem_comandos` | `GET/POST/PATCH /agenda`, `/agenda/:id/{contact,observations,departures,resolution,route-general,reservation/release,...}` |
| Consulta (ciclo) | `GF_FATIA_CONSULTA` | `20261111000000` | `gf_consultas_ext`, `gf_consultas_eventos` | `GET/POST /consultations`, `/consultations/:id/{start,pause,resume,finish,finish-by-staff,cancel-by-reader,more-time,revise,...}` |
| Cadastros | `GF_FATIA_CADASTROS` | `20261112000000` | `gf_tarologos_perfil`, `gf_cadastros_tarologo` (+ envios, links), `gf_clientes_ext` | `/catalog/tarologists`, `/catalog/clients`, `/tarologos-cadastro` |
| Preços, pagamentos e restrições | `GF_FATIA_PRECOS`, `GF_FATIA_PAGAMENTOS`, `GF_FATIA_RESTRICOES` | `20261113000000` | `gf_precos_versoes`, `gf_pagamentos`, `gf_pagamentos_eventos`, `gf_beneficios_minutos`, `gf_saldos_partida`, `gf_restricoes` | `/pricing`, `/payments`, `/payments/:id/revise`, `/restrictions` |
| Painel | `GF_FATIA_PAINEL` | `20261114000000` | `gf_agenda_admissoes`, `gf_agenda_solicitacoes` | `GET /panel/sources`, `/agenda/admissions`, `/agenda/requests` |
| Recados | `GF_FATIA_RECADOS` | `20261115000000` | `gf_recados`, `gf_recados_pessoais` | `GET /notes`, `PUT /notes/:id` |
| Divergências | `GF_FATIA_DIVERGENCIAS` | `20261116000000` | `gf_divergencias` | `GET /divergences`, `PUT /divergences/:id` |
| Contas e Boas-vindas | `GF_FATIA_CONTAS`, `GF_FATIA_CONFIG` | `20261118000000` | `gf_contas_ext`, `gf_welcome` | `/accounts`, `/accounts/:id/{password,active}`, `/welcome` |
| Pendências | `GF_FATIA_PENDENCIAS` | `20261119000000` | `gf_pendencias_encaminhamentos` | `GET /pending-routing`, `GET /pending-routing/derived`, `PUT /pending-routing` |
| Ficha da cliente | `GF_FATIA_FICHA`, `GF_FATIA_CLIENTES` | `20261121000000` | `gf_clientes_orientacoes`, `gf_clientes_notas` | `/client-guidance`, `/client-notes`, `PATCH /catalog/clients/:id` |
| Estado financeiro | `GF_FATIA_ESTADO_FINANCEIRO` | `20261125000000` | `gf_motivos_financeiros`, `gf_adicionais_itens`, `gf_log_operacional` | `GET/PUT /financial-reasons`, `GET/PUT /payout-additions`, `GET/POST /operation-audit` |
| Migração por planilha | `GF_FATIA_MIGRACAO` (anuncia `realFeatures.migration`) | `20261202000000` | `gf_migracao_historicos` (só acrescenta; gatilho barra UPDATE e DELETE) | `GET /migration/histories`, `GET /migration/histories/:id`, `POST /migration/apply`, `GET /migration/reconciliation`, `GET /migration/without-sheet` (detalhes em `Maturacao/55`) |
| Espelho de cadastros no legado | `GF_LEGADO_CLIENTES`, `GF_LEGADO_TAROLOGOS` (desligadas) | `20261128000000` | colunas `legado_*` em `gf_clientes_ext` e `gf_tarologos_perfil` | sem rota própria: acompanha as gravações de cadastros |

Particularidades de negócio que o servidor impõe:

- **Dia operacional** das 06h às 06h, fuso America/Sao_Paulo (UTC-3 fixo).
- **Atenção aos 5 min e saída aos 10 min** na agenda, como no código do front.
- **Comissão** capturada por consulta no lançamento: percentual vigente em `gf_repasse_percentuais`, senão 30. A continuação herda a da consulta de origem.
- **Término informado uma vez**, garantido também por índice único no banco.
- **Consulta iniciada impede pausa** de presença; o job de presença usa as consultas reais.
- **Saldo de abertura** do cliente: vem da PLANILHA de migração (`gf_migracao_historicos`, revisão vigente): crédito menos o débito só se for "cobrar", mais os movimentos DEPOIS do corte individual. Cliente sem planilha abre em ZERO. `gf_saldos_partida` só registra a origem na primeira movimentação (`planilha-migracao` ou `sem-planilha-zero`). O saldo calculado do legado serve só de conferência (`GET /migration/reconciliation`).

---

## 6. Regras de negócio no servidor ("ouro")

O front calcula tudo em funções puras. Para o servidor ser a autoridade, cada regra é **portada** para `_comum/dominio/` e provada contra o código real do front:

1. Um gerador (`scripts/gerar-ouro-gf-*.js`) executa as funções **reais** do front em milhares de cenários, com o relógio fixo, e grava um arquivo de ouro.
2. Um verificador (`scripts/verificar-gf-*.js`) roda o servidor sobre os mesmos cenários e exige resultado igual, inclusive a **frase de recusa**.
3. Há também **mutantes**: variações que o servidor deve recusar. Alterar de propósito uma regra (ex.: janela de 15 min) faz o verificador falhar.

Como o servidor trata uma gravação do navegador: refaz o comando com o instante e o autor do navegador e exige registro igual (senão `422`); em seguida refaz com instante e autor do servidor e **grava esse resultado**.

Nos pagamentos, o modo estrito (`GF_FINANCEIRO_REGRAS`, ligado por padrão; só `false` explícito desliga) faz o servidor descobrir qual função do front rodou e refazê-la com o contexto real do banco: movimentos, ocorrências, transferência de saldo, planilha, lote colado, preço escolhido e duplicidade.

O que já é imposto com paridade provada inclui: horários e escala, presença, agenda e fila geral, o "livres agora" do painel (`panelFlow`), ciclo da consulta, correção de tempo com saldo real, conferência de encerramento, desfechos, compensação, autorização no lançamento, lançamento e revisão de pagamentos, divergências, pendências derivadas das fontes reais, recados e orientação financeira. A lista viva do que ainda é conferido só por forma está na matriz mantida junto à documentação de maturação.

---

## 7. Segurança

- **Sessão**: JWT em cookie, refresh por sessão no banco, revogação ao trocar senha ou bloquear conta, rate limit de login com Redis, `Origin` conferido nas gravações do gate.
- **CSRF**: `csrf-csrf` em `/api`. Webhooks (Chatwoot, Agora) são autenticados por assinatura, janela de tolerância e limite de taxa.
- **Senhas**: apenas hash (bcrypt). Nunca em log, auditoria ou resposta.
- **Auditoria**: toda gravação do Gestão Fadas escreve em `gf_auditoria` na mesma transação, sem dados sensíveis.
- **Idempotência**: `operationKey` em `gf_operacoes`; repetir a mesma chave não duplica efeito, e a mesma chave com outro conteúdo dá `409 OPERATION_KEY_CONFLICT`.
- **Concorrência**: revisão otimista; versão velha dá `409 VERSION_CHANGED`.
- **Legado**: somente leitura por padrão; escrita só pelo adaptador com lista permitida e flag desligada.
- **Segredos**: nada no repositório. `.env`, `.local-dev/` e uploads ficam fora do git. A senha das contas de teste vem de `SEED_LOCAL_SENHA` ou de `.local-dev/senha-teste.txt`.
- **Dados de teste**: a página `/dados-teste` só existe com `DADOS_TESTE_ENABLED=true` e fora de produção.

---

## 8. Ambiente local

Peças: PostgreSQL local, Redis local, API em `:4010`, front real em `:5180` (harness `scripts/rodar-front-no-gate.js`) e demonstração em `:5173`.

| Comando | O que faz |
|---|---|
| `npm run api:local -- --cnf=<.cnf do legado DEV> --secao=client-dev [--migrar]` | Sobe a API com as variáveis do ambiente local e, com `--migrar`, migra e semeia |
| `npm run front:gate -- --api=http://127.0.0.1:4010 --front=<pasta do front>` | Sobe o front real ligado a essa API |
| `npm run seed:gestao-fadas-local` | Semeia as contas de teste da equipe |
| `npm run ensaiar:gestao-fadas-http` | Ensaio das gravações pelo gate, com transação e rollback |
| `npm run ensaiar:gf-legado-consulta` | Ensaio do espelho no DEV, com tabela temporária |

As flags `GF_FATIA_*` e o modo `GATE_SESSAO=nativa` ficam em `.local-dev/api.env` (fora do git).

### 8.1 Variáveis de ambiente (nomes)

Ver `.env.example`. Principais grupos: servidor (`PORT`, `NODE_ENV`), PostgreSQL (`DB_*`), segredos (`JWT_SECRET`, `CSRF_SECRET`), CORS e proxy, Chatwoot e Agora, e o Gestão Fadas: `GESTAO_FADAS_ENABLED`, `GESTAO_FADAS_GATE_ENABLED`, `GESTAO_FADAS_ESCRITA_ENABLED`, `GF_NOVOS_DADOS`, `GATE_SESSAO`, `GATE_B_ORIGEM`, `FADAS_ENVIRONMENT`, `FADAS_ORIGIN`, `LEGADO_DB_*`, `GF_LEGADO_ESCRITA_ENABLED`, `DADOS_TESTE_ENABLED`, as `GF_FATIA_*` e `GF_MIGRACAO_LIMITE_CONFERENCIA_CENTAVOS` (limite da conferência da migração, padrão 5000).

---

## 9. Verificação

Cada verificador cria um banco PostgreSQL descartável (`fdb_<prefixo>_<aleatório>`), roda as migrações, executa os cenários e **apaga o banco** ao fim. Nenhum `fdb_*` deve sobrar.

| Comando | Cobre |
|---|---|
| `npm run verificar:legado` | Offline: leitura do legado, escrita permitida, todos os ouros |
| `npm run comparar:models-migracoes` | Models e migrações sem diferença |
| `npm run verificar:gf-banco-novo` | Base `gf_*`, executor, idempotência, auditoria |
| `npm run verificar:gf-{horarios,presenca,agenda,consulta,cadastros,painel,recados,divergencias,clientes,ficha,contas,pendencias,espelho}` | Cada fatia |
| `npm run verificar:gf-{consulta-regras,painel-fluxo,pagamentos-regras,pendencias-orientacao}` | Regras de negócio portadas, com ouro |
| `npm run verificar:gf-pagamentos`, `npm run verificar:financeiro` | Pagamentos e financeiro da plataforma |

Ordem recomendada antes de entregar: `verificar:legado`, `comparar:models-migracoes`, o banco novo, as fatias e, por fim, o financeiro.

---

## 10. Migrações

Em `migrations/`, em ordem de nome. As anteriores a `20261029` pertencem à plataforma. A partir daí:

`20261029120000` alinhar models e migrações, `20261029130000` índices únicos do financeiro, `20261029180000` saques e sessões, `20261030120000` banco novo, depois uma migração por fatia (seção 5). Há um baseline para bancos já existentes (`npm run ensaiar:baseline-banco-existente`). O formato, a ordem e a execução estão em [migrations/README.md](../migrations/README.md).

---

## 11. Decisões em aberto e limites conhecidos

Para a Nice decidir:

- Migração por planilha (`Maturacao/55`): confirmar se o corte individual é por lote (como o front faz hoje) ou por linha; o que fazer com cliente sem planilha que já tinha movimento.
- Mapeamentos do espelho de consultas no legado (WhatsApp, pós-paga, desfechos, PABX e Telefone).
- Se e quando ligar o espelho no legado em produção (hoje desligado; em produção não é atômico).
- Parâmetros financeiros: taxa do Mercado Pago, divisão 70/30, sobra de pacote, arredondamento de minutos e validade de crédito (o front não tem validade).
- Convite de acesso: o front não tem convite, token de uso único nem expiração.
- Criar cliente novo: o id nasce no legado e depende da decisão sobre escrita no legado.
- Foto do tarólogo do legado (`tbl_tarologos.avatar`, arquivo em `/info_tarologo/images/avatar/`): o catálogo ainda não a entrega, porque a base da URL pública não está definida (o caminho não responde em `fadasdobem.com.br`). Precisa da Nice dizer onde o arquivo é servido (`Maturacao/56`).

Catálogo de tarólogos (`GET /catalog/tarologists`, `Maturacao/56`): lê do legado, só com SELECT, `status` (2 = "Em consulta", demais = "Disponível"; é situação cadastral e nunca liga online/presença, que continua do banco novo) e os oráculos (`tarologo_oraculos` + `oraculos`, nomes sem repetição, na ordem do cadastro). Os oráculos do legado só entram em `directory.oracles` enquanto o perfil novo não tiver os seus; tabela ausente = sem oráculos, sem erro.

Tarólogo: cadastro e campos (`Maturacao/56`, seção "Tarólogo: cadastro e campos"): o catálogo também lê `meus_horarios` (HTML do legado, vira linhas de texto em `profile.official`; só 6 dos 56 ativos têm conteúdo). O e-mail de contato (`tbl_tarologos.email`) nunca vai na lista: a rota `GET /catalog/tarologists/:tarotId` o entrega em `directory.contactEmail` só à administradora (decisão no servidor); os demais perfis recebem o tarólogo sem o campo, e a taróloga só lê o próprio. `pass` nunca é selecionada. A rota usa `canViewTarologists` como a lista (taróloga: só o próprio id, 404 nos outros).

Consultas e Configuração (`Maturacao/56`, seção "Consultas e Configuração"): o leitor do legado normaliza dado sujo. Tarólogo com `nmuTarologo` vazio vira `Tarólogo NNN` (lista de tarólogos, linha de consulta e ficha); consulta que cruza a meia-noite tem o fim corrigido para o dia seguinte quando a diferença das datas bate com `tmpConsulta` (tolerância de 1 min); `tmpConsulta = -1` deriva a duração das datas quando coerentes. Pendências da Nice: valor R$ 0,00 e consultas de 0 min, as 2 abertas com início no ano 0 (não exibidas) e `nome_id` com nome civil.

Limites técnicos:

- Parte da conferência ainda é feita só por forma. A matriz com o que é paridade provada e o que não é é mantida junto à documentação de maturação do projeto.
- Contagens e listas longas (recados, pagamentos) aceitam paginação opcional; sem parâmetros o comportamento é o anterior.
- Dados de teste ficam no banco local e a API não os apaga.

---

## 11.1 Implantação em produção

A API A entra na VPS de produção da KingHost (`<vps-producao>`, domínio `https://gestao.fadasdobem.com.br`) como um serviço novo e separado, atrás do Nginx, ao lado da esteira `gf-ops` do Lucas (que continua cuidando do front). A ligação é feita em **etapas** (0: só leitura; 1: cliente e tarólogo; 2: consultas; 3: pagamentos), com backup antes de cada uma.

- **Como instalar** (usuário de serviço, PostgreSQL, Redis, migrações, systemd, Nginx, verificação, logs, atualização, reversão): [deploy/README.md](../deploy/README.md), com `fadasdobem-api.service`, `nginx-api.conf.snippet`, `api.env.example` (só nomes), `gerar-segredos.sh`, `backup-legado.sh`, `backup-postgres.sh`, `restaurar-teste.md` e o smoke test `deploy/checar-implantacao.js` (`npm run checar:implantacao -- --etapa=0`).
- **Como ligar, verificar e reverter cada etapa**, o passo de liberação da trava de banco em produção (hoje o código recusa `fadasdobem` mesmo se listado), a janela, a comunicação à equipe e a tabela de riscos: `Maturacao/54_ROTEIRO_DE_LIGACAO.md` do repositório de documentação.
- **Contas de login da equipe** (a B em produção tem 1 só): `npm run contas:equipe` (`scripts/criar-contas-equipe.js`), ensaio por padrão; verificado por `npm run verificar:gf-contas-equipe`.

---

## 12. Como contribuir

- Código novo do Gestão Fadas **dentro de** `src/gestao-fadas/`. Sem arquivos gigantes (cerca de 300 a 400 linhas).
- Nunca criar ou alterar estrutura do legado.
- Toda regra de negócio nova: domínio puro, relógio injetado, ouro do código real do front e verificador.
- Toda gravação: `operationKey`, revisão otimista e auditoria na mesma transação.
- Nunca versionar `.env`, `.local-dev/`, uploads, senhas ou tokens.
