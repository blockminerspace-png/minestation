#!/usr/bin/env bash
# Migrações Prisma com Postgres só na rede Docker (host @ localhost:5432 falha).
# Uso na VM: cd app_production && bash migrate-db.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
docker compose exec -T app sh -c 'cd /app/backend && npm run migrate:deploy'
