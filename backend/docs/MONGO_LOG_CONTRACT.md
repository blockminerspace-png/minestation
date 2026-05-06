# Contrato de logs MongoDB (`genesis_logs`)

Modelo de dados Postgres / Prisma: `PRISMA_DATA_SCOPE.md`.

O MongoDB é **opcional** (`MONGODB_URI` no `.env`) e serve só para **eventos / analytics**. A fonte de verdade continua a ser o **PostgreSQL**.

## P2P / mercado paralelo: onde fica o quê

| Camada | Sistema | Conteúdo |
|--------|---------|----------|
| **Estado e regras de negócio** | **PostgreSQL** | `player_listings`, `p2p_market_trade_history`, `stock`, `game_states`, `economy_settings`, etc. — tudo o que a API lê/escreve para o jogo funcionar. |
| **Trilho de auditoria / analytics** | **MongoDB** (`action_logs`) | Eventos já ligados em `p2pMarketController.ts` via `logUserAction`: criar/cancelar/reservar/comprar/reclamar cofre, etc. — **não** duplicar inventário nem saldos; só ids e métricas do evento. |

Leituras só de listagem (`GET /api/market/listings`, histórico, custódia) não geram linha em Mongo por defeito; o que interessa auditar são **mutações** bem-sucedidas.

## Variáveis de ambiente (segredos só no `.env`)

| Variável | Obrigatório | Descrição |
|----------|-------------|-----------|
| `MONGODB_URI` | Recomendado em produção | URI completa, ex.: `mongodb://user:PASSWORD@host:27017/genesis_logs?authSource=admin`. **Nunca** commits com credenciais reais. |
| `GENESIS_MONGO_DB` | Não | Nome da base (default `genesis_logs`). |

## Base e coleções

- **Base:** `GENESIS_MONGO_DB` ou `genesis_logs`.
- **Coleções:** definidas em `lib/mongoLogs.ts` como `MONGO_COLLECTIONS`.

## Campos comuns a todos os documentos

Inseridos pelo servidor em `mongoLogInsert`:

- **`at`**: `Date` (ISO no cliente/driver).

## `game_activity_logs` (coleção Mongo) — auditoria de jogo / painel admin

Substitui a antiga tabela Postgres `game_activity_logs` (removida do `initDb` e do Prisma).

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `userId` | `number` | Utilizador alvo do evento. |
| `action` | `string` | Ex.: `loot_box_open`, `hardware_buy`, `client_*`. |
| `meta` | `object` | JSON livre (mesmo conteúdo que antes no Postgres). |
| `at` | `Date` | Timestamp do insert. |
| `created_at` | `number` | Epoch ms (duplicado para ordenação simples). |

Escrita: `appendGameActivityLogMongo` (`lib/mongoLogs.ts`), chamada pelo `appendGameActivityLog` em `server.ts`. Leitura admin: `listGameActivityLogsMongo` → `GET /api/admin/user-activity`.

Bases já existentes: executar uma vez `backend/scripts/drop_game_activity_logs.sql` no Postgres para remover a tabela legada.

---

## `action_logs` — `logUserAction(userId, action, meta)`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `userId` | `number \| null` | Utilizador autenticado; `null` se não aplicável. |
| `action` | `string` | Identificador estável do evento (ex.: `login`, `p2p_listing_buy`). |
| `*` | — | Chaves extra em `meta` conforme o evento (ver abaixo). |

### Ações registadas (stack actual)

| `action` | `userId` | `meta` (exemplos) |
|----------|----------|-------------------|
| `login` | sim | `{ auth: 'password' }` — sem email em claro. |
| `signup_complete` | sim | `{}` — registo público concluído. |
| `profile_update` | sim | `{}` — `PUT /api/user` autenticado. |
| `wallet_link` | sim | `{}` — `POST /api/session` (carteira Polygon). |
| `p2p_listing_create` | sim | `listingId`, `itemId`, `qty`, `price` |
| `p2p_listing_cancel` | sim | `listingId` |
| `p2p_listing_reserve` | sim | `listingId`, `reservedUntil` |
| `p2p_reserve_cancel` | sim | `listingId` |
| `p2p_listing_buy` | comprador | `listingId`, `sellerId`, `itemId`, `buyQty`, `totalUsdc`, `unitPrice` |
| `p2p_proceeds_claim` | sim | `claimedUsdc` |
| `p2p_custody_claim` | sim | `listingId` |

**Proibido** em `meta`: passwords, tokens, emails completos (usar `userId` para correlacionar com Postgres).

## `event_history` — `logGameEvent(kind, meta)`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `kind` | `string` | Tipo de evento de sistema (ex.: `mining_yield_tick`). |
| `*` | — | Campos livres em `meta`. |

## `analytics_events` — `logAnalyticsEvent(name, meta)`

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `name` | `string` | Nome da métrica (ex.: `mining_yield_tick`, `bull_mining_yield_tick`). |
| `*` | — | Campos livres em `meta`. |

## Operação e deploy

- Escrita **fire-and-forget**; falhas de insert só aparecem em `console.warn`.
- Em produção com Docker, definir `MONGODB_URI` no serviço `app` (ver `deployment/docker-compose.yml`).
- Índices recomendados (criar na MongoDB ou script de ops): `action_logs` → `{ at: -1 }`, `{ action: 1, at: -1 }`; idem para `event_history` / `analytics_events` com `kind` / `name`.
