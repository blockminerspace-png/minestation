# 🔑 Variáveis de Ambiente (.env)

O sistema utiliza arquivos `.env` para gerenciar configurações sensíveis e URLs de conexão. Estes arquivos não devem ser compartilhados ou incluídos no controle de versão.

## 🗄️ Backend (`backend/.env`)

As seguintes chaves são obrigatórias para o funcionamento do servidor:

- `PORT`: Porta onde o servidor Express irá rodar (ex: 5000).
- `FRONTEND_URL`: URL do frontend React para permitir CORS (ex: http://localhost:5173).
- `DATABASE_URL`: String de conexão com o PostgreSQL (ex: postgresql://user:pass@host:port/dbname).
- `API_KEY`: Chave de segurança para comunicações entre serviços.
- `POLYGON_RPC`: URL do provedor RPC da rede Polygon para integração Web3.

## 🎨 Frontend (`frontend/.env`)

Configurações consumidas pelo Vite durante o build:

- `VITE_API_URL`: URL base do backend para as chamadas da API.
- `API_PORT`: (Opcional) Porta auxiliar.

## 🛡️ Admin (`admin/.env`)

Geralmente compartilha as mesmas chaves do backend, focando na porta específica do painel.

---
[[Home|⬅ Voltar para o Início]]
