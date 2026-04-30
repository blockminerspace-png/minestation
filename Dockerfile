# Genesis Miner — mesmo fluxo de produção: `npm start` no backend servindo `../frontend/dist`.
# Usa o `frontend/dist` já gerado no repositório (evita rebuild que exige o mesmo ambiente de dev).
FROM node:20-bookworm-slim

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
RUN npm install

COPY backend/ ./

# Artefato estático atual (mesmo que o Express já referencia em server.js)
COPY frontend/dist /app/frontend/dist

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]
