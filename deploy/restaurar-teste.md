# Provar que o backup restaura (em banco de TESTE, nunca em produção)

Um backup que nunca foi restaurado não é backup. Esta prova roda num servidor/banco **descartável**. Regras:

- **Nunca** restaure sobre o banco `fadasdobem` (legado de produção), nem sobre `fadasdobem01`/`fadasdobem02`, nem sobre o banco `fadasdobem_api` em uso.
- Use um MariaDB/MySQL LOCAL ou numa máquina de teste (não o servidor gerenciado da KingHost) e um PostgreSQL com banco de nome `restore_teste_*`.
- O backup do legado contém dados pessoais: faça a prova em máquina de confiança e apague tudo ao fim.
- Não cole credenciais nem conteúdo de tabelas em chat. Registre só contagens e "bateu / não bateu".

## A. Legado (MySQL/MariaDB)

```bash
ARQ=/var/backups/fadasdobem/legado/legado-fadasdobem-<carimbo>.sql.gz

# 1) A cópia está íntegra? (o SHA-256 gravado no backup deve bater)
cd /var/backups/fadasdobem/legado && sha256sum -c "$(basename "$ARQ").sha256"

# 2) Servidor de teste local (exemplo com Docker; qualquer MariaDB 10.6 descartável serve):
docker run -d --name restore-teste -e MARIADB_RANDOM_ROOT_PASSWORD=1 -e MARIADB_DATABASE=restore_teste \
       -e MARIADB_USER=teste -e MARIADB_PASSWORD='<SEGREDO-DE-TESTE>' -p 127.0.0.1:3307:3306 mariadb:10.6

# 3) O dump criado com --databases traz "CREATE DATABASE ... fadasdobem / USE". Troque o nome para o banco de TESTE
#    ANTES de importar, para jamais criar/usar um banco chamado "fadasdobem":
gzip -dc "$ARQ" | sed -e 's/`fadasdobem`/`restore_teste`/g' > /tmp/restore.sql
grep -c '^CREATE TABLE' /tmp/restore.sql

# 4) Importe (host 127.0.0.1, porta 3307, o servidor descartável):
mysql -h 127.0.0.1 -P 3307 -u teste -p restore_teste < /tmp/restore.sql        # pede a senha de teste

# 5) Conferência por contagem (compare com o banco de origem, lado a lado, só números):
mysql -h 127.0.0.1 -P 3307 -u teste -p restore_teste -e "
  SELECT COUNT(*) AS tabelas FROM information_schema.TABLES WHERE TABLE_SCHEMA='restore_teste';
  SELECT 'usuarios' t, COUNT(*) n FROM usuarios UNION ALL SELECT 'tbl_consultas', COUNT(*) FROM tbl_consultas
  UNION ALL SELECT 'tbl_pagtoinformado', COUNT(*) FROM tbl_pagtoinformado UNION ALL SELECT 'tbl_tarologos', COUNT(*) FROM tbl_tarologos;"
```

Critério: o número de tabelas e as contagens acima batem com a origem **no instante do backup** (a produção pode ter crescido depois; compare com uma contagem tirada na mesma janela). Anote data, tamanho, SHA-256 e o resultado.

Limpeza: `docker rm -f restore-teste && rm -f /tmp/restore.sql`.

## B. Banco novo (PostgreSQL)

```bash
ARQ=/var/backups/fadasdobem/postgres/postgres-fadasdobem_api-<carimbo>.dump
cd /var/backups/fadasdobem/postgres && sha256sum -c "$(basename "$ARQ").sha256"

createdb restore_teste_api
pg_restore --no-owner --dbname=restore_teste_api "$ARQ"

psql restore_teste_api -Atc "SELECT count(*) FROM users;"
psql restore_teste_api -Atc "SELECT count(*) FROM gf_auditoria;"
psql restore_teste_api -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';"
dropdb restore_teste_api
```

Critério: restaura sem erro e as contagens batem com o banco de origem na hora do backup.

## C. Registro da prova

Escreva (fora do repositório) uma linha por prova: data, qual backup (nome do arquivo e SHA-256), onde restaurou, contagens conferidas, resultado, quem fez. Só considere o backup válido depois de A (legado) e B (novo) provados.
