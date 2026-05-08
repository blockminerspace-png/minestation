#!/usr/bin/env bash
# Deploy na VM: git pull + docker compose build na pasta de produção + SQL/manutenção opcional.
# Credenciais / IP: copia `scripts/deploy.vm.env.example` → `scripts/deploy.vm.env` e edita.
#
# Uso (na raiz do repo):
#   bash scripts/deploy-vm.sh
#   VM_DEPLOY=0 bash scripts/deploy-vm.sh   # só manutenção na BD, sem rebuild
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$ROOT/scripts/deploy.vm.env" ]]; then
  echo "Cria o ficheiro scripts/deploy.vm.env (ver scripts/deploy.vm.env.example)." >&2
  echo "  cp scripts/deploy.vm.env.example scripts/deploy.vm.env" >&2
  exit 1
fi
exec bash "$ROOT/scripts/vm-maintenance.sh" "$@"
