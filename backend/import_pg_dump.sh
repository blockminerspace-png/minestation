#!/usr/bin/env bash
set -euo pipefail

# Restaura backup02.sql (pg_dump) no Postgres do stack principal (docker-compose.yml, serviço db).
# Por padrão encerra o Postgres duplicado do docker-compose.local.yml (down -v).
# Apaga todos os bancos não-sistema exceto postgres, depois cria só minestation e importa o dump.
# Remove trechos do PG 18 incompatíveis com Postgres 16.
#
# Uso (na pasta backend):
#   npm run import:dump
#   DUMP_PATH=/outro.sql bash import_pg_dump.sh
#   SKIP_LOCAL_DOWN=1 bash import_pg_dump.sh   # não derruba o compose local
#   COMPOSE_FILE=docker-compose.yml bash import_pg_dump.sh   # explícito (já é o default)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DUMP="${DUMP_PATH:-$ROOT/backup02.sql}"
COMPOSE_MAIN="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
COMPOSE_LOCAL="$ROOT/docker-compose.local.yml"
PG_USER="${POSTGRES_USER:-postgres}"

if [[ ! -f "$DUMP" ]]; then
  echo "Dump não encontrado: $DUMP"
  exit 1
fi

if [[ ! -f "$COMPOSE_MAIN" ]]; then
  echo "Compose não encontrado: $COMPOSE_MAIN"
  exit 1
fi

if [[ "${SKIP_LOCAL_DOWN:-}" != "1" ]] && [[ -f "$COMPOSE_LOCAL" ]]; then
  echo "Encerrando Postgres local duplicado (docker-compose.local.yml)..."
  docker compose -f "$COMPOSE_LOCAL" down -v 2>/dev/null || true
fi

echo "Subindo Postgres do site (docker-compose.yml, serviço db)..."
docker compose -f "$COMPOSE_MAIN" up -d db

CID="$(docker compose -f "$COMPOSE_MAIN" ps -q db)"
if [[ -z "$CID" ]]; then
  echo "Container do serviço 'db' não encontrado. Rode a partir da raiz do repo e confira docker compose ps."
  exit 1
fi

echo "Aguardando Postgres (container $CID)..."
for _ in $(seq 1 60); do
  if docker exec "$CID" pg_isready -U "$PG_USER" -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "Removendo bancos de usuário (fica só postgres + templates), depois minestation limpo..."
mapfile -t USER_DBS < <(docker exec "$CID" psql -U "$PG_USER" -d postgres -t -A -c \
  "SELECT datname FROM pg_database WHERE datistemplate = false AND datname <> 'postgres';")

for db in "${USER_DBS[@]}"; do
  [[ -z "${db// /}" ]] && continue
  echo "  DROP DATABASE \"$db\" ..."
  docker exec "$CID" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$db\" WITH (FORCE);"
done

docker exec "$CID" psql -U "$PG_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "CREATE DATABASE minestation OWNER $PG_USER;"

echo "Aplicando dump (pode demorar)..."
sed -e '/^\\restrict /d' -e '/^\\unrestrict /d' -e '/^SET transaction_timeout/d' "$DUMP" \
  | docker exec -i "$CID" psql -v ON_ERROR_STOP=1 -U "$PG_USER" -d minestation

echo "Importação concluída em minestation ($COMPOSE_MAIN). Dump: $DUMP"
