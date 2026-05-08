#!/usr/bin/env bash
# Deploy na VM (git pull + compose build) e manutenção na BD Postgres **dentro do Docker**
# (não precisa de expor a porta 5432 no host — usa `docker exec` no servidor).
#
# Variáveis no `.env` na **raiz** do repo (ou exportadas no shell):
#   SSH_HOST ou VM_HOST  — obrigatório (IP ou hostname da VM)
#   SSH_USER             — default: root
#   SSH_PORT             — default: 2222
#   REMOTE_REPO_DIR      — se vazio, detecta na VM (prioridade: app_production)
#   PG_CONTAINER         — se vazio, detecta postgres_app ou app-postgres em docker ps
#   PG_DATABASE          — default: minestation
#   APP_SERVICE          — serviço compose da API Node — default: app
#   VM_DEPLOY=0          — só corre SQL + scripts Node, sem git pull / compose build
#   SSH_PASSWORD         — opcional: palavra-passe SSH (só no teu .env local); requer `sshpass` no PATH
#
# Uso: bash scripts/vm-maintenance.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi
if [[ -f "$ROOT/scripts/deploy.vm.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/scripts/deploy.vm.env"
  set +a
fi

SSH_HOST="${SSH_HOST:-${VM_HOST:-}}"
if [[ -z "$SSH_HOST" ]]; then
  echo "Erro: defina SSH_HOST ou VM_HOST no ficheiro .env na raiz do repositório." >&2
  exit 1
fi

SSH_USER="${SSH_USER:-root}"
SSH_PORT="${SSH_PORT:-2222}"
REMOTE_REPO_DIR="${REMOTE_REPO_DIR:-}"
PG_CONTAINER="${PG_CONTAINER:-}"
PG_DATABASE="${PG_DATABASE:-minestation}"
APP_SERVICE="${APP_SERVICE:-app}"
VM_DEPLOY="${VM_DEPLOY:-1}"

SSH_BASE=( -p "$SSH_PORT" -o ConnectTimeout=25 -o ServerAliveInterval=15 -o StrictHostKeyChecking=accept-new )

remote() {
  if [[ -n "${SSH_PASSWORD:-}" ]] && command -v sshpass >/dev/null 2>&1; then
    SSHPASS="$SSH_PASSWORD" sshpass -e ssh "${SSH_BASE[@]}" \
      -o PreferredAuthentications=password,keyboard-interactive \
      -o PubkeyAuthentication=no \
      "$SSH_USER@$SSH_HOST" "$@"
  else
    ssh "${SSH_BASE[@]}" "$SSH_USER@$SSH_HOST" "$@"
  fi
}

if [[ -z "${REMOTE_REPO_DIR}" ]]; then
  REMOTE_REPO_DIR="$(
    remote bash -lc 'for d in /root/minestation/app_production /root/app_production /root/minestation; do
      [[ -f "$d/docker-compose.yml" ]] && echo "$d" && exit 0; done; exit 1' || true
  )"
fi
if [[ -z "${REMOTE_REPO_DIR}" ]]; then
  REMOTE_REPO_DIR="/root/minestation/app_production"
fi

if [[ -z "${PG_CONTAINER}" ]]; then
  PG_CONTAINER="$(
    remote bash -lc "docker ps --format '{{.Names}}' | grep -iE '^postgres_app\$|^app-postgres\$' | head -1" || true
  )"
fi
if [[ -z "${PG_CONTAINER}" ]]; then
  PG_CONTAINER="postgres_app"
fi

echo "[vm-maintenance] Alvo: ${SSH_USER}@${SSH_HOST}:${SSH_PORT} | repo remoto: ${REMOTE_REPO_DIR} | PG: ${PG_CONTAINER}/${PG_DATABASE}"
if [[ -n "${SSH_PASSWORD:-}" ]] && ! command -v sshpass >/dev/null 2>&1; then
  echo "Aviso: SSH_PASSWORD definido mas sshpass não está instalado (ex.: sudo apt install sshpass)." >&2
fi

if [[ "$VM_DEPLOY" == "1" ]]; then
  echo "[vm-maintenance] deploy: git pull + docker compose up -d --build"
  remote bash -lc "set -euo pipefail; cd $(printf '%q' "$REMOTE_REPO_DIR"); git pull --ff-only || git pull; docker compose up -d --build"
else
  echo "[vm-maintenance] deploy omitido (VM_DEPLOY=0)"
fi

echo "[vm-maintenance] SQL: integridade stored_batteries / placed_racks"
if [[ ! -f "$ROOT/backend/scripts/ensure_stored_batteries_integrity.sql" ]]; then
  echo "Falta $ROOT/backend/scripts/ensure_stored_batteries_integrity.sql" >&2
  exit 1
fi
remote docker exec -i "$PG_CONTAINER" psql -U postgres -d "$PG_DATABASE" -v ON_ERROR_STOP=1 \
  <"$ROOT/backend/scripts/ensure_stored_batteries_integrity.sql"

echo "[vm-maintenance] Node: rewrite-img-paths-after-reorg.mjs"
remote bash -lc "set -euo pipefail; cd $(printf '%q' "$REMOTE_REPO_DIR"); docker compose exec -T $(printf '%q' "$APP_SERVICE") sh -c 'cd /app/backend && node scripts/rewrite-img-paths-after-reorg.mjs'"

echo "[vm-maintenance] Node: repair-infra-rack-images.mjs"
remote bash -lc "set -euo pipefail; cd $(printf '%q' "$REMOTE_REPO_DIR"); docker compose exec -T $(printf '%q' "$APP_SERVICE") sh -c 'cd /app/backend && node scripts/repair-infra-rack-images.mjs'"

echo "[vm-maintenance] Node: normalize-db-public-asset-urls.mjs"
remote bash -lc "set -euo pipefail; cd $(printf '%q' "$REMOTE_REPO_DIR"); docker compose exec -T $(printf '%q' "$APP_SERVICE") sh -c 'cd /app/backend && node scripts/normalize-db-public-asset-urls.mjs'"

echo "[vm-maintenance] concluído."
