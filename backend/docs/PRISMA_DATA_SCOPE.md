# Prisma e Postgres — âmbito e manutenção

Este documento alinha o **`prisma/schema.prisma`** com o que existe na BD e com o **`config/initDb.ts`** (bootstrap de ambientes novos).

## O que o Prisma cobre

Todas as tabelas listadas no `schema.prisma` são **dados de negócio ou operação** no Postgres (fonte de verdade). O ficheiro está organizado por **secções comentadas** (utilizadores, save-game, P2P, segurança, etc.).

**Não** está no Prisma / Postgres:

- Trilho de **atividade de jogo** para o admin (caixas, roleta, depósitos, …) → **MongoDB**, coleção `game_activity_logs` (ver `MONGO_LOG_CONTRACT.md`).
- Métricas **action_logs** / **event_history** / **analytics_events** → Mongo.

## Drift entre `initDb.ts` e `schema.prisma`

- Novas instalações: `initDb` cria tabelas; o Prisma deve reflectir o mesmo.
- Se alterares a BD com SQL manual ou só no `initDb`, **actualiza o Prisma**:

```bash
cd backend
export DATABASE_URL="postgres://..."   # aponta para a BD real
npx prisma db pull
```

Rever o diff de `prisma/schema.prisma`, correr `npx prisma generate` e testes.

## Migrações versionadas (recomendado em produção)

```bash
cd backend
npx prisma migrate dev --name descricao_curta
```

Em deploy: `npm run migrate:deploy` (já referenciado no `.env.example`).

## Comandos úteis

| Comando | Efeito |
|---------|--------|
| `npx prisma validate` | Valida o schema sem ligar à BD. |
| `npx prisma generate` | Regenera o client (incluído em `npm run build:app`). |
| `npx prisma db pull` | Introspecção: BD → `schema.prisma`. |
| `npx prisma migrate diff` | Comparar schema com BD (avançado). |

## Raw SQL (`$executeRawUnsafe`) no código

Alguns fluxos (ex.: P2P, partner) usam SQL dinâmico. Ao mudar colunas nessas tabelas, actualizar **queries** e **Prisma** em conjunto.

## Segurança em Postgres vs “logs” em Mongo

Tabelas como `device_fingerprint_logs`, `admin_access_logs`, `security_threat_scores` permanecem em **Postgres** por serem dados de **controlo / consultas de segurança**; não são o mesmo produto que o histórico de “Atividade” do jogador no admin (Mongo).
