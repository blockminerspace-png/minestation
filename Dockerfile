# Gera o bundle React a partir do código-fonte em cada build.
# Antes: COPY frontend/dist copiava um dist antigo / esquecido — o site em produção nunca refletia o repo.
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim
# pg_dump / psql / pg_restore precisam acompanhar o major do Postgres da stack.
# O Debian bookworm instala a serie 15 por padrao, entao fixamos o cliente 16 do PGDG.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 ffmpeg \
  && apt-get purge -y --auto-remove curl gnupg \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./

COPY --from=frontend-builder /app/frontend/dist ../frontend/dist

# Compila uma vez na imagem (cron ao lado de cron/, resto em dist/). Evita `npm start` no runtime,
# que recompilaria tudo a cada arranque do contentor.
RUN npm run build:app

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "server.js"]
