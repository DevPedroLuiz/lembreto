# Histórico de migração Neon para Supabase PostgreSQL

> Documento histórico. O sistema atual usa Supabase/Postgres via `DATABASE_URL`.
> Não use este arquivo como guia de configuração atual e não reintroduza Neon.

Este documento descreve o plano seguro para migrar o banco do Lembreto de Neon PostgreSQL para Supabase PostgreSQL. Ele não deve conter secrets reais, dumps, backups ou dados de produção.

## Escopo

- Usar Supabase apenas como PostgreSQL gerenciado.
- Preservar o backend Express, o frontend Vite + React e a variável runtime `DATABASE_URL`.
- Não usar Supabase Auth, Storage, Data API, Prisma ou Drizzle nesta migração.
- Não apagar nem modificar o Neon durante a migração.
- Manter rollback temporário para Neon.

## Variáveis

`DATABASE_URL`

Variável usada pelo app em runtime. Em produção, será alterada para Supabase somente no cutover final aprovado.

`NEON_DATABASE_URL`

URL do banco Neon usada localmente para auditoria, backup e comparação. Nunca commitar.

`SUPABASE_APP_DATABASE_URL`

URL do Supabase para runtime/Vercel. Deve usar Transaction Pooler, porta `6543`.

`SUPABASE_MIGRATION_DATABASE_URL`

URL do Supabase para `psql`, `pg_dump` e `pg_restore`. Deve usar Direct Connection quando IPv6 estiver disponível, ou Session Pooler na porta `5432`.

## URLs de conexão

O app usa `DATABASE_URL`. Ferramentas de migração usam somente `NEON_DATABASE_URL` e `SUPABASE_MIGRATION_DATABASE_URL`.

Não usar `DATABASE_URL` para backup ou restore, para evitar operar no banco errado. Não usar a URL de Production da Vercel para restore.

## Client PostgreSQL

O projeto usava `@neondatabase/serverless` em:

- `server.ts`
- `api/_db.ts`
- `scripts/cleanup-db.ts`

A auditoria encontrou apenas chamadas no formato `sql\`...\``. Não foram encontrados usos de `sql.query`, `sql.transaction`, `sql.begin`, `sql.unsafe`, `COPY`, `LISTEN`, `NOTIFY` ou prepared statements explícitos.

Por isso, a substituição aprovada para Supabase foi `postgres.js`, com configuração compatível com Transaction Pooler:

```ts
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: 'require',
  max: 1,
  prepare: false,
});
```

`prepare: false` é importante porque Transaction Pooler não suporta prepared statements. `max: 1` evita pool local grande em ambiente serverless, já que o pooler do Supabase gerencia as conexões.

Essa troca foi implementada em `lib/db.ts` e reutilizada por `server.ts`, `api/_db.ts` e `scripts/cleanup-db.ts`.

### Auditoria dos usos de `sql`

Foram encontrados 134 usos de `sql\`...\``:

| Arquivo | Usos |
| --- | ---: |
| `lib/notifications.ts` | 24 |
| `lib/calendar/calendarSync.ts` | 24 |
| `lib/task-taxonomy.ts` | 22 |
| `lib/handlers/auth.ts` | 19 |
| `lib/handlers/notes.ts` | 11 |
| `lib/handlers/tasks.ts` | 8 |
| `e2e/support/test-data.ts` | 8 |
| `lib/auth.ts` | 7 |
| `api/_rate_limit.ts` | 4 |
| `lib/db-maintenance.ts` | 4 |
| `lib/holidays.ts` | 3 |

Não foram encontrados usos de:

- `sql.query`
- `sql.transaction`
- `sql.begin`
- `sql.unsafe`
- `COPY`
- `LISTEN`
- `NOTIFY`
- `PREPARE`

Os handlers esperam apenas a interface definida em `lib/handlers/core.ts`:

```ts
export interface SqlClient {
  (
    strings: TemplateStringsArray,
    ...params: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
}
```

Essa interface e compatavel conceitualmente com `postgres.js`, que tambem retorna arrays para consultas SQL via template tag.

### Arquivos afetados pela troca de driver

A troca de `@neondatabase/serverless` para `postgres.js` afetou:

- `package.json`
- `package-lock.json`
- `server.ts`
- `api/_db.ts`
- `scripts/cleanup-db.ts`
- `lib/db.ts`

`lib/db.ts` centraliza a criação do client e reduz duplicação. `@neondatabase/serverless` foi removido depois da confirmação de que não restavam imports no código.

## Pré-requisitos

- Confirmar `NEON_DATABASE_URL` local.
- Confirmar `SUPABASE_APP_DATABASE_URL` com Transaction Pooler na porta `6543`.
- Confirmar `SUPABASE_MIGRATION_DATABASE_URL` com Session Pooler na porta `5432` ou Direct Connection.
- Garantir que a senha real esteja URL-encoded quando necessário.
- Preservar a `CALENDAR_TOKEN_ENCRYPTION_KEY` atual.
- Verificar ferramentas locais:

```bash
pg_dump --version
pg_restore --version
psql --version
node --version
npm --version
```

## Validação antes de restore

Antes de qualquer restore, validar que o schema `public` do Supabase está vazio ou que conflitos foram aprovados explicitamente:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Também validar extensões:

```sql
select extname from pg_extension order by extname;
```

Para `gen_random_uuid()`, garantir `pgcrypto` se necessário:

```sql
create extension if not exists pgcrypto;
```

## Backup planejado

Backups devem ser gerados fora do repositório, preferencialmente em `../lembreto-db-backups/`.

```bash
pg_dump "$NEON_DATABASE_URL" --format=custom --no-owner --no-acl --verbose --file="../lembreto-db-backups/lembreto_neon_backup.dump"
pg_dump "$NEON_DATABASE_URL" --schema-only --no-owner --no-acl --verbose --file="../lembreto-db-backups/lembreto_neon_schema.sql"
pg_restore --list ../lembreto-db-backups/lembreto_neon_backup.dump > ../lembreto-db-backups/lembreto_restore_list.txt
```

Não commitar `.dump`, backups, arquivos `.sql` com dados reais ou listas sensíveis.

## Restore planejado

Restaurar primeiro schema, depois dados, usando `SUPABASE_MIGRATION_DATABASE_URL`:

```bash
pg_restore --schema-only --no-owner --no-acl --verbose --dbname "$SUPABASE_MIGRATION_DATABASE_URL" ../lembreto-db-backups/lembreto_neon_backup.dump
pg_restore --data-only --no-owner --no-acl --verbose --dbname "$SUPABASE_MIGRATION_DATABASE_URL" ../lembreto-db-backups/lembreto_neon_backup.dump
```

Se houver erro, parar, registrar o erro e diagnosticar antes de nova tentativa. Não usar `DROP`, `TRUNCATE` ou `DROP CASCADE` sem aprovação explícita.

## Validações comparativas

Comparar Neon e Supabase para:

- tabelas
- contagens
- colunas
- constraints
- índices
- sequências
- extensões
- triggers
- functions
- timezone
- search path
- collation
- amostras de dados
- integridade de todas as foreign keys

Contagem igual não basta para concluir a migração.

## Vercel Preview

Preview pode usar o mesmo projeto Supabase final somente em teste controlado. Configurar `DATABASE_URL` de Preview com `SUPABASE_APP_DATABASE_URL`, validar rotas principais e logs antes de Production.

Conferir se `APP_URL`, `GOOGLE_CALENDAR_REDIRECT_URI` e `OUTLOOK_REDIRECT_URI` precisam apontar para a URL de preview durante testes de OAuth.

## Cutover

Para evitar perda de dados:

1. Validar migração em teste.
2. Agendar janela final.
3. Ativar modo manutenção mínimo, se implementado/aprovado.
4. Fazer dump final do Neon o mais perto possível da virada.
5. Restaurar dump final no Supabase.
6. Validar estrutura, dados, FKs e sequências.
7. Atualizar `DATABASE_URL` de Production na Vercel para `SUPABASE_APP_DATABASE_URL`.
8. Fazer deploy de produção.
9. Testar login, tarefas, notificações, calendário e crons.
10. Monitorar logs.

## Rollback

Manter Neon intacto. Se Production falhar imediatamente, voltar `DATABASE_URL` da Vercel Production para Neon, redeployar e testar.

Se usuários criarem dados no Supabase após a virada, rollback simples para Neon pode causar divergência. Nesse caso, avaliar sincronização reversa antes de voltar.

## Riscos residuais

- Escritas no Neon entre dump final e cutover podem ser perdidas se não houver manutenção.
- Escritas no Supabase antes de rollback podem divergir do Neon.
- Pooler Transaction exige `prepare: false` no client.
- Direct Connection do Supabase pode exigir IPv6; Session Pooler é alternativa para migração.
- `gen_random_uuid()` depende de extensão disponível no Supabase.
- `CALENDAR_TOKEN_ENCRYPTION_KEY` deve ser preservada para manter tokens de calendário descriptografáveis.
