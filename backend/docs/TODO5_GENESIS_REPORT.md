# TODO 5 — Relatório técnico (Genesis Miner)

Data: 2026-05-10. Ambiente de CI/local: **Postgres não acessível** em `localhost:5432` (`ECONNREFUSED` / Prisma `P1001`). A `DATABASE_URL` efectiva vem do `.env` local (não reproduzida aqui por conter credenciais); host `localhost`, porta `5432`, base `minestation` conforme mensagem do Prisma.

## Comandos executados

- `cd backend && npm run build:ts` — OK  
- `cd backend && npm run build:server` — OK  
- `cd backend && npm run test` — **249** testes passaram; **4** ignorados (`pgIntegration.backendOptional` sem `RUN_BACKEND_PG_INTEGRATION=1`)  
- `cd frontend && npx tsc --noEmit` — OK  
- `cd backend && npx prisma generate` — OK  
- `cd backend && npx prisma migrate deploy` — **falhou** (`P1001` — servidor DB inacessível)  
- `cd backend && node scripts/battery_diagnostic_readonly.mjs` — **falhou** (`ECONNREFUSED 127.0.0.1:5432`)  
- `node scripts/battery_repair_dryrun.mjs` — não executado contra BD real (mesmo motivo)

**Correcção:** iniciar Postgres com a mesma `DATABASE_URL`, depois `npx prisma migrate deploy`, diagnóstico e suíte opcional `RUN_BACKEND_PG_INTEGRATION=1`.

---

## 1. Auditoria `requestSave()` / autosave (frontend)

| Ficheiro | Função / contexto | Domínio típico | Dado salvo | Risco | Estado crítico via save legado? | Acção neste TODO | Pendência |
|----------|-------------------|----------------|------------|-------|-----------------------------------|------------------|------------|
| `frontend/App.tsx` | `handleMintNFT` | `full` (fora servers/inventory/oficina) | `stock` | Alto | Sim (stock) | **5 — pendente com justificativa** | Migrar para rota autoritária ou bloquear sob `reject` |
| `frontend/App.tsx` | `handleBurnNFT` | idem | `stock` | Alto | Sim | idem | idem |
| `frontend/App.tsx` | `handlePlaceRack` | `servers` | `placedRacks`, `stock` | Alto | O slice `save-servers` **neutraliza** `placedRacks` a partir da BD (`neutralizeLegacySaveGameSlicePayload`); o cliente não tem autoridade de persistência crítica | **5 — pendente real** | UX ainda chama `requestSave`; a topologia de rigs deve passar por intents dedicados se o fluxo tiver de ser 100% explícito no cliente |
| `frontend/App.tsx` | `handleRemoveRack` | `servers` | idem | Alto | idem | idem | idem |
| `frontend/App.tsx` | `handleEquipMiner` / `handleUnequipMiner` | `servers` | `placedRacks`, `stock` | Alto | idem | idem | idem |
| `frontend/App.tsx` | `handleTogglePower` / `handleRecharge` / `handleSetRackCoin` | `servers` | `placedRacks` | Médio | Neutralizado no servidor | **4 — preferência visual / UX** até intents cobrirem 100% | Persistência real já não confia no payload do cliente |
| `frontend/App.tsx` | `handleReset` | `full` | estado inicial | Alto | Sim se payload incluir chaves críticas | **5 — pendente** | Reset deve ser rota servidor |
| `frontend/App.tsx` | `handleWithdrawCoin` (após sucesso API) | `full` | `coinBalances` | Alto | Sim | **5 — pendente** | Saldo moedas deve reflectir só GET/API |
| `frontend/App.tsx` | `runPlayerSaveWithRetries` / `requestSave` / `saveTrigger` | — | pipeline autosave | — | Encaminha para `saveGameState` | **3 — mantido** | Tratamento de erros melhorado para `LEGACY_SAVEGAME_CRITICAL_REJECTED` e idempotência |
| `frontend/services/api.ts` | `saveGameState` | slices ou full | payload HTTP | — | Slices com header `X-Game-Save-Domain` | **3** | Full save ainda envia `changes` amplos (política `strip`/`reject`) |
| `frontend/components/AdminUsers.tsx` | `saveGameStateAdminOverride` | admin | estado alvo | Controlado | Override administrativo | **4 — admin override dedicado** | — |
| Backend | `POST /api/save-game`, `save-*` | ver `legacySaveGamePlayerPolicy` | fusão + neutralização | — | Ver código | **2/3** conforme rota | `recoverOrphanRackBatteryStorageRows` só com `ORPHAN_RACK_BATTERY_AUTO_RECOVER` |

Handlers **já migrados** para intents (exemplos): `postServersRackAuxEquip`, `postServerRoomBulkBatteries`, `postServerRoomRoomCoins`, fluxos de inventário/bateria/oficina documentados no TODO 4.

---

## 2. `LEGACY_SAVEGAME_PLAYER_POLICY=reject`

- Barreira `applyLegacySaveGameFullBarrier` devolve `422` + `LEGACY_SAVEGAME_CRITICAL_REJECTED` e lista `fields` (sem payload em log; evento JSON estruturado).  
- Chaves críticas alargadas: `batteryId`, `rackId`, `slotId`, `currentCharge` (topo e `gameState.*`).  
- Testes: `legacySaveGamePlayerPolicy.test.ts` (+ detecção de `batteryId`/`rackId`).  
- Frontend: autosave mostra alerta específico e recarrega estado em falha dura.

---

## 3. Idempotência financeira — `POST /api/shop/checkout`

- **Rota escolhida:** `POST /api/shop/checkout` (alto risco double-click no carrinho).  
- `runHardwareCheckoutTransaction`: lock transacional `pg_advisory_xact_lock` por `(userId, 'shop_checkout', idempotencyKey)`; registo de `request_fingerprint` (hash estável do carrinho); replay com carrinho vazio após sucesso; **409** + `IDEMPOTENCY_PAYLOAD_MISMATCH` se carrinho não vazio e fingerprint ≠ gravado.  
- Insert de idempotência **dentro** da mesma transação que débito/stock.  
- Carrinho vazio + `idempotencyKey`: permite replay (correção face a 422 antecipado).  
- Helper: `shopCheckoutCartFingerprint` + documentação em `gameIntentIdempotencyPrisma.ts`.  
- Testes: `shopCheckoutCartFingerprint` em `itemUseAndWalletFingerprints.test.ts`.

---

## 4. `items/use`

- Regra real mantida: voucher de energia (`reward_wh` + carregador oficina).  
- Bateria: `422` + mensagem segura (não usar esta rota).  
- Sem regra: `422` + `ITEM_USE_NOT_SUPPORTED` + texto *Este item ainda não possui uso direto disponível.*  
- **409** conflito de versão: código `STATE_VERSION_CONFLICT` quando a mensagem indica estado desactualizado.

---

## 5. `recoverOrphanRackBatteryStorageRows`

- GET `game-state`: recuperação só se `ORPHAN_RACK_BATTERY_AUTO_RECOVER`; caso contrário log `game_state_get_orphan_rack_battery`.  
- `validatePlacedRacksForSave`: idem + log `legacy_save_orphan_risk_scan`.  
- Testes existentes: `orphanRackBatteryRecoveryGate.test.ts`.

---

## 6. `repair --apply`

- Script `battery_repair_dryrun.mjs`: após `--apply`, log JSON `battery_repair_apply_audit` com `summaryBefore` / `summaryAfter` (relatório read-only).  
- `ensureStoredBatteriesIntegrity` mantém-se como transação única no serviço (granularidade por acção completa exigiria refactor maior).

---

## 7. Suíte Postgres opcional

- Ficheiro: `backend/test/pgIntegration.backendOptional.test.ts`.  
- Condição: `RUN_BACKEND_PG_INTEGRATION=1` **e** `DATABASE_URL` definida.  
- Smoke: ligação, colunas `request_fingerprint` em `shop_checkout_idempotency` e `wallet_idempotency`, existência do script de diagnóstico.

---

## 8. Pendências honestas

- Validar migrations + diagnóstico + repair dry-run contra **Postgres real** quando o serviço estiver UP.  
- Expandir suíte PG com dados de teste (baterias, inventário, ledger) — hoje só smoke de schema/conexão.  
- Migrar handlers de `requestSave` que ainda mutam `stock`/`placedRacks`/`coinBalances` no cliente para intents ou bloquear com UX clara.  
- Teste manual duas abas: não executado (sem jogo + DB neste ambiente).
