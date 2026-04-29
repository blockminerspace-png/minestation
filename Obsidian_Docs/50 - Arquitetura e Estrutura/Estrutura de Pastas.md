# 📁 Estrutura de Pastas e Arquivos

O projeto está organizado de forma modular, separando as preocupações de Backend, Frontend e Administração.

## 🌳 Árvore de Diretórios Principal

```text
MineStation/
├── admin/               # Painel Administrativo (Backend/Server)
├── backend/             # Servidor Principal da Aplicação
│   ├── utils/           # Funções utilitárias do backend
│   ├── img/             # Assets e imagens do servidor
│   ├── .env             # Configurações de ambiente (SENSÍVEL)
│   └── server.js        # Arquivo principal do servidor (Lógica central)
├── frontend/            # Interface do Usuário (React + Vite)
│   ├── src/             # Código fonte do frontend
│   ├── services/        # Integração com APIs (api.ts)
│   ├── public/          # Arquivos estáticos
│   └── App.tsx          # Componente principal do frontend
├── scripts/             # Scripts de manutenção e utilitários
├── backups/             # Backups do banco de dados SQL
├── package.json         # Dependências do projeto raiz
└── requirements.txt     # Requisitos de ambiente
```

## 📄 Arquivos Chave na Raiz

- **`routes_utf8.txt`**: Documento de referência com a listagem de todas as rotas registradas no sistema.
- **`backup dia 28...sql`**: Snapshot recente do banco de dados para recuperação.
- **`debug_db.js`**: Script para teste e depuração de conexão com o banco.
- **`tmp_db_update.js`**: Scripts temporários de migração ou atualização de esquema.

---
[[Home|⬅ Voltar para o Início]]
