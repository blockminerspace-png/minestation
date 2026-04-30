# Gera o bundle React a partir do código-fonte em cada build.
# Antes: COPY frontend/dist copiava um dist antigo / esquecido — o site em produção nunca refletia o repo.
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/ ./

COPY --from=frontend-builder /app/frontend/dist ../frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
