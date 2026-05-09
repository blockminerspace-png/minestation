#!/usr/bin/env bash
# Deploy local → VM: **git push** + SSH (`vm-maintenance.sh`: git na raiz com .git + compose em app_production + Prisma/SQL).
# Credenciais: `scripts/deploy.vm.env.example` → `scripts/deploy.vm.env` (ignorado pelo git).
# Não envia `.git` por SCP — só atualiza o clone já existente no servidor.
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

cd "$ROOT"
BR="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
if [[ "$BR" != "HEAD" ]]; then
  echo "[deploy-vm] git push origin $BR"
  git push -u origin "$BR"
else
  echo "[deploy-vm] aviso: HEAD destacado — não foi feito git push." >&2
fi

exec bash "$ROOT/scripts/vm-maintenance.sh" "$@"
