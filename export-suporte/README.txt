Pacote "Suporte" — Mine Station
================================

Este ZIP contém ficheiros de referência para o módulo de suporte (tickets, anexos, respostas admin).

IMPORTANTE — Docker / VM (~/minestation/frontend)
-------------------------------------------------
1) O build (`tsc && vite build`) só usa a pasta **frontend/** do servidor. Não coloque aqui ficheiros
   `.ts` que não sejam parte real do projeto.

2) **NUNCA** deixe `api_support_fragment.ts` em `frontend/services/` — apague. Use em vez disso:
   - `frontend/services/supportTicketsApi.ts` (ficheiro completo, autocontido)
   - em `api.ts`, as linhas `export type { ... } from './supportTicketsApi'` e
     `export { submitSupportTicket, ... } from './supportTicketsApi'`
   Ver **DEPLOY_NA_VM.txt** neste ZIP.

3) Os componentes importam de `../services/api`; os reexports em **api.ts** encaminham para
   **supportTicketsApi.ts**.

Sobre a pasta "referencia-repo-backend-frontend-NAO_USAR_NA_VM" neste ZIP
-------------------------------------------------------------------------
No repositório de desenvolvimento existe uma cópia **backend/frontend/** (espelho). Na VM, o
**Dockerfile** costuma fazer COPY só de **frontend/** — a pasta **backend** do servidor é a API
Node, não esta cópia do React. Ou seja:
- Corrija na VM: **~/minestation/frontend/services/api.ts**
- A pasta com nome longo no ZIP é **só referência**; não copie para a VM nem confunda com
  **~/minestation/backend**.

Conteúdo do ZIP
---------------
- frontend/components/ — SupportPage.tsx, AdminSupport.tsx (copiar para o repo)
- frontend/services/supportTicketsApi.ts — módulo de API de suporte (copiar para a VM)
- DEPLOY_NA_VM.txt — passos exactos na VM
- docs/api_support_MERGE_INTO_api.ts.txt — referência antiga (preferir supportTicketsApi.ts)
- sql/support_tables.sql — DDL (também em backend/db.pg.js via initDb)
- snippets/ — trechos de server.js (multer + rotas); integrar no server.js real

Integração adicional no repo completo
---------------------------------------
- backend/server.js — multer + rotas /api/support/* e /api/admin/support-tickets*
- frontend/App.tsx, AdminPanel.tsx, AdminSettingsPageVisibility.tsx, constants/gameNavLabels.ts
- backend/config/uiDisplayLabelKeys.ts — nav.support, page.support

Reiniciar a API para o initDb criar as tabelas em bases novas.
