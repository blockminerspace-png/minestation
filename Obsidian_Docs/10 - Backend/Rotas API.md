# 🛣️ Rotas da API

O backend do MineStation possui um conjunto vasto de rotas para gerenciar o jogo, economia e administração. Abaixo estão as principais categorias.

## 👤 Usuários e Autenticação
- `GET /api/session`: Verifica o estado da sessão e usuário logado.
- `GET /api/users`: (Admin) Lista todos os usuários.
- `GET /api/game-state/:email`: Retorna o estado completo do jogo de um jogador.
- `GET /api/load-game`: Inicializa os dados necessários para o cliente React.
- `GET /api/referrals/:email`: Lista os referenciados de um usuário.

## ⛏️ Mineração e Itens
- `GET /api/mining-coins`: Lista todas as moedas mineráveis e seus status.
- `GET /api/upgrades`: Retorna a lista de itens e máquinas disponíveis.
- `GET /api/admin-upgrades`: Itens especiais de upgrade administrativo.
- `GET /api/rig-rooms`: Lista de salas de mineração disponíveis.
- `GET /api/my-rig-rooms/:email`: Salas que o usuário possui.
- `GET /api/loot-boxes`: Lista de caixas de loot disponíveis para compra/abertura.

## 💰 Economia e Finanças
- `GET /api/economy-settings`: Configurações globais de taxas e limites.
- `GET /api/exchange-settings`: Configurações de troca de moedas.
- `GET /api/market/listings`: Itens à venda no mercado de jogadores.
- `GET /api/wallet-labels`: (Admin) Gerenciamento de labels para carteiras.
- `GET /api/stats/top-deposits`: Ranking de maiores depósitos.
- `GET /api/stats/top-withdrawals`: Ranking de maiores saques.

## 🎡 Jogos e Sorteios
- `GET /api/wheel/config`: Configuração atual da roleta.
- `GET /api/admin/wheel/config`: (Admin) Edição da configuração da roleta.
- `GET /api/admin/wheel/players`: (Admin) Jogadores na fila da roleta.

## 🛡️ Administrativo (Middleware `isAdmin`)
- `GET /api/admin/dashboard-stats`: Resumo financeiro e de usuários para o painel.
- `GET /api/admin/backups`: Lista de backups SQL disponíveis.
- `GET /api/admin/backups/download/:filename`: Download de dump do banco.
- `GET /api/admin/promo-codes`: Gerenciamento de cupons.
- `GET /api/admin/recall-scan`: Ferramenta de auditoria de itens.
- `GET /api/admin/ranking`: Configurações de exibição do ranking.

## 📢 Sistema de Notícias e Social
- `GET /api/news`: Feed de notícias globais.
- `GET /api/player-news/pending`: (Admin) Notícias enviadas por players aguardando aprovação.
- `GET /api/season-passes`: Informações sobre o Battle Pass atual.

---
*Nota: Esta lista não é exaustiva. O sistema possui mais de 90 endpoints registrados para funções específicas de lógica interna.*

[[Backend Overview|⬅ Voltar para Backend]]

