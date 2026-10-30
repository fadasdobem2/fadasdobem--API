#!/usr/bin/env bash
# Gera JWT_SECRET, JWT_REFRESH_SECRET e CSRF_SECRET ALEATÓRIOS direto no arquivo de ambiente.
# Nunca imprime um segredo. Só preenche o que estiver vazio ou como <SEGREDO>; não troca um segredo já preenchido
# (trocar derruba todas as sessões abertas) a não ser com --regenerar.
#
# Uso:   deploy/gerar-segredos.sh /etc/fadasdobem-api/api.env [--regenerar]
set -euo pipefail
umask 077

ARQ="${1:-}"
REGEN="nao"
[[ "${2:-}" == "--regenerar" ]] && REGEN="sim"
[[ -n "$ARQ" && -f "$ARQ" ]] || { echo "Uso: $0 <arquivo-de-ambiente> [--regenerar]" >&2; exit 2; }
command -v openssl >/dev/null || { echo "openssl não encontrado." >&2; exit 2; }

# Nunca dentro de um repositório git.
DIR="$(cd "$(dirname "$ARQ")" && pwd)"
if git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Recusado: o arquivo de ambiente está dentro de um repositório git." >&2; exit 2
fi

NOMES=(JWT_SECRET JWT_REFRESH_SECRET CSRF_SECRET)
TMP="$(mktemp "${ARQ}.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"
FEITOS=()
VISTOS=" "

while IFS= read -r LINHA || [[ -n "$LINHA" ]]; do
  SAIDA="$LINHA"
  for N in "${NOMES[@]}"; do
    if [[ "$LINHA" =~ ^${N}=(.*)$ ]]; then
      VAL="${BASH_REMATCH[1]}"
      VISTOS="$VISTOS$N "
      if [[ -z "$VAL" || "$VAL" == "<SEGREDO>" || "$REGEN" == "sim" ]]; then
        SAIDA="${N}=$(openssl rand -hex 48)"
        FEITOS+=("$N")
      fi
    fi
  done
  printf '%s\n' "$SAIDA" >> "$TMP"
done < "$ARQ"

# Nomes ausentes do arquivo são acrescentados.
for N in "${NOMES[@]}"; do
  if [[ "$VISTOS" != *" $N "* ]]; then
    printf '%s=%s\n' "$N" "$(openssl rand -hex 48)" >> "$TMP"
    FEITOS+=("$N")
  fi
done

mv -f "$TMP" "$ARQ"
trap - EXIT
chmod 600 "$ARQ"
if [[ ${#FEITOS[@]} -eq 0 ]]; then
  echo "Nada a gerar: os três segredos já estão preenchidos (use --regenerar para trocar; isso encerra as sessões)."
else
  echo "Segredos gerados (valores não exibidos): ${FEITOS[*]}"
fi
echo "Permissão do arquivo: 600. Ajuste o dono para o serviço, por exemplo:  sudo chown root:fadasdobem-api $ARQ && sudo chmod 640 $ARQ"
