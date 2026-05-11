# FASE FINAL — Relatório técnico (Genesis Miner)

Data: 2026-05-10.

## 1. Postgres real, migrations, diagnóstico, repair

| Passo | Resultado |
|-------|-----------|
| `docker compose` serviço `db` | Contentor `app-postgres` com **porta publicada** `127.0.0.1:5432:5432` (ver `docker-compose.yml`) para o host alinhar com `DATABASE_URL` típica. |
| `npx prisma migrate deploy` | **OK** após `prisma migrate resolve --rolled-back 20260510160000_financial_idempotency_fingerprints` (migração renomeada/reordenada para `20260510240000_financial_idempotency_fingerprints` — aplicação **depois** de `lucky_boxes_module`). |
| `node scripts/battery_diagnostic_readonly.mjs` | **OK** — BD vazia de baterias/racks; secções sem anomalias. |
| `node scripts/battery_repair_dryrun.mjs` | **OK** (dry-run); relatório `badCatalogRows: 0`, etc. |
| `--apply` | **Não executado** (sem necessidade; evita escrita). |

**Nota:** Migração de fingerprints financeiros tem de correr **após** a criação de `lucky_box_idempotency` (timestamp `20260510240000_...`).

## 2. Testes manuais (duas abas / oficina)

**Não executados neste ambiente** (sem browser autenticado + fluxo de jogo). Com Postgres e API a correr, seguir a checklist do pedido original (Servidores / Oficina / double-click).

## 3. `LEGACY_SAVEGAME_PLAYER_POLICY=reject` em staging

Comportamento já coberto por testes unitários (`legacySaveGamePlayerPolicy.test.ts`) e alertas no `App.tsx`. Validação em **staging** com env real fica como passo operacional após deploy.

## 4. Idempotência financeira — duas rotas adicionais

| Rota | Alteração |
|------|-----------|
| `POST /api/lucky-boxes/open` | Coluna `request_fingerprint`; comparação em replay; **409** `IDEMPOTENCY_PAYLOAD_MISMATCH` se mesma key + `boxId` diferente. |
| `POST /api/lucky-boxes/purchase` | Idem com fingerprint `(boxId, qty)`. |
| `POST /api/upgrades/purchase` | Coluna `request_fingerprint` em `upgrade_purchase_idempotency`; mismatch em replay e após `P2002`; resposta JSON inclui `code: IDEMPOTENCY_PAYLOAD_MISMATCH` quando aplicável. |

**Roleta paga** (`POST /api/wheel/spin`): já era atómica com `idempotencyKey` + lock + `wheel_idempotency`; sem payload variável além da key — não foi alterada nesta fase.

## 5. `requestSave()` — tabela actualizada

| Ficheiro | Função | Módulo | Dado | Risco | Acção nesta fase | Pendência |
|----------|--------|--------|------|-------|------------------|-----------|
| `frontend/App.tsx` | `handlePlaceRack` | Servidores | stock + rigs | Alto | **Migrada** para `POST /api/servers/racks/place` + idempotência/fingerprint | Teste E2E manual |
| `frontend/App.tsx` | `handleRemoveRack`, equip/unequip miner, power, recharge, coin, NFT mint/burn, withdraw | vários | stock/racks/coins | Alto | **Pendente** (intents parciais já existem para aux bateria) | Migrar incrementalmente |
| `frontend/App.tsx` | `runPlayerSaveWithRetries` | Autosave | slices/full | Médio | Mantido; UX erros | Reduzir `full` save |

## 6. `POST /api/servers/racks/place`

- Corpo: `catalogItemId`, `roomId`, `slotIndex`, `idempotencyKey`, `clientStateVersion`.
- Transação `pg` + `persistStockStoredBatteriesPlacedRacks` + idempotência `game_servers_intent_idempotency` scope `srv_place_rack` + fingerprint canónico.
- `loadUpgradesWithCompat` passa a expor `isActive` para recusar chassis inactivo.

## 7. Suíte PG opcional

- `backend/test/pgIntegration.backendOptional.test.ts`: carrega `backend/.env` com `dotenv`; smoke de colunas + `SELECT 1`.
- `backend/test/pgIntegration.httpFlows.backendOptional.test.ts`: Express mínimo + rotas reais; fluxos `equip/unequip` rack aux, oficina charge (skip se faltar `workshop_slots.installed_at`), legado (barreira + `neutralizeLegacySaveGameSlicePayload`), shop checkout, wallet exchange, opcional saque com `PG_HTTP_MUTATE_SETTINGS=1`.
- Comandos:
  - `cd backend && RUN_BACKEND_PG_INTEGRATION=1 npm run test -- pgIntegration.backendOptional`
  - `cd backend && RUN_BACKEND_PG_INTEGRATION=1 npm run test -- pgIntegration` (inclui HTTP flows)
- **Correções de produção descobertas na suíte HTTP:** (1) `runRackAuxMutation` deixou de usar `Promise.all` no mesmo `PoolClient` (queries em paralelo corrompiam o driver `pg`). (2) `persistStockStoredBatteriesPlacedRacks` grava `battery_catalog_item_id` / metadados a partir de `placed_racks` em memória quando o snapshot de instância ainda não existe em `stored_batteries` (equip a partir de stock). (3) intents rack passam `rackBatteryCatalogHintsFromPlacedRacks` a `applyRackAuxEquip` / `applyRackAuxUnequip` para resolver catálogo quando a linha de armazém foi removida com a bateria montada.

## 8. Testes automáticos

- `npm run test`: **257** passaram; ficheiros `pgIntegration*.test.ts` **skipped** sem `RUN_BACKEND_PG_INTEGRATION=1`.
- Novos / alvo: `serversPlaceRackIntent.test.ts`; `rackBatteryCatalogHintsFromPlacedRacks` + tipo `RackAuxApplyFn` com terceiro argumento; fingerprints lucky/upgrade / withdraw em `itemUseAndWalletFingerprints.test.ts`.

## 9. Comandos executados (resumo)

```bash
docker compose up -d --force-recreate db
cd backend && npx prisma generate && npx prisma migrate resolve --rolled-back 20260510160000_financial_idempotency_fingerprints
cd backend && npx prisma migrate deploy
cd backend && node scripts/battery_diagnostic_readonly.mjs
cd backend && node scripts/battery_repair_dryrun.mjs
cd backend && npm run build:ts && npm run build:server && npm run test
cd backend && RUN_BACKEND_PG_INTEGRATION=1 npm run test -- pgIntegration
cd frontend && npx tsc --noEmit
```

## 10. Pendências reais

- Testes manuais duas abas / oficina no browser.
- **Black Market:** rota `POST .../buy` com idempotência — ainda não existe no código; compra idempotente continua pendência documentada no controlador.
- Migrar restantes handlers que ainda chamam `requestSave()` para intents.
- `RUN_BACKEND_PG_INTEGRATION=1` no CI só com segredo `DATABASE_URL` e Postgres de teste.
- Se a porta `5432` no host colidir com outro Postgres, ajustar mapeamento ou `DATABASE_URL`.
- Saque PG opcional: `PG_HTTP_MUTATE_SETTINGS=1` altera temporariamente `settings.web3_withdraw_tokens` (só ambiente de teste).

## 11. Recomendação produção

```
LEGACY_SAVEGAME_PLAYER_POLICY=strip   # até QA completo
ORPHAN_RACK_BATTERY_AUTO_RECOVER=0
BATTERY_INTEGRITY_MUTATIONS_ENABLED=0
```

Staging após QA: `LEGACY_SAVEGAME_PLAYER_POLICY=reject`.
