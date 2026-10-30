# Fadas do Bem API (API A)

API única da operação Fadas do Bem. Node.js 18+, Express, Sequelize, PostgreSQL, Redis, BullMQ e Socket.IO.

Ela cumpre dois papéis ao mesmo tempo:

1. **Plataforma completa** (`/api/v1/*`): autenticação, especialistas, sessões ao vivo com cobrança por minuto, carteira, pagamentos, repasses, filas, recrutamento, integrações (Chatwoot, Evolution, Agora, Mercado Pago, Anthropic, OpenAI).
2. **Módulo Gestão Fadas** (`src/gestao-fadas/`): o back-end do **sistema provisório** de operação (o front "suspiro"). Ele lê o banco legado ASP32 (somente leitura), guarda todo dado novo em PostgreSQL próprio e impõe as regras de negócio no servidor.

> Tudo que é novo do Gestão Fadas mora em `src/gestao-fadas/`. Migrações ficam em `migrations/` e scripts de verificação em `scripts/`, como o Sequelize e o `npm run` exigem.

## Mapa da documentação

| Documento | Para quê |
|---|---|
| **[docs/DOCUMENTACAO_COMPLETA.md](docs/DOCUMENTACAO_COMPLETA.md)** | Explicação ponta a ponta: arquitetura, legado, banco novo, cada fatia, regras no servidor, segurança, ambiente, verificação e plano de transição |
| [src/gestao-fadas/README.md](src/gestao-fadas/README.md) | Detalhes do módulo Gestão Fadas |
| [migrations/README.md](migrations/README.md) | Formato, ordem e conferência das migrações |
| [src/models/legado/README.md](src/models/legado/README.md) | Models do banco legado (somente leitura) |
| [docs/PLATAFORMA_COMPLETA_README_ORIGINAL.md](docs/PLATAFORMA_COMPLETA_README_ORIGINAL.md) | README original da plataforma completa (sessões, cobrança, IA, pagamentos) |

## Arquitetura em uma imagem

```
 Front "suspiro" (Gestão Fadas)
        │  HTTP  /api/*  (contrato da API B)
        ▼
 ┌─────────────────────────── API A ───────────────────────────┐
 │  Gate  (src/gestao-fadas/gate)   sessão, permissão, erros    │
 │   └─ features/*  rota → controller → service → validação     │
 │        └─ _comum/dominio  regras de negócio puras (portadas  │
 │           do código do front, provadas por "ouro")           │
 │  Plataforma completa (src/features/*)  /api/v1/*             │
 └──────────────┬──────────────────────────────┬───────────────┘
                │ leitura (e escrita opcional) │ dados novos
                ▼                              ▼
   Banco LEGADO ASP32 (MySQL/MariaDB)     PostgreSQL da API A
   somente leitura, estrutura intocável    tabelas gf_* (e plataforma)
```

## Regras de ouro

- **O legado não muda de estrutura.** O ASP32 segue em produção. Nunca se cria nem altera tabela nele.
- **Dado novo vai para o PostgreSQL** da API A (`GF_NOVOS_DADOS=postgres`, padrão).
- **Escrita no legado** só por adaptador com lista permitida de SQL, **desligada por padrão** (`GF_LEGADO_ESCRITA_ENABLED=false`).
- **A regra de negócio é a do código do front** e vive no servidor. O servidor recalcula, recusa com a mesma frase do front e grava o resultado dele.
- **Nenhum segredo no repositório.** Valores reais ficam em `.env` e em `.local-dev/` (ambos fora do git).

## Começo rápido (ambiente local)

Pré-requisitos: Node 18+, PostgreSQL, Redis e acesso somente leitura a um banco legado de desenvolvimento.

```bash
npm install
cp .env.example .env          # preencha localmente; nunca versione o .env

# Ambiente local completo do Gestão Fadas (API em :4010 com Postgres e Redis locais)
npm run api:local -- --cnf=<arquivo .cnf do legado de DEV> --secao=client-dev --migrar

# Front real apontando para essa API (harness)
npm run front:gate -- --api=http://127.0.0.1:4010 --front=<pasta do front>
```

Contas de teste do ambiente local: `src/dev/contas-teste.js`. A senha de teste **não** está no repositório: defina `SEED_LOCAL_SENHA` ou crie `.local-dev/senha-teste.txt`.

## Fatias do Gestão Fadas (cada uma tem sua flag)

`GF_FATIA_HORARIOS`, `GF_FATIA_PRESENCA`, `GF_FATIA_AGENDA`, `GF_FATIA_CONSULTA`, `GF_FATIA_CADASTROS`, `GF_FATIA_PRECOS`, `GF_FATIA_PAGAMENTOS`, `GF_FATIA_RESTRICOES`, `GF_FATIA_PAINEL`, `GF_FATIA_RECADOS`, `GF_FATIA_DIVERGENCIAS`, `GF_FATIA_CONTAS`, `GF_FATIA_CONFIG`, `GF_FATIA_PENDENCIAS`, `GF_FATIA_FICHA`, `GF_FATIA_CLIENTES`, `GF_FATIA_ESTADO_FINANCEIRO`. Também existem `GF_FINANCEIRO_REGRAS` (ligada por padrão) e as de escrita no legado `GF_LEGADO_ESCRITA_ENABLED`, `GF_LEGADO_CLIENTES`, `GF_LEGADO_TAROLOGOS` (todas desligadas por padrão). Flag desligada: a rota responde 404 e a sessão não anuncia a funcionalidade. A tabela completa (migração, tabelas, rotas) está na documentação.

## Verificação

Cada fatia tem um verificador próprio, com banco PostgreSQL descartável (`fdb_*`, apagado ao fim) e, quando há regra, um "ouro" gerado do código real do front.

```bash
npm run verificar:legado              # offline, inclui todos os ouros
npm run comparar:models-migracoes     # models e migrações iguais
npm run verificar:gf-banco-novo
npm run verificar:gf-agenda           # idem: -horarios -presenca -consulta -cadastros
npm run verificar:gf-pagamentos       # idem: -painel -recados -divergencias -clientes -ficha -contas -pendencias
npm run verificar:financeiro
```

## Segurança, em uma linha

Sessão por JWT em cookie, CSRF, rate limit, auditoria na mesma transação de cada gravação, idempotência por `operationKey`, revisão otimista (`409 VERSION_CHANGED`), webhooks autenticados e nenhuma credencial do legado modelada. Detalhes na documentação completa.
