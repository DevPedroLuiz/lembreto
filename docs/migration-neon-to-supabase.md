# Historico de migracao Neon para Supabase PostgreSQL

> Documento historico. O sistema atual usa Supabase/Postgres via `DATABASE_URL`.
> Nao use este arquivo como guia de configuracao atual e nao reintroduza Neon.

Este documento descreve o plano seguro para migrar o banco do Lembreto de Neon PostgreSQL para Supabase PostgreSQL. Ele nao deve conter secrets reais, dumps, backups ou dados de producao.

## Escopo

- Usar Supabase apenas como PostgreSQL gerenciado.
- Preservar o backend Express, o frontend Vite + React e a variavel runtime `DATABASE_URL`.
- Nao usar Supabase Auth, Storage, Data API, Prisma ou Drizzle nesta migracao.
- Nao apagar nem modificar o Neon durante a migracao.
- Manter rollback temporario para Neon.

## Variaveis

`DATABASE_URL`

Variavel usada pelo app em runtime. Em producao, sera alterada para Supabase somente no cutover final aprovado.

`NEON_DATABASE_URL`

URL do banco Neon usada localmente para auditoria, backup e comparacao. Nunca commitar.

`SUPABASE_APP_DATABASE_URL`

URL do Supabase para runtime/Vercel. Deve usar Transaction Pooler, porta `6543`.

`SUPABASE_MIGRATION_DATABASE_URL`

URL do Supabase para `psql`, `pg_dump` e `pg_restore`. Deve usar Direct Connection quando IPv6 estiver disponivel, ou Session Pooler na porta `5432`.

## URLs de conexao

O app usa `DATABASE_URL`. Ferramentas de migracao usam somente `NEON_DATABASE_URL` e `SUPABASE_MIGRATION_DATABASE_URL`.

Nao usar `DATABASE_URL` para backup ou restore, para evitar operar no banco errado. Nao usar a URL de Production da Vercel para restore.

## Client PostgreSQL

O projeto usava `@neondatabase/serverless` em:

- `server.ts`
- `api/_db.ts`
- `scripts/cleanup-db.ts`

A auditoria encontrou apenas chamadas no formato `sql\`...\``. Nao foram encontrados usos de `sql.query`, `sql.transaction`, `sql.begin`, `sql.unsafe`, `COPY`, `LISTEN`, `NOTIFY` ou prepared statements explicitos.

Por isso, a substituicao aprovada para Supabase foi `postgres.js`, com configuracao compativel com Transaction Pooler:

```ts
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL!, {
  ssl: 'require',
  max: 1,
  prepare: false,
});
```

`prepare: false` e importante porque Transaction Pooler nao suporta prepared statements. `max: 1` evita pool local grande em ambiente serverless, ja que o pooler do Supabase gerencia as conexoes.

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

Nao foram encontrados usos de:

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

`lib/db.ts` centraliza a criacao do client e reduz duplicacao. `@neondatabase/serverless` foi removido depois da confirmacao de que nao restavam imports no codigo.

## Pre-requisitos

- Confirmar `NEON_DATABASE_URL` local.
- Confirmar `SUPABASE_APP_DATABASE_URL` com Transaction Pooler na porta `6543`.
- Confirmar `SUPABASE_MIGRATION_DATABASE_URL` com Session Pooler na porta `5432` ou Direct Connection.
- Garantir que a senha real esteja URL-encoded quando necessario.
- Preservar a `CALENDAR_TOKEN_ENCRYPTION_KEY` atual.
- Verificar ferramentas locais:

```bash
pg_dump --version
pg_restore --version
psql --version
node --version
npm --version
```

## Validacao antes de restore

Antes de qualquer restore, validar que o schema `public` do Supabase esta vazio ou que conflitos foram aprovados explicitamente:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
order by table_name;
```

Tambem validar extensoes:

```sql
select extname from pg_extension order by extname;
```

Para `gen_random_uuid()`, garantir `pgcrypto` se necessario:

```sql
create extension if not exists pgcrypto;
```

## Backup planejado

Backups devem ser gerados fora do repositorio, preferencialmente em `../lembreto-db-backups/`.

```bash
pg_dump "$NEON_DATABASE_URL" --format=custom --no-owner --no-acl --verbose --file="../lembreto-db-backups/lembreto_neon_backup.dump"
pg_dump "$NEON_DATABASE_URL" --schema-only --no-owner --no-acl --verbose --file="../lembreto-db-backups/lembreto_neon_schema.sql"
pg_restore --list ../lembreto-db-backups/lembreto_neon_backup.dump > ../lembreto-db-backups/lembreto_restore_list.txt
```

Nao commitar `.dump`, backups, arquivos `.sql` com dados reais ou listas sensiveis.

## Restore planejado

Restaurar primeiro schema, depois dados, usando `SUPABASE_MIGRATION_DATABASE_URL`:

```bash
pg_restore --schema-only --no-owner --no-acl --verbose --dbname "$SUPABASE_MIGRATION_DATABASE_URL" ../lembreto-db-backups/lembreto_neon_backup.dump
pg_restore --data-only --no-owner --no-acl --verbose --dbname "$SUPABASE_MIGRATION_DATABASE_URL" ../lembreto-db-backups/lembreto_neon_backup.dump
```

Se houver erro, parar, registrar o erro e diagnosticar antes de nova tentativa. Nao usar `DROP`, `TRUNCATE` ou `DROP CASCADE` sem aprovacao explicita.

## Validacoes comparativas

Comparar Neon e Supabase para:

- tabelas
- contagens
- colunas
- constraints
- indices
- sequencias
- extensoes
- triggers
- functions
- timezone
- search path
- collation
- amostras de dados
- integridade de todas as foreign keys

Contagem igual nao basta para concluir a migracao.

## Vercel Preview

Preview pode usar o mesmo projeto Supabase final somente em teste controlado. Configurar `DATABASE_URL` de Preview com `SUPABASE_APP_DATABASE_URL`, validar rotas principais e logs antes de Production.

Conferir se `APP_URL`, `GOOGLE_CALENDAR_REDIRECT_URI` e `OUTLOOK_REDIRECT_URI` precisam apontar para a URL de preview durante testes de OAuth.

## Cutover

Para evitar perda de dados:

1. Validar migracao em teste.
2. Agendar janela final.
3. Ativar modo manutencao minimo, se implementado/aprovado.
4. Fazer dump final do Neon o mais perto possivel da virada.
5. Restaurar dump final no Supabase.
6. Validar estrutura, dados, FKs e sequencias.
7. Atualizar `DATABASE_URL` de Production na Vercel para `SUPABASE_APP_DATABASE_URL`.
8. Fazer deploy de producao.
9. Testar login, tarefas, notificacoes, calendario e crons.
10. Monitorar logs.

## Rollback

Manter Neon intacto. Se Production falhar imediatamente, voltar `DATABASE_URL` da Vercel Production para Neon, redeployar e testar.

Se usuarios criarem dados no Supabase apos a virada, rollback simples para Neon pode causar divergencia. Nesse caso, avaliar sincronizacao reversa antes de voltar.

## Riscos residuais

- Escritas no Neon entre dump final e cutover podem ser perdidas se nao houver manutencao.
- Escritas no Supabase antes de rollback podem divergir do Neon.
- Pooler Transaction exige `prepare: false` no client.
- Direct Connection do Supabase pode exigir IPv6; Session Pooler e alternativa para migracao.
- `gen_random_uuid()` depende de extensao disponivel no Supabase.
- `CALENDAR_TOKEN_ENCRYPTION_KEY` deve ser preservada para manter tokens de calendario descriptografaveis.
