# Gera o bundle React a partir do código-fonte em cada build.
# Antes: COPY frontend/dist copiava um dist antigo / esquecido — o site em produção nunca refletia o repo.
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim
# pg_dump / psql / pg_restore para backups SQL no painel admin (evita spawn ENOENT)
RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./

COPY --from=frontend-builder /app/frontend/dist ../frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
