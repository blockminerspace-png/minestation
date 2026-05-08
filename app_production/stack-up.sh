#!/usr/bin/env bash
# Arranca a stack completa de app_production/ com nomes de produção.
# Uso na VM: cd app_production && bash stack-up.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"
echo "Compose: $(pwd)/docker-compose.yml"
echo "Serviços: $(docker compose config --services | paste -sd' ' -)"
EXPECTED_SERVICES=7
SVC_COUNT="$(docker compose config --services 2>/dev/null | wc -l | tr -d ' ')"
if [[ "${SVC_COUNT:-0}" -lt 7 ]]; then
  echo "AVISO: este compose tem só ${SVC_COUNT} serviço(s). O ficheiro na VM pode ser antigo (só db+app+nginx)."
  echo "Garante que estás a usar o docker-compose.yml do repositório (com redis, mongo, bull-worker)."
fi
docker compose up -d --build
echo "--- docker compose ps -a ---"
docker compose ps -a
RUNNING="$(docker compose ps --status running -q 2>/dev/null | wc -l | tr -d ' ')"
echo "Contentores em execução: ${RUNNING:-0} (esperados: ${EXPECTED_SERVICES})"
if [[ "${RUNNING:-0}" -lt 5 ]]; then
  echo "Se só aparecem nginx/app/postgres, substitui o compose na VM pelo deste repo e volta a correr este script."
fi
if [[ "${RUNNING:-0}" -lt 7 ]]; then
  echo "Dica: docker compose logs redis --tail 40 ; docker compose logs mongo --tail 40"
  echo "Dica: docker compose logs app --tail 100 ; docker compose logs bull-worker --tail 80"
fi
