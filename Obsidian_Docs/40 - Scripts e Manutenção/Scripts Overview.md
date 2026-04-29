# 🛠 Scripts e Manutenção

O projeto inclui diversos scripts utilitários. Muitos foram criados para tarefas pontuais de depuração e atualização e estão espalhados pela raiz e pela pasta `backend/`.

## 📂 Pasta `scripts/` (Raiz)
- **`add_whale_item.js`**: Adiciona itens raros ao banco de dados.

## 📄 Scripts Úteis na Raiz
- **`debug_db.js`**: Testa a conexão com o PostgreSQL.
- **`tmp_db_update.js` / `tmp_db_update_cjs.js`**: Scripts de migração de dados.
- **`tmp_check_dai.js`**: Verificador de saldo/integração com token DAI.

## ⚙️ Scripts no Backend (`backend/`)
O backend contém uma vasta lista de scripts `tmp_` para manutenção específica:
- `tmp_check_chargers.js`: Verifica o estado dos carregadores de energia.
- `tmp_verify_dino.js`: Verificação de itens específicos (ex: Dino Power).
- `tmp_export_config.js`: Gera um dump das configurações atuais do sistema para JSON.
- `fix_schema.js`: Script principal para aplicar correções manuais na estrutura do banco.

## 🧹 Recomendação de Limpeza
Muitos arquivos prefixados com `tmp_` foram criados para correções de bugs específicos no passado. 
- **O que pode ser apagado**: Arquivos de log (`.txt`) gerados por scripts e scripts de verificação de bugs já resolvidos.
- **O que deve ficar**: `debug_db.js`, `fix_schema.js` e qualquer script de migração que ainda não tenha sido rodado em produção.

## 🕒 Backups
A pasta `backups/` armazena dumps SQL. Recomenda-se manter pelo menos os últimos 3 backups.

---
[[Home|⬅ Voltar para o Início]]

