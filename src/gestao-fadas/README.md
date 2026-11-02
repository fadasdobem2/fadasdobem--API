# Módulo `gestao-fadas` (sistema B)

Camada da API que dá acesso ao **sistema B, o Gestão Fadas**: a operação interna da Nice (consultas do dia, pagamentos,
clientes, repasse), que hoje vive no **banco legado do ASP32** e em tabelas novas `gf_*`.

> **Regra de ouro: o ASP32 ainda está rodando e não dá para mexer nele.** Nenhuma tabela legada é alterada. Se
> precisarmos de um dado novo, criamos uma **tabela nova** ligada ao legado pelo ID. Esta API só **lê** o legado.
> **Dado novo vai para o banco novo (decisão de 29/10):** o PostgreSQL da própria A, ver a seção 10. As seções 6.2 e 8 descrevem o desenho
> antigo (`gf_*` em MySQL), que só vale com `GF_NOVOS_DADOS=mysql`.

## 1. O que é o "sistema B"
| | Sistema A (a plataforma completa) | Sistema B (este módulo) |
|---|---|---|
| Banco | PostgreSQL da API (`src/models/*.js`) | MySQL/MariaDB do legado (`src/models/legado/`) |
| Foco | Cliente compra e consulta online | Operação interna: registrar e conferir consultas e pagamentos |
| Dados | Sistema novo | Histórico real desde 2007 (~80 mil clientes, ~380 mil consultas) |

O objetivo de longo prazo é a plataforma completa absorver o legado. Este módulo é a **ponte**: modela o legado inteiro
(somente leitura), o mescla com as tabelas novas e expõe leituras para o front do suspiro. Ver
`Maturacao/17`, `18` e `19` (pasta do projeto suspiro) para a análise e o plano.

## 2. Onde está cada coisa
O módulo fica em `src/gestao-fadas/`, **fora de `src/features/`**, e **contém** features próprias, cada uma no padrão da API A
(`X.routes.js` -> `X.controller.js` -> `X.service.js`, regra de negócio no service).
```
src/gestao-fadas/                     MÓDULO (irmão de src/features)
  README.md                           este arquivo
  index.js                            exporta o router e a flag
  gestao-fadas.constants.js           moduloHabilitado() (GESTAO_FADAS_ENABLED) e o prefixo
  gestao-fadas.routes.js              router: login + equipe; monta as features
  _comum/                             legado.js (acesso e erros), validacao.js, serializar.js, dia-operacional.js
  fontes/                             schema-catalog.json, reference-catalogs.json (retrato de cpf_status/paises), migrations-gf/*.sql, ORIGEM.txt
  features/                           features do módulo (padrão da API A)
    clientes/ tarologos/ consultas/ pagamentos/ repasse/    *.routes / *.controller / *.service

src/models/legado/                    models do banco legado e das gf_* (fora do módulo, como os demais models)
  connection.js  somente-leitura.js  associations.js  index.js
  tabelas/ (19 legadas, geradas)  novas/ (13 gf_*, geradas)

scripts/gerar-models-legado.js        gera tabelas/ e novas/ a partir de src/gestao-fadas/fontes/
scripts/verificar-models-legado.js    prova offline: catálogo x models, associações, escrita recusada
scripts/verificar-gestao-fadas.js     prova offline: dia operacional, validações, gate, 401 sem login
scripts/verificar-gf-diferencial-b.js prova offline A x B das gravações (validação, DTOs, regras do store) contra o ouro em fontes/ouro-validacao/
scripts/gerar-ouro-gf-diferencial-b.js regera esse ouro rodando o código REAL da B (precisa do FRONT da B com node_modules); só quando a B mudar
```

## 3. Como ligar
1. Variáveis (ver `.env.example`, bloco "Sistema B"): `GESTAO_FADAS_ENABLED=true` e `LEGADO_DB_*`.
   Use um usuário do banco com **SELECT apenas**. Sem a flag, **nenhuma rota do módulo existe**.
2. Com a flag ligada, as rotas ficam em `/api/v1/gestao-fadas/*`.
3. `GET /api/v1/gestao-fadas/status` mostra se o legado está configurado e acessível (sem expor credenciais).

## 4. Segurança
- **Somente leitura em 3 camadas:** hooks do Sequelize recusam escrita; `sequelize.query` só aceita
  `SELECT/SHOW/DESCRIBE/EXPLAIN/WITH` (sem `FOR UPDATE`, `INTO OUTFILE`, multi-instrução); a sessão do banco abre em
  `SET SESSION TRANSACTION READ ONLY`.
- **Credenciais nunca entram nos models:** `usuarios.login/senha/troca_senha/data_troca_senha`, `tbl_tarologos.pass`,
  `tbl_usuario.senUsuario` ficam de fora. (`tbl_usuario.senUsuario` é `varchar(12)`, o que sugere senha em texto no legado; não foi verificado. Risco a tratar na migração.)
- **Tabelas ignoradas de propósito:** `usuarios_backup` (cópia com dados pessoais e senha), `wp_options` e
  `wp_mail_bank_logs` (WordPress, podem ter chaves de API). Elas **existem** e estão catalogadas; devem ficar intactas, só não entram no modelo operacional. `recado` também fica sem model (decisão v273).
- Toda rota exige **login + equipe (GESTORA/ATENDENTE)** e a **permissão RBAC** do assunto (`clientes.buscar/ver`,
  `tarologas.ver`, `consultas.ver`, `dinheiro.recebimentos`, `dinheiro.pagar_tarologas`).
- Entradas validadas (IDs inteiros, datas AAAA-MM-DD, período máximo, paginação limitada, LIKE com escape).
- Se o legado estiver fora, a resposta é **503**, nunca uma lista vazia.
- Os dados pessoais são reais (CPF, telefones, saldos). Em desenvolvimento, use **cópia anonimizada**.

## 5. Como o legado é lido (cuidados do servidor)
- `sql_mode` vazio: há `0000-00-00`. **Datas e horas voltam como texto**; datas zeradas viram `null` na resposta.
- **Dinheiro volta como texto** (`"59.20"`), nunca número.
- IDs legados são inteiros (`INT(11)`) e a API os devolve como **texto**.
- A maioria das tabelas é **MyISAM**: sem transação nem FOREIGN KEY. As associações são lógicas (`constraints: false`).
- As tabelas `gf_repasse_*` guardam o ID legado como **texto** (`tarot_id`, `consulta_id`, `cliente_id`): consulte com `String(id)`.
- Pool de 2 conexões e limite de 10 s por consulta (MariaDB `max_statement_time`, MySQL `max_execution_time`).
- **Dia operacional:** 06:00 a 06:00, fuso America/Sao_Paulo (`_comum/dia-operacional.js`). Vale para consultas;
  pagamentos usam a data civil.

## 6. Tabelas
### 6.1 Legadas (somente leitura): 19 models, 204 colunas
| Tabela | Model | Tabela | Model |
|---|---|---|---|
| `usuarios` | `LegadoUsuario` (clientes e equipe antiga; cliente = `nivel = 0`) | `tbl_consultas` | `LegadoConsulta` |
| `tbl_tarologos` | `LegadoTarologo` | `tbl_pagtoinformado` | `LegadoPagamentoInformado` |
| `tbl_pagtoconfirmado` | `LegadoPagamentoConfirmado` | `tbl_pagtonaolocalizado` | `LegadoPagamentoNaoLocalizado` |
| `tbl_pagtoaberto` | `LegadoPagamentoAberto` | `contacorrente` | `LegadoContaCorrente` (só histórico) |
| `tbl_bancos` | `LegadoBanco` | `tbl_formaconsulta` | `LegadoFormaConsulta` |
| `tbl_opcaopagto` | `LegadoOpcaoPagamento` | `bandeira_cartao` | `LegadoBandeiraCartao` |
| `status_pagamento` | `LegadoStatusPagamento` | `perfil_cliente` | `LegadoPerfilCliente` |
| `cpf_status` | `LegadoCpfStatus` | `paises` | `LegadoPais` |
| `obs_liberacao_consulta` | `LegadoObsLiberacaoConsulta` | `recado` | **sem model** (decisão v273: não ler nem escrever; o módulo novo é `gf_recados*`) |
| `tbl_atendente` | `LegadoAtendente` | `tbl_usuario` | `LegadoUsuarioAsp` (sem a senha) |

### 6.2 Novas `gf_*` (13 models, ligadas ao legado por ID)
`gf_tarologos_ext` (foto, contatos, turno; 1:1 com `idTarologo`), `gf_repasse_percentuais`, `gf_repasse_calendarios`,
`gf_repasse_aberturas`, `gf_repasse_abertura_pendencias`, `gf_repasse_dividas`, `gf_repasse_divida_parcelas`,
`gf_repasse_pagamentos`, `gf_repasse_pagamento_descontos`, `gf_repasse_ajustes`, `gf_repasse_cancelamentos`, `gf_auditoria` e `gf_auth_accounts` (**só** id, nome de exibição, papel e situação; o verificador de senha, a versão da credencial e a chave de criação ficam fora do model; serve para mostrar o nome de quem registrou, como a B).
Hoje são **criadas e gravadas pelo app do suspiro** (Lucas); aqui estão **somente leitura** até a API assumir a escrita
com decisão registrada. As demais `gf_auth_*` (identificadores, sessões, eventos de segurança, vínculos) não entram: a API tem autenticação própria.

### 6.3 Mesclando legado + novo (exemplos)
```js
const { iniciarLegado } = require('../models/legado');
const { models } = iniciarLegado();
// Tarólogo legado + extensão nova
await models.LegadoTarologo.findAll({ include: [{ model: models.GfTarologosExt, as: 'extensao' }] });
// Consulta legada com cliente e tarólogo
await models.LegadoConsulta.findAll({ include: [{ model: models.LegadoUsuario, as: 'cliente' }, { model: models.LegadoTarologo, as: 'tarologo' }] });
// Tarólogo com o histórico de repasse (nova)
await models.LegadoTarologo.findOne({ where: { idTarologo: 7 }, include: [{ model: models.GfRepassePercentuais, as: 'repassePercentuais' }] });
```
As associações disponíveis estão em `src/models/legado/associations.js` (53).

## 7. Endpoints (sob `/api/v1/gestao-fadas`)
Os DTOs de resposta são **os da API B** (nomes em inglês, como no contrato do suspiro, `specs/004.../contracts/operations-http.md`), dentro do envelope da A
(`{ sucesso, mensagem, dados }`). Os parâmetros de query também seguem a B (`start`, `end`, `page`, `pageSize`...).
| Rota | Permissão RBAC | O que devolve |
|---|---|---|
| `GET /status` | equipe | estado do legado e contagem de models |
| `GET /clientes` | `clientes.buscar` | lista por perfil (Hoje/Ontem/7 dias/período, busca, ordenação, 20/30/50 por página) |
| `GET /clientes/:id` | `clientes.ver` | ficha por perfil (CPF, contatos, endereço e saldo antigo só para administradora/assistente) |
| `GET /clientes/:id/consultations` e `/receipts` | `clientes.ver` | histórico da cliente (10 / 20 / completo, conforme o perfil e a ampliação) |
| `POST /clientes/:id/history-access` | `clientes.historico_completo` | **valida e responde 501**: a gravação em `gf_auditoria` não está implementada |
| `GET /tarologos` e `/tarologos/:id` | `tarologas.ver` | `[{id, name, active}]` (inclui inativos); extensão `gf_tarologos_ext` só com `?incluir=extensao` |
| `GET /consultas?start&end&tarotId&page` | `consultas.ver` | `inProgress`, `finished`, `openSinceEarlier`, `totals`, dia operacional 06h-06h, até 366 dias |
| `GET /pagamentos/recebimentos?start&end&by=paid\|launched&page` | `dinheiro.recebimentos` | recebimentos com a regra R5 (informado, confirmado, não localizado, conferir origem; **nunca somados**) |
| `GET /pagamentos/recebimentos/sem-data?page` | `dinheiro.recebimentos` | recebimentos sem data paga, fora de qualquer total |
| `GET /repasse/tarologos/:id/acordo` | `dinheiro.pagar_tarologas` | percentual (padrão 30%) e calendário, com histórico |
| `GET /repasse/tarologos/:id/aberturas` | `dinheiro.pagar_tarologas` | abertura vigente, rascunho e revisões, com dívidas e parcelas |

Estas rotas **não imitam o envelope de erro nem o login do front do suspiro** (`{error:{...}}`, cookie `__Host-gf_session`): isso é o "gate" de
compatibilidade (ver `Maturacao/18`). **Exportações em Excel não existem** (a A não tem `exceljs`): cada service tem um `TODO(xlsx)`.

## 8. Como criar uma tabela nova (nunca alterar o legado)
1. Escreva o SQL em `fontes/migrations-gf/NNN_nome.sql` e o `NNN_nome.rollback.sql`, com prefixo `gf_` e **chave
   primária = ID legado** (ou chave própria + coluna do ID legado em texto), sem FOREIGN KEY para tabela MyISAM.
2. Rode `npm run gerar:legado` para gerar o model em `src/models/legado/novas/`.
3. Declare a associação em `associations.js` e rode `npm run verificar:legado`.
4. Aplicação do SQL no banco é **passo humano e deliberado** (ensaio num clone, backup, janela). Esta API não aplica DDL
   no legado.
5. Só depois liberar escrita: marque o model como gravável (`somenteLeitura: false` no gerador) e exponha a rota com
   a permissão e a auditoria certas.

Tabelas novas **ainda não criadas** (propostas nos docs do suspiro, sujeitas a conciliação): `gf_clientes_ext`
(pré/pós-pago, limite e prazo, orientação financeira), `gf_consultas_ext`, `gf_recados*`, `gf_restricoes`,
`gf_divergencias*`, `gf_escalas_semanais`, `gf_horarios_*`, `gf_presenca_confirmacoes`, `gf_preco_versoes/itens`,
`gf_pagamento_origens`, `gf_operacoes` (idempotência e conciliação).

## 9. O que existe, o que falta
**Portado da API B (leitura, com paridade das regras puras provada offline):** consultas, recebimentos (R5), clientes (perfis e histórico), tarólogos,
repasse (núcleo em centavos, acordo e abertura) e a política de acesso por perfil.
**Não implementado (decisão ou dependência):**
- **Gravações:** percentual, calendário, abertura, confirmar e corrigir (repasse), ampliação de histórico (`gf_auditoria`), e todas as demais telas que
  hoje são demonstração (agenda, ciclo da consulta, pagamentos lançados, restrições, recados...). Os models `gf_*` estão somente leitura.
- **Exportação XLSX**, **A pagar/composição** (dependem de pagamentos, cancelamentos e divergências), **gate** do contrato do front, ETL para o PostgreSQL.
- **Regras só no ASP** (não lidas): o módulo devolve o que o legado registrou.

**Mapeamento de papéis (DECIDIDO em 29/10/2026, delegado pelo Patrick; revisar com a Nice).** Única fonte: `MAPEAMENTO_PERFIL` em `_comum/politica-acesso.js`.
| Papel RBAC da A | Perfil da B |
|---|---|
| `admin` (papel raiz que o seed dá à dona, usuário de produto GESTORA) e `gestora` ("Gestão") | administradora |
| `assistente` (**criado**) , `financeiro`, `financeiro_senior` | assistente ("Financeiro é a Assistente", decisão da Laya, `docs/banco/20`, seção 6) |
| `supervisora` | supervisora |
| `atendente` | atendente |
| `marketing`, `social` | sem perfil (sem acesso a estas rotas) |
Papel de produto (só se nenhum papel RBAC resolveu): GESTORA = administradora, ATENDENTE = atendente, TAROLOGA = tarologa. Vários papéis: vale o de maior alcance. Sem perfil: nega.
**Papel RBAC novo `assistente`** (em `src/rbac/rbac.catalog.js`): só as permissões que as rotas de leitura exigem (`consultas.ver`, `clientes.buscar`, `clientes.ver`, `tarologas.ver`,
`dinheiro.recebimentos`, `dinheiro.pagar_tarologas`). **Em cada ambiente da A é preciso rodar `npm run seed:access`** (idempotente) para o papel existir no banco.
**Trava da B nas rotas:** Consultas, Recebimentos, Tarólogos e Repasse exigem, além da permissão RBAC, o perfil que a B exige (`canReadRealOperations`: administradora e assistente); supervisora e atendente
recebem 403, como na B. Clientes aplica o recorte por perfil da B.

**Decisões ainda pendentes:**
1. **Confirmar com a Nice** o mapeamento acima (principalmente `gestora` = administradora e `financeiro` = assistente).
2. **Gravar em `gf_auditoria`** (ampliação de histórico, exportações) e nas `gf_repasse_*`: a A não tem destino de auditoria nem identificador estável de sessão.

## 10. Verificação
```
npm run verificar:legado
```
Roda **sem banco** 7 scripts: catálogo x models (19 tabelas, 204 colunas, sem credenciais) e 53 associações, escrita recusada, dia operacional, validações,
flag e **401 sem login nas 13 rotas** (lidas do próprio roteador), e a paridade das regras portadas da B: comum (12 grupos), consultas (18), pagamentos (17),
clientes (32) e repasse (66), reaproveitando as asserções dos testes da B.
**Teste real (29/10/2026) no banco de DEV `fadasdobem01`** (MariaDB 10.6.27, dados fictícios; `npm run testar:gestao-fadas-banco` com `LEGADO_DB_*`): consultas (561 finalizadas e 3 em curso no período do seed),
recebimentos com R5 (confirmado, informado, não localizado, conferir origem), sem data paga, tarólogos, repasse (tabelas `gf_repasse_*` vazias: defaults), clientes (período, 7 dias, busca por nome, ficha)
**funcionam**; data e dinheiro chegam como texto, como esperado. O teste achou e corrigiu 2 defeitos que só aparecem com dados reais (ids nulos virando `NaN` no `IN`; catálogos `paises`/`cpf_status`
lidos do banco em vez do retrato versionado). Erro de tabela ausente agora tem código próprio (`LEGADO_TABELA_AUSENTE`).
**Validação contra a API B (oráculo, 29/10/2026, banco de DEV):** `npm run oraculo:api-b` (credenciais só por ambiente) compara a saída dos serviços da A com a das rotas da B publicadas no dev,
para os mesmos dados: consultas, recebimentos (pago e lançado), sem data, tarólogos, clientes (período e busca), ficha, acordo e aberturas de repasse, e, **por perfil** (administradora, supervisora e atendente),
lista, ficha e históricos de clientes. **22 de 22 comparações idênticas** (mais de 13 mil campos só na tabela de consultas), com um **controle** que prova que o comparador detecta uma alteração de um único valor.
`npm run comparar:esquema-banco` compara a estrutura real do banco (só metadados) com os models: no dev, todas as tabelas presentes batem 100% (colunas, tipos, nulos e chaves); as únicas diferenças são o `pass` do tarólogo
(fora do model de propósito) e o `usuarios` do dev, que é uma versão reduzida (32 das 77 colunas do catálogo).
**Ainda NÃO testado:** produção (sem acesso; só leitura e com decisão), `gf_tarologos_ext` (não existe no dev), Excel, e volume real (~80 mil clientes, ~380 mil consultas).
Riscos conhecidos desse teste: formato de data/DECIMAL/BIGINT devolvido pelo driver, `COUNT` e junções, `LIKE` com a collation `utf8_unicode_ci`, e custo de recortes grandes
(o recorte de até 366 dias é carregado em memória, como na B; limite de 10 s por consulta e pool de 2 conexões).

## 11. Regenerar os models
`npm run gerar:legado`. As fontes ficam em `fontes/` (catálogo de 23 tabelas/320 colunas e os SQL `gf_*`, do repositório
do suspiro, commit em `fontes/ORIGEM.txt`). Quando a Nice/o Lucas publicarem uma versão nova, atualize as fontes e rode
de novo; os arquivos gerados não são editados à mão.

## 12. Documentação de banco do suspiro (leia antes de criar tabelas)
O repositório do suspiro tem `docs/banco/` (27 arquivos). O resumo está em `Maturacao/22_DOCS_BANCO_CONSOLIDADO.md` (pasta do projeto suspiro).
Pontos que afetam este módulo: (1) quase todas as `gf_*` desta seção 6/8 são **proposta**, só `gf_tarologos_ext`, `gf_repasse_*`, `gf_auditoria` e
`gf_auth_*` têm SQL; (2) escrita de dados no legado só está prevista para o **cadastro do cliente** (contrato 03), e **não está implementada aqui**;
(3) protocolo de idempotência `gf_operacoes` para qualquer escrita legado + nova; (4) `recado` **não** é lido nem escrito (decisão v273).

## 10. Banco novo (PostgreSQL da A) e convenção de pastas
Dados novos do sistema B (auditoria, repasse, extensão de tarólogos, idempotência, boas-vindas) vivem no **PostgreSQL da API A**, nunca no legado.
- **Chave:** `GF_NOVOS_DADOS=postgres` (padrão) ou `mysql` (alternativa antiga). Em `postgres`, a escrita liga com `GESTAO_FADAS_ESCRITA_ENABLED=true`
  (payouts seguem o R24, `FADAS_ENVIRONMENT=test`) e o MySQL legado nunca é escrito. Quem assina é o usuário da A (`req.user.id`, FK real para `users`);
  `GESTAO_FADAS_ESCRITA_CONTA_ID`/`gfContaId` só valem em `mysql`. O nome de quem registrou vem de `staff_profiles.display_name`.
- **Tabelas (14):** `gf_auditoria`, `gf_repasse_*` (10), `gf_tarologos_ext`, `gf_operacoes`, `gf_welcome`. Migração: `migrations/20261030120000-gestao-fadas-banco-novo.js`
  (idempotente). Tabela nova do módulo: nova migração com prefixo `gestao-fadas` + model em `novo/models/` + CHECKs em `novo/esquema-checks.js`
  e `npm run comparar:models-migracoes` sem diferença.
- **Convenção: tudo que é novo fica DENTRO de `src/gestao-fadas/`.**
```
src/gestao-fadas/novo/                banco novo
  models/                             um model Sequelize (Postgres) por tabela + index.js (registrar); ligado em src/models/index.js por UMA linha
  banco-novo.js  traducao-sql.js      executor Postgres (mesma interface do models/legado/escrita.js), allowlist e tradução do SQL
  escritor.js  modo.js                escolhe o executor por GF_NOVOS_DADOS a cada chamada
  leitura.js  contas.js               leitor dos models novos (datas em texto) e conta/nome do usuário da A
  operacoes.js  welcome.js            gf_operacoes (idempotência) e gf_welcome (revisão otimista)
  esquema-checks.js                   CHECKs: fonte única da migração e dos models
features/<recurso>/                   rotas -> controller -> service de cada recurso (padrão da A); sem SQL fora de service/store
```
  Fora do módulo ficam só as migrações (`migrations/`, o runner exige) e a linha de registro dos models em `src/models/index.js`.
- **Executor:** `emTransacao`, `executarAvulso` e `emEnsaio` com `execute(sql, valores) -> [linhas]`; só INSERT/UPDATE/SELECT em `gf_*`, FOR UPDATE só em `gf_*`,
  sem DELETE nem DDL; o ensaio roda numa transação que nunca confirma (SAVEPOINT por operação). Duplicidade (Postgres 23505) chega como `errno 1062`.
- **Prova:** `npm run verificar:gf-banco-novo` (Postgres local descartável `fdb_gf_*`, apagado no fim).

## Migração por planilha (Maturacao/55)

- **Flag:** `GF_FATIA_MIGRACAO=true` liga `GET /api/migration/histories[/:id]`, `POST /api/migration/apply`, `GET /api/migration/reconciliation` e `GET /api/migration/without-sheet` e anuncia `realFeatures.migration`; desligada responde 404.
  Código: `features/migracao/`, domínio `_comum/dominio/migracao-planilha.js` (porte de `client-migration-history-model.ts`, ouro do código real do front em `scripts/apoio-gf-migracao/ouro-migracao-front.json`, gerado por `scripts/gerar-ouro-gf-migracao.js`), tabela `gf_migracao_historicos` (só acrescenta; migração `20261202000000`).
- **A planilha manda no saldo de abertura** (decisão da Nice): crédito menos o débito só se "cobrar", com corte individual. Cliente sem planilha abre em zero. O saldo calculado do legado (Maturacao/52) é só conferência.
- **Prova:** `npm run verificar:gf-migracao` (a parte offline roda sem banco com `--offline`).

## Ciclo da consulta (fatias 5 a 7) e espelho no legado

- **Flag:** `GF_FATIA_CONSULTA=true` liga `GET|POST /api/consultations` (e `/:id/{start,pause,resume,finish,finish-by-staff,cancel-by-reader,more-time,finish/correction-request,revise}`)
  e anuncia `realFeatures.consultation`; desligada responde 404 e a sessão não anuncia nada. Código: `features/consultas-ciclo/`, domínio puro em `_comum/dominio/consulta-*.js`
  (porte do front, ouro em `scripts/apoio-gf-consulta/ouro-consulta-front.json` gerado do código real por `scripts/gerar-ouro-gf-consulta.js`), tabelas `gf_consultas_ext` e
  `gf_consultas_eventos` (migração `20261111000000`). Prova: `npm run verificar:gf-consulta` (a parte offline entra em `verificar:legado`).
- **Espelho em `tbl_consultas` (DADOS, nunca estrutura):** `legado-escrita/`. DESLIGADO por padrão (`GF_LEGADO_ESCRITA_ENABLED=false`); só o DEV `fadasdobem01` foi autorizado a ligar (30/10/2026), sempre com a trava `GF_LEGADO_ESCRITA_BANCOS`; ver Maturacao/46. Allowlist de SQL só com
  INSERT e UPDATE de `tbl_consultas` (colunas fixas) e leituras fixas; vínculo e estado ficam no Postgres (`gf_consultas_ext.id_consulta_legado`, `legado_estado`).
  `tbl_consultas` é MyISAM (inclusive no dev): ROLLBACK não desfaz. Prova só no dev, `npm run ensaiar:gf-legado-consulta -- --cnf=<.cnf> --secao=client-dev`, que troca a tabela por uma
  cópia temporária InnoDB na sessão (a de verdade não recebe nada) e confere contagem, maior id e AUTO_INCREMENT antes e depois.
