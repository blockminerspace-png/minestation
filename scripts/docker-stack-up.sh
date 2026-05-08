#!/usr/bin/env bash
# Arranca os 5 serviços do compose da raiz (db, redis, mongo, app, bull-worker).
# Uso na VM: a partir da raiz do repositório: bash scripts/docker-stack-up.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
echo "Compose: $COMPOSE_FILE (cwd: $REPO_ROOT)"
echo "Serviços definidos: $(docker compose config --services | paste -sd' ' -)"
docker compose up -d --build db redis mongo app bull-worker
echo "--- docker compose ps -a ---"
docker compose ps -a
RUNNING="$(docker compose ps --status running -q 2>/dev/null | wc -l | tr -d ' ')"
echo "Contentores em execução: ${RUNNING:-0} (esperado com compose da raiz: 5)"
if [[ "${RUNNING:-0}" -lt 5 ]]; then
  echo "Dica: ver saídas — docker compose logs app --tail 100 ; docker compose logs bull-worker --tail 100"
fi
