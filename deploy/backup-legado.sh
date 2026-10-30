#!/usr/bin/env bash
# Backup LÓGICO (somente leitura) do banco legado ASP32, por mysqldump.
#  - lê host, usuário e senha de um arquivo --defaults-extra-file informado em tempo de execução (nunca na linha de comando);
#  - não escreve NADA no banco; só SELECT (--single-transaction --quick --routines=false);
#  - compacta, grava SHA-256, mostra tamanho e só contagens (tabelas e instruções), nunca conteúdo;
#  - guarda as N cópias mais recentes; NUNCA grava dentro do repositório.
#
# Uso:
#   deploy/backup-legado.sh --defaults-file=/caminho/fora/do/repo/legado.cnf --banco=fadasdobem \
#       --destino=/var/backups/fadasdobem/legado [--manter=14] [--secao=client-leitura]
#
# O arquivo .cnf tem este formato (não versionar, modo 600). Exemplo SEM valores reais:
#   [client]
#   host=<host>
#   port=3306
#   user=<usuario>
#   password=<SEGREDO>
# Se o arquivo tiver várias seções, use --secao=<nome> (vira --defaults-group-suffix; a seção deve se chamar client<sufixo>).
#
# Atenção: --single-transaction só dá cópia consistente nas tabelas InnoDB. tbl_tarologos e os catálogos são MyISAM
# (pequenos). Rode na janela de baixa atividade (madrugada) para evitar diferença entre tabelas.
set -euo pipefail
umask 077

DEFAULTS=""; BANCO=""; DESTINO=""; MANTER=14; SECAO=""
for A in "$@"; do
  case "$A" in
    --defaults-file=*) DEFAULTS="${A#*=}" ;;
    --banco=*) BANCO="${A#*=}" ;;
    --destino=*) DESTINO="${A#*=}" ;;
    --manter=*) MANTER="${A#*=}" ;;
    --secao=*) SECAO="${A#*=}" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $A" >&2; exit 2 ;;
  esac
done
[[ -n "$DEFAULTS" && -f "$DEFAULTS" ]] || { echo "Informe --defaults-file=<arquivo .cnf existente>." >&2; exit 2; }
[[ -n "$BANCO" ]] || { echo "Informe --banco=<nome do banco legado>." >&2; exit 2; }
[[ -n "$DESTINO" ]] || { echo "Informe --destino=<pasta de backups, fora do repositório>." >&2; exit 2; }
[[ "$MANTER" =~ ^[0-9]+$ && "$MANTER" -ge 1 ]] || { echo "--manter deve ser um inteiro >= 1." >&2; exit 2; }
command -v mysqldump >/dev/null || { echo "mysqldump não encontrado (instale mariadb-client ou mysql-client)." >&2; exit 2; }
command -v gzip >/dev/null || { echo "gzip não encontrado." >&2; exit 2; }
if command -v sha256sum >/dev/null; then SHA() { sha256sum "$1" | cut -d' ' -f1; }; else SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

# Nunca dentro de um repositório git (nem o destino, nem o arquivo de credenciais).
dentro_de_repo() { git -C "$(cd "$1" 2>/dev/null && pwd || dirname "$1")" rev-parse --is-inside-work-tree >/dev/null 2>&1; }
mkdir -p "$DESTINO"; chmod 700 "$DESTINO"
if dentro_de_repo "$DESTINO"; then echo "Recusado: o destino está dentro de um repositório git." >&2; exit 2; fi
if dentro_de_repo "$DEFAULTS"; then echo "Recusado: o arquivo de credenciais está dentro de um repositório git." >&2; exit 2; fi

# O arquivo de credenciais não pode ser legível por outros.
PERM="$(stat -c '%a' "$DEFAULTS" 2>/dev/null || stat -f '%Lp' "$DEFAULTS")"
case "$PERM" in 600|400) ;; *) echo "Recusado: o arquivo de credenciais deve ter modo 600 (está $PERM)." >&2; exit 2 ;; esac

CARIMBO="$(date +%Y%m%d-%H%M%S)"
BASE="$DESTINO/legado-${BANCO}-${CARIMBO}"
PARCIAL="${BASE}.sql.gz.parcial"
ERRO="$(mktemp)"
trap 'rm -f "$ERRO" "$PARCIAL"' EXIT

EXTRA=()
[[ -n "$SECAO" ]] && EXTRA+=("--defaults-group-suffix=${SECAO}")

echo "Início: $(date '+%d/%m/%Y %H:%M:%S')  banco: $BANCO"
# --defaults-extra-file precisa ser o PRIMEIRO argumento do mysqldump.
if ! mysqldump --defaults-extra-file="$DEFAULTS" ${EXTRA[@]+"${EXTRA[@]}"} \
      --single-transaction --quick --routines=false --events=false --triggers \
      --no-tablespaces --skip-lock-tables --hex-blob --default-character-set=utf8mb4 \
      --databases "$BANCO" 2>"$ERRO" | gzip -9 > "$PARCIAL"; then
  echo "FALHA no mysqldump. Mensagens (sem credenciais):" >&2
  grep -viE 'password|passwd' "$ERRO" | head -n 10 >&2 || true
  exit 1
fi
# Uma cópia completa termina com este marcador.
if ! gzip -dc "$PARCIAL" | tail -n 3 | grep -q 'Dump completed'; then
  echo "FALHA: o arquivo não termina com o marcador de dump completo. Cópia descartada." >&2; exit 1
fi
mv "$PARCIAL" "${BASE}.sql.gz"
trap 'rm -f "$ERRO"' EXIT
SAIDA="${BASE}.sql.gz"
HASH="$(SHA "$SAIDA")"
printf '%s  %s\n' "$HASH" "$(basename "$SAIDA")" > "${SAIDA}.sha256"
chmod 600 "$SAIDA" "${SAIDA}.sha256"

TAM="$(du -h "$SAIDA" | cut -f1)"
TABELAS="$(gzip -dc "$SAIDA" | grep -c '^CREATE TABLE' || true)"
INSERTS="$(gzip -dc "$SAIDA" | grep -c '^INSERT INTO' || true)"
echo "Arquivo:   $SAIDA"
echo "Tamanho:   $TAM"
echo "SHA-256:   $HASH"
echo "Tabelas:   $TABELAS   Instruções INSERT: $INSERTS   (contagens, sem conteúdo)"

# Retenção: mantém as N mais recentes.
ls -1 "$DESTINO"/legado-"${BANCO}"-*.sql.gz 2>/dev/null | sort -r | tail -n +"$((MANTER + 1))" | while IFS= read -r F; do
  [[ -n "$F" ]] && rm -f -- "$F" "${F}.sha256" && echo "Removida cópia antiga: $(basename "$F")"
done
echo "Concluído: $(date '+%d/%m/%Y %H:%M:%S'). Mantendo até $MANTER cópias. PROVE a restauração em banco de TESTE (deploy/restaurar-teste.md)."
