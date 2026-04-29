# ⚙️ Backend (Servidor Principal)

O backend do MineStation é construído em **Node.js** utilizando o framework **Express**. Ele gerencia toda a lógica de jogo, economia, usuários e integração Web3.

## 🚀 Arquivos Principais

### `server.js`
- **O que faz**: É o coração do sistema. Gerencia rotas, middleware de autenticação, conexão com banco de dados e sockets.
- **Por que**: Centraliza a lógica para facilitar o acesso aos estados compartilhados, embora sua densidade exija cuidado na manutenção.

### `db.pg.js`
- **O que faz**: Gerencia a conexão com o banco de dados PostgreSQL.
- **Por que**: Utiliza o driver `pg` para consultas performáticas e persistência de dados dos jogadores (saldos, inventários, logs).

### Arquivos JSON de Configuração
O backend utiliza diversos arquivos `.json` para gerenciar parâmetros dinâmicos sem necessidade de restart:
- `active_promos.json`: Promoções ativas no sistema.
- `boosts.json`: Multiplicadores de ganhos.
- `chargers.json`: Configurações de carregadores/energia.
- `mining_coins_data.json`: Dados sobre as moedas mineráveis.

## 🔐 Segurança e Autenticação
O sistema utiliza middlewares como `isAdmin` para proteger rotas sensíveis, garantindo que apenas administradores possam acessar dados financeiros ou configurações do sistema.

---
[[Rotas API|➡ Ver Lista de Rotas]] | [[Home|⬅ Voltar para o Início]]
