# 🎨 Frontend (Interface do Usuário)

O frontend é uma aplicação moderna baseada em **React** e **TypeScript**, otimizada com **Vite** para um desenvolvimento rápido e bundles leves.

## 🏗 Estrutura de Código

### `App.tsx`
- **O que faz**: Ponto de entrada da aplicação React. Gerencia as rotas principais do frontend e o layout global.
- **Por que**: Utiliza o ecossistema React para fornecer uma interface reativa e rápida para o usuário.

### `services/api.ts`
- **O que faz**: Centraliza todas as chamadas HTTP para o backend.
- **Por que**: Mantém o código limpo e facilita a manutenção de URLs e interceptadores de requisição (como tokens de autenticação).

### `components/`
- **O que faz**: Contém todos os elementos reutilizáveis da interface (Botões, Modais, Cards de Mineração, etc.).

## 🤖 Integrações Especiais

### `geminiService.ts`
- **O que faz**: Interface de comunicação com a API do Google Gemini.
- **Por que**: Fornece inteligência artificial dentro do jogo para interações dinâmicas ou suporte ao usuário.

## 🔧 Configuração (`vite.config.ts`)
O projeto utiliza o Vite para transpilação e servidor de desenvolvimento, garantindo Hot Module Replacement (HMR).

---
[[Home|⬅ Voltar para o Início]]
