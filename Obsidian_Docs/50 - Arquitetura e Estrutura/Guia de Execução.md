# 🚀 Guia de Execução (Local)

Para rodar o projeto localmente, siga os passos abaixo para cada componente.

## 🛠 Pré-requisitos
- **Node.js** (v18 ou superior recomendado)
- **PostgreSQL** rodando localmente
- Arquivos `.env` configurados (Veja [[Variaveis de Ambiente]])

## ⚙️ Backend
O servidor principal que gerencia as regras do jogo e API.
1. Navegue até a pasta `backend/`.
2. Instale as dependências: `npm install`.
3. Inicie o servidor: `node server.js`.

## 🎨 Frontend
A interface React do jogador.
1. Navegue até a pasta `frontend/`.
2. Instale as dependências: `npm install`.
3. Inicie o servidor de desenvolvimento: `npm run dev`.
4. Acesse via navegador em `http://localhost:5173`.

## 🛡️ Painel Admin
A interface de gerenciamento.
1. Navegue até a pasta `admin/`.
2. Instale as dependências: `npm install`.
3. Inicie o servidor: `node server.js`.

---
## ⚠️ Notas Técnicas
- **Complexidade**: Os arquivos `backend/server.js` e `frontend/App.tsx` são muito grandes e contêm a maior parte da lógica. Tenha cuidado ao editá-los sem ler os comentários internos.
- **Banco de Dados**: O sistema tentará inicializar as tabelas automaticamente na primeira execução se o banco estiver vazio.

---
[[Home|⬅ Voltar para o Início]]
