<div align="center">

<img src="https://lembreto.vercel.app/favicon.ico" width="64" height="64" alt="Lembreto Logo" />

# 📝 Lembreto

**Sistema moderno de gerenciamento de tarefas com dashboard inteligente.**

[![Deploy](https://img.shields.io/badge/Deploy-Vercel-black?logo=vercel)](https://lembreto.vercel.app)
[![Database](https://img.shields.io/badge/Database-Neon%20Postgres-00e5a0?logo=postgresql)](https://neon.tech)
[![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)

[🌐 Acessar App](https://lembreto.vercel.app) · [🐛 Reportar Bug](https://github.com/DevPedroLuiz/lembreto/issues) · [💡 Sugerir Feature](https://github.com/DevPedroLuiz/lembreto/issues)

</div>

---

## ✨ Funcionalidades

- **Dashboard** com visão geral do dia: total, feitas, vencendo hoje e atrasadas
- **Criação e edição** de tarefas com título, descrição, data, prioridade e categoria
- **Filtro por categorias**: Geral, Trabalho, Pessoal, Estudos
- **Controle de status**: pendente / concluída
- **Progresso visual** com contador de metas
- **Autenticação** com registro, login e recuperação de senha
- **Perfil de usuário** com suporte a avatar
- **Tema escuro** nativo com design responsivo
- **Notificações** via browser

---

## 🛠️ Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + TypeScript + Vite |
| Estilização | Tailwind CSS v4 + Framer Motion |
| Backend | Vercel Serverless Functions (Node.js) |
| Banco de dados | Neon Postgres (serverless) |
| IA | Google Gemini API |
| Deploy | Vercel |

---

## 🚀 Rodando Localmente

### Pré-requisitos

- Node.js 18+
- Uma conta no [Neon Tech](https://neon.tech) com um banco criado
- (Opcional) Uma chave da [Gemini API](https://aistudio.google.com)

### 1. Clone o repositório

```bash
git clone https://github.com/DevPedroLuiz/lembreto.git
cd lembreto
```

### 2. Instale as dependências

```bash
npm install
```

### 3. Configure as variáveis de ambiente

Crie o arquivo `.env.local` na raiz do projeto:

```env
DATABASE_URL=postgresql://user:senha@host/dbname?sslmode=require
GEMINI_API_KEY=sua_chave_aqui
```

> 💡 A `DATABASE_URL` você encontra no painel do Neon Tech em **Connection string**.

### 4. Crie as tabelas no banco

Execute o conteúdo do arquivo [`schema.sql`](./schema.sql) no seu banco Neon (via painel SQL Editor ou qualquer client PostgreSQL).

### 5. Inicie o servidor

```bash
npm run dev
```

Acesse: [http://localhost:3000](http://localhost:3000)

---

## 📁 Estrutura do Projeto

```
lembreto/
├── api/                        # Serverless Functions (Vercel)
│   ├── _db.ts                  # Conexão com o banco (Neon)
│   ├── auth/
│   │   ├── register.ts         # POST /api/auth/register
│   │   ├── login.ts            # POST /api/auth/login
│   │   ├── recover.ts          # POST /api/auth/recover
│   │   └── profile.ts          # PUT  /api/auth/profile
│   └── tasks/
│       ├── index.ts            # GET/POST /api/tasks
│       └── [id].ts             # PUT/DELETE /api/tasks/:id
├── src/                        # Frontend React
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css
├── schema.sql                  # Schema do banco de dados
├── server.ts                   # Servidor Express (apenas dev local)
├── vercel.json                 # Configuração do deploy
├── vite.config.ts
└── package.json
```

---

## 🌐 Deploy na Vercel

### Variáveis de ambiente necessárias

Configure as seguintes variáveis no painel **Vercel → Settings → Environment Variables**:

| Variável | Descrição |
|---|---|
| `DATABASE_URL` | Connection string do Neon Postgres |
| `GEMINI_API_KEY` | Chave da API do Google Gemini (opcional) |

### Deploy automático

O deploy é feito automaticamente a cada push na branch `main`. O Vercel:

1. Executa `vite build` para gerar o frontend estático
2. Detecta a pasta `/api` e converte cada arquivo em uma Serverless Function
3. Serve o frontend e roteia `/api/*` para as funções

---

## 🗄️ Banco de Dados

O schema completo está em [`schema.sql`](./schema.sql). As tabelas são:

**`users`** — usuários da aplicação  
**`tasks`** — tarefas vinculadas a cada usuário

---

## 📄 Licença

Este projeto está sob a licença [MIT](./LICENSE).

---

<div align="center">

Feito com 💙 por [Pedro Luiz](https://github.com/DevPedroLuiz)

</div>
