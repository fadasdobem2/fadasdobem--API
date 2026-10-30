#!/usr/bin/env bash
# Backup do banco NOVO da API A (PostgreSQL) com pg_dump em formato custom (-Fc).
# Credenciais: use o usuário "postgres" do sistema (--via-postgres, sem senha) OU ~/.pgpass / PGPASSFILE do operador.
# Nunca coloque senha na linha de comando. Nunca grava dentro do repositório.
#
# Uso:
#   deploy/backup-postgres.sh --banco=fadasdobem_api --destino=/var/backups/fadasdobem/postgres [--manter=14] [--via-postgres]
#   (sem --via-postgres: usa PGHOST/PGPORT/PGUSER do ambiente e o .pgpass)
set -euo pipefail
umask 077

BANCO=""; DESTINO=""; MANTER=14; VIA=""
for A in "$@"; do
  case "$A" in
    --banco=*) BANCO="${A#*=}" ;;
    --destino=*) DESTINO="${A#*=}" ;;
    --manter=*) MANTER="${A#*=}" ;;
    --via-postgres) VIA="sudo -u postgres" ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "Argumento desconhecido: $A" >&2; exit 2 ;;
  esac
done
[[ -n "$BANCO" && -n "$DESTINO" ]] || { echo "Informe --banco= e --destino=." >&2; exit 2; }
[[ "$BANCO" =~ ^[A-Za-z0-9_]+$ ]] || { echo "Nome de banco inválido." >&2; exit 2; }
[[ "$MANTER" =~ ^[0-9]+$ && "$MANTER" -ge 1 ]] || { echo "--manter deve ser inteiro >= 1." >&2; exit 2; }
command -v pg_dump >/dev/null || { echo "pg_dump não encontrado (instale postgresql-client)." >&2; exit 2; }
if command -v sha256sum >/dev/null; then SHA() { sha256sum "$1" | cut -d' ' -f1; }; else SHA() { shasum -a 256 "$1" | cut -d' ' -f1; }; fi

mkdir -p "$DESTINO"; chmod 700 "$DESTINO"
if git -C "$DESTINO" rev-parse --is-inside-work-tree >/dev/null 2>&1; then echo "Recusado: destino dentro de um repositório git." >&2; exit 2; fi

CARIMBO="$(date +%Y%m%d-%H%M%S)"
SAIDA="$DESTINO/postgres-${BANCO}-${CARIMBO}.dump"
PARCIAL="${SAIDA}.parcial"
trap 'rm -f "$PARCIAL"' EXIT
echo "Início: $(date '+%d/%m/%Y %H:%M:%S')  banco: $BANCO"
# shellcheck disable=SC2086
$VIA pg_dump -Fc --no-owner "$BANCO" > "$PARCIAL"
mv "$PARCIAL" "$SAIDA"; trap - EXIT
printf '%s  %s\n' "$(SHA "$SAIDA")" "$(basename "$SAIDA")" > "${SAIDA}.sha256"
chmod 600 "$SAIDA" "${SAIDA}.sha256"
# pg_restore --list só lê o índice do arquivo (prova que ele abre); mostra apenas a contagem.
ITENS="$(pg_restore --list "$SAIDA" | grep -vc '^;' || true)"
echo "Arquivo:   $SAIDA"
echo "Tamanho:   $(du -h "$SAIDA" | cut -f1)"
echo "SHA-256:   $(cut -d' ' -f1 "${SAIDA}.sha256")"
echo "Itens no índice do dump: $ITENS"
ls -1 "$DESTINO"/postgres-"${BANCO}"-*.dump 2>/dev/null | sort -r | tail -n +"$((MANTER + 1))" | while IFS= read -r F; do
  [[ -n "$F" ]] && rm -f -- "$F" "${F}.sha256" && echo "Removida cópia antiga: $(basename "$F")"
done
echo "Concluído: $(date '+%d/%m/%Y %H:%M:%S')."
