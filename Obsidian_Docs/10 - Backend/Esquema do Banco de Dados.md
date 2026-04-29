# 🗄️ Banco de Dados (PostgreSQL)

O MineStation utiliza o **PostgreSQL** para persistência de dados. A inicialização e estrutura das tabelas são geridas pelo arquivo `backend/db.pg.js`.

## 📋 Tabelas Principais

### `users`
Armazena a identidade e configurações básicas do jogador.
- `id`: Serial (PK)
- `username`, `email`: Dados de acesso.
- `polygon_wallet`: Endereço da carteira Web3.
- `is_admin`: Nível de acesso administrativo.
- `is_blocked`: Status de banimento.

### `game_states`
O "save" do jogador no jogo.
- `user_id`: FK para users.
- `usdc`: Saldo principal em dólares.
- `black_market_balance`: Saldo secundário.
- `total_usdc_deposited`, `total_crypto_withdrawn`: Histórico financeiro.

### `mining_coins`
Configuração das moedas mineráveis.
- `id`: Símbolo ou ID único.
- `name`, `block_reward`, `price_usd`: Parâmetros de recompensa.
- `is_active`: Define se a moeda aparece no jogo.

### `upgrades`
Catálogo de itens, máquinas e racks.
- `id`, `name`, `category`, `type`.
- `base_cost`, `base_production`: Lógica econômica do item.
- `power_consumption`, `power_capacity`: Requisitos de energia.

### `placed_racks` & `rack_slots`
Estado físico da sala de mineração do usuário.
- `placed_racks`: Instâncias de racks posicionados nas salas.
- `rack_slots`: Mapeamento de quais máquinas estão dentro de cada rack.

### `player_listings`
Itens ativos no Marketplace de jogadores.

### `withdrawal_requests`
Fila de processamento de saques solicitados.

## 🛠 Manutenção e Migrações
O sistema utiliza um padrão de "Verify and Alter" dentro do `db.pg.js` para garantir que novas colunas sejam adicionadas automaticamente sem quebrar o banco existente.

---
[[Backend Overview|⬅ Voltar para Backend]]

