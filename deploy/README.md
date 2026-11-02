# Implantação da API A na VPS (runbook)

Do zero até a API no ar atrás do Nginx. Alvo: `<vps-producao>` (produção, `https://gestao.fadasdobem.com.br`) e, para ensaio, `<vps-dev>` (dev, `https://gestao-dev.fadasdobem.com.br`). Ubuntu 24.04, Nginx + systemd, SSH só por chave, root bloqueado (use `sudo` com o usuário próprio).

> Este documento só descreve. Nenhum comando foi executado em VPS pela equipe de desenvolvimento. O roteiro de LIGAÇÃO por etapas (o que liga, quando, reversão) está em `Maturacao/54_ROTEIRO_DE_LIGACAO.md`. Aqui é o "como instalar".
>
> Convenção: `<SEGREDO>` é um valor que o operador preenche na VPS. Nunca cole segredo em chat, issue, commit ou histórico do shell. Comandos com `sudo` rodam no usuário de login da VPS.

## 0. O que existe nesta pasta

| Arquivo | Para quê |
|---|---|
| `fadasdobem-api.service` | unidade systemd (usuário sem login, `EnvironmentFile`, `Restart=on-failure`, endurecimento) |
| `nginx-api.conf.snippet` | trecho para o `server {}` do domínio: `/api/`, `/socket.io/`, bloqueio de `/dados-teste` |
| `api.env.example` | só nomes e comentários das variáveis (sem segredos) |
| `gerar-segredos.sh` | gera JWT e CSRF aleatórios direto no arquivo de ambiente, sem imprimir |
| `backup-legado.sh` | `mysqldump` somente leitura do banco legado, SHA-256, retenção |
| `backup-postgres.sh` | `pg_dump` do banco novo da API A |
| `restaurar-teste.md` | como provar que o backup restaura, em banco de TESTE |
| `checar-implantacao.js` | smoke test pós-implantação, só leitura (`--etapa=0..3`) |

## 1. Pré-requisitos

- **Node.js 20 LTS** (a API exige 18+; o `Dockerfile` usa 20). Instale pelo método que o Lucas/KingHost já usa na VPS (pacote do sistema, NodeSource ou nvm do usuário de deploy). Confirme: `node -v`.
- **PostgreSQL 16** (banco NOVO da API A: tabelas `gf_*` e da plataforma). Pode ser na própria VPS.
- **Redis 7** ouvindo só em `127.0.0.1` (limitador de tentativas, cache de permissões, Socket.IO).
- **Nginx** (já existe, é do Lucas) e certificado do domínio (já existe).
- Clientes de linha de comando: `mariadb-client` (para `mysqldump`), `postgresql-client` (`pg_dump`, `pg_restore`), `openssl`, `rsync`, `curl`.
- Acesso de rede da VPS ao MariaDB legado da KingHost (porta 3306). O banco é por lista de IP: peça à Nice/Lucas para liberar o IP da `<vps-producao>`. **Não** ligue TLS no legado (quebra o ASP).
- Usuário do banco legado DEDICADO à API: etapa 0 só `SELECT`; etapas 1 a 3 `SELECT`, `INSERT`, `UPDATE` (nunca `DELETE`, `DROP`, `ALTER`, `CREATE`). Não use o usuário de administração do banco.

```bash
sudo apt-get update
sudo apt-get install -y postgresql redis-server rsync openssl curl mariadb-client postgresql-client
sudo systemctl enable --now postgresql redis-server
# Redis só local (confira "bind 127.0.0.1" e "protected-mode yes"):
grep -E '^(bind|protected-mode)' /etc/redis/redis.conf
```

## 2. Usuário de serviço e pastas

```bash
# Usuário sem login e sem shell: roda a API e mais nada.
sudo adduser --system --group --no-create-home --shell /usr/sbin/nologin fadasdobem-api

sudo install -d -o root -g root -m 755 /opt/fadasdobem-api /opt/fadasdobem-api/releases
sudo install -d -o root -g fadasdobem-api -m 750 /etc/fadasdobem-api          # arquivo de ambiente
sudo install -d -o fadasdobem-api -g fadasdobem-api -m 750 /var/lib/fadasdobem-api /var/lib/fadasdobem-api/uploads
sudo install -d -o root -g root -m 700 /var/backups/fadasdobem /var/backups/fadasdobem/legado /var/backups/fadasdobem/postgres
```

## 3. Banco PostgreSQL e usuário

A senha é digitada no prompt do `psql`; ela não aparece no histórico nem em arquivo do repositório.

```bash
sudo -u postgres psql -c "CREATE ROLE fadasdobem_api LOGIN;"
sudo -u postgres psql -c "\password fadasdobem_api"          # digite <SEGREDO> (será o DB_PASSWORD)
sudo -u postgres createdb -O fadasdobem_api -E UTF8 fadasdobem_api
# Confirme que o PostgreSQL só escuta localhost (listen_addresses) e que pg_hba.conf exige senha (scram-sha-256) para 127.0.0.1.
```

## 4. Código da API

Copie SEM `node_modules`, `.env`, `.local-dev`, `uploads`, `.git`. A partir da máquina de quem prepara a versão (o pacote vai por `scp`/`rsync` com o usuário próprio na VPS):

```bash
# Na máquina de desenvolvimento, dentro de Fadasdobem--API:
VERSAO="$(date +%Y%m%d-%H%M)"
rsync -a --delete \
  --exclude node_modules --exclude .env --exclude '.env.*' --exclude .local-dev \
  --exclude uploads --exclude .git --exclude '*.log' \
  ./ "<usuario>@<vps-producao>:/tmp/api-$VERSAO/"
```

Na VPS:

```bash
VERSAO=<a mesma versão>
sudo mv /tmp/api-$VERSAO /opt/fadasdobem-api/releases/$VERSAO
cd /opt/fadasdobem-api/releases/$VERSAO

# Dependências de produção, exatamente as do package-lock.json (sem devDependencies).
sudo npm ci --omit=dev --no-audit --no-fund

# Uploads ficam fora da versão (a unidade systemd só permite escrita em /var/lib/fadasdobem-api).
sudo rm -rf uploads && sudo ln -s /var/lib/fadasdobem-api/uploads uploads

sudo chown -R root:root /opt/fadasdobem-api/releases/$VERSAO     # o serviço só LÊ o código
sudo ln -sfn /opt/fadasdobem-api/releases/$VERSAO /opt/fadasdobem-api/current
```

## 5. Variáveis de ambiente

```bash
sudo cp /opt/fadasdobem-api/current/deploy/api.env.example /etc/fadasdobem-api/api.env
sudo chmod 600 /etc/fadasdobem-api/api.env
sudoedit /etc/fadasdobem-api/api.env      # preencha DB_PASSWORD, LEGADO_DB_* e confira cada bloco

# JWT e CSRF aleatórios, direto no arquivo (nada é impresso):
sudo /opt/fadasdobem-api/current/deploy/gerar-segredos.sh /etc/fadasdobem-api/api.env

# O serviço lê o arquivo; "outros" não.
sudo chown root:fadasdobem-api /etc/fadasdobem-api/api.env
sudo chmod 640 /etc/fadasdobem-api/api.env
```

Pontos de atenção (a lista completa está comentada no `api.env.example`):

- `NODE_ENV=production`, `GATE_SESSAO=nativa`, `DADOS_TESTE_ENABLED=false`, `TRUST_PROXY=true`.
- `FADAS_ORIGIN` e `CORS_ORIGINS` = endereço público exato do front (sem barra final). Divergência quebra login e gravações.
- ETAPA 0: todas as `GF_FATIA_*` ligadas e **todas as `GF_LEGADO_*` em `false`**, `GF_LEGADO_ESCRITA_BANCOS` vazia, `LEGADO_DB_READ_ONLY=true`.
- Formato: sem aspas, sem espaço ao redor do `=`. Senha com caracteres especiais costuma exigir cuidado: prefira senhas alfanuméricas longas.

## 6. Migrações (banco novo)

A API também migra ao subir (`app.js` chama `runMigrations()`), mas rode antes à mão para ver o resultado e evitar subir com erro. As migrações são aditivas e idempotentes; nenhuma toca o MySQL legado.

```bash
sudo -u fadasdobem-api bash -c '
  set -a; . /etc/fadasdobem-api/api.env; set +a
  cd /opt/fadasdobem-api/current
  npm run migrate
'
# Catálogo de papéis de acesso (administradora, assistente, supervisora, atendente...): necessário para criar contas.
sudo -u fadasdobem-api bash -c '
  set -a; . /etc/fadasdobem-api/api.env; set +a
  cd /opt/fadasdobem-api/current
  npm run seed:access
'
```

**Primeira administradora (ambiente novo, sem nenhuma conta).** O `contas:equipe` exige uma administradora ativa para assinar, e o `seed:access` só atribui o papel a quem já existe. Crie a primeira assim (ensaio por padrão; recusa se já houver administradora ativa):

```bash
sudo -u fadasdobem-api bash -c '
  set -a; . /etc/fadasdobem-api/api.env; set +a
  cd /opt/fadasdobem-api/current
  node scripts/criar-primeira-administradora.js --nome="<Nome>" --email=<e-mail> \
    --saida=/var/lib/fadasdobem-api/credenciais-primeira.csv --confirmo-producao            # ensaio
  # confira e repita com --executar; leia a senha temporária só no arquivo de saída (modo 600) e apague-o depois
'
```

Faça `deploy/backup-postgres.sh` ANTES de qualquer migração em produção depois da primeira instalação (ver seção 12).

## 7. Serviço systemd

```bash
sudo cp /opt/fadasdobem-api/current/deploy/fadasdobem-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now fadasdobem-api
sudo systemctl status fadasdobem-api --no-pager
```

A unidade usa `Restart=on-failure`, `NoNewPrivileges`, `ProtectSystem=strict` (só `/var/lib/fadasdobem-api` é gravável), `PrivateTmp`, `ProtectHome` e outros. Se a API não subir, veja a seção 10.

## 8. Nginx

Abra o `server {}` do domínio (mantido pelo Lucas), cole o conteúdo de `nginx-api.conf.snippet` e valide:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

O trecho encaminha `/api/` e `/socket.io/` para `127.0.0.1:4010`, repassa `X-Forwarded-*`, define `proxy_read_timeout`, liga WebSocket, limita o corpo a 8 MB e devolve 404 para `/dados-teste`, `/uploads/`, `/health` e `/ping`. Antes, confirme com o Lucas que o bloco do front não usa `/api` para outro destino.

## 9. Contas de login da equipe

Em produção a B tem 1 conta; todas as pessoas precisam existir na API A. Primeira administradora: deve existir um usuário `GESTORA` (a dona) com o papel `admin` (rode `seed:access` com `SEED_GESTORA_EMAIL` ou `SEED_GESTORA_USER_ID` apontando para ela). Depois, com a lista num arquivo FORA do repositório:

```bash
# Ensaio (padrão): só mostra o que faria.
sudo -u fadasdobem-api bash -c '
  cd /opt/fadasdobem-api/current
  node scripts/criar-contas-equipe.js /caminho/fora/do/repo/equipe.csv \
       --saida=/caminho/fora/do/repo/credenciais.csv --env=/etc/fadasdobem-api/api.env --confirmo-producao'
# Gravar de verdade: acrescente --executar. As senhas temporárias vão SÓ para o arquivo --saida (modo 600).
```

Entregue cada senha em canal seguro e apague o arquivo. Detalhes e campos: cabeçalho de `scripts/criar-contas-equipe.js`.

## 10. Verificação e logs

```bash
# Smoke test só de leitura (etapa 0). Rode na VPS, com o arquivo de ambiente, para provar as flags do legado:
node /opt/fadasdobem-api/current/deploy/checar-implantacao.js --etapa=0 \
     --base=https://gestao.fadasdobem.com.br --env-arquivo=/etc/fadasdobem-api/api.env

# À mão:
curl -s http://127.0.0.1:4010/api/ops/health          # direto na API
curl -s https://gestao.fadasdobem.com.br/api/ops/health   # pelo Nginx
curl -s -o /dev/null -w '%{http_code}\n' https://gestao.fadasdobem.com.br/dados-teste   # deve ser 404

# Logs:
sudo journalctl -u fadasdobem-api -n 100 --no-pager
sudo journalctl -u fadasdobem-api -f
sudo tail -n 50 /var/log/nginx/error.log
```

Se `/api/ops/health` responder 503: `database-unavailable` = a API não alcança o legado (IP, usuário, senha, host); `schema-incompatible` = faltam tabelas que o health exige no legado (ver "Pendências" em `Maturacao/54`); `configuration-unavailable` = `LEGADO_DB_*` incompleto.

## 11. Atualização (nova versão)

```bash
# 1) Backup do banco novo ANTES (e do legado, se a versão mexe na escrita no legado; ver Maturacao/54).
sudo /opt/fadasdobem-api/current/deploy/backup-postgres.sh --banco=fadasdobem_api --destino=/var/backups/fadasdobem/postgres --via-postgres

# 2) Copie a nova versão para /opt/fadasdobem-api/releases/<nova> (seção 4), npm ci, ln -s uploads.
# 3) Migre com a nova versão ANTES de trocar o link (seção 6, apontando o cd para a pasta nova).
# 4) Troca atômica e reinício:
sudo ln -sfn /opt/fadasdobem-api/releases/<nova> /opt/fadasdobem-api/current
sudo systemctl restart fadasdobem-api
# 5) Prove:
node /opt/fadasdobem-api/current/deploy/checar-implantacao.js --etapa=<etapa atual> --base=https://gestao.fadasdobem.com.br --env-arquivo=/etc/fadasdobem-api/api.env
```

Mantenha as 3 últimas pastas em `releases/`; apague as mais antigas.

## 12. Backups (agendar)

```bash
# Legado (somente leitura). O .cnf fica FORA do repositório, modo 600, só com host/porta/usuário/senha do usuário de leitura.
sudo /opt/fadasdobem-api/current/deploy/backup-legado.sh \
     --defaults-file=/etc/fadasdobem-api/legado-backup.cnf --banco=fadasdobem \
     --destino=/var/backups/fadasdobem/legado --manter=14

# Novo (PostgreSQL):
sudo /opt/fadasdobem-api/current/deploy/backup-postgres.sh --banco=fadasdobem_api \
     --destino=/var/backups/fadasdobem/postgres --manter=14 --via-postgres
```

Para agendar (diário, madrugada), use um `systemd timer` ou `cron` do root chamando os mesmos comandos. Leve uma cópia para fora da VPS (a esteira do Lucas usa backups cifrados com age na OCI; combine o destino com ele). Prove a restauração com `restaurar-teste.md`.

## 13. Reversão

| Situação | O que fazer |
|---|---|
| Versão nova com defeito | `sudo ln -sfn /opt/fadasdobem-api/releases/<anterior> /opt/fadasdobem-api/current && sudo systemctl restart fadasdobem-api`. As migrações são aditivas: o código anterior as ignora. |
| Defeito de configuração | Corrija `/etc/fadasdobem-api/api.env` e `sudo systemctl restart fadasdobem-api`. |
| Desligar só a escrita no legado | Em `api.env`: `GF_LEGADO_ESCRITA_ENABLED=false` e `sudo systemctl restart fadasdobem-api` (detalhe e consequências em `Maturacao/54`). |
| Tirar a API do ar sem mexer no front | Comente os dois `location` do snippet no Nginx, `nginx -t`, `reload`; ou `sudo systemctl stop fadasdobem-api`. O ASP não é afetado. |
| Restaurar o banco novo | Só por decisão do Patrick e em banco novo vazio (`restaurar-teste.md`, adaptado). O legado NUNCA é restaurado por este roteiro. |

## 14. Checklist de segurança

- [ ] `api.env` fora do repositório, `root:fadasdobem-api`, modo 640; sem segredo em chat/commit.
- [ ] `DADOS_TESTE_ENABLED=false` e `/dados-teste` devolve 404 pelo Nginx.
- [ ] `GATE_SESSAO=nativa`; `NODE_ENV=production`.
- [ ] PostgreSQL e Redis só em `127.0.0.1`.
- [ ] Usuário do banco legado dedicado, sem DDL e sem DELETE; IP da VPS liberado; porta 3306 não aberta a "qualquer IP" (peça ao Lucas/Nice).
- [ ] Backups em pasta 700, fora do repositório, com SHA-256; restauração provada em banco de teste.
- [ ] Usuário `fadasdobem-api` sem login; código somente leitura para ele.
