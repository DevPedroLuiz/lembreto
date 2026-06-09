# Android e SaaS

Este projeto agora tem a base para distribuir o Lembreto como um app Android real usando Capacitor.

## Modelo recomendado

- Web: continua sendo o painel principal do SaaS.
- API: deve ficar em uma URL publica e estavel, por exemplo `https://api.lembreto.com`.
- Android: usa o mesmo frontend React/Vite, empacotado em um projeto Android nativo.
- Banco: nunca deve ser acessado diretamente pelo app. O APK conversa apenas com a API.

## Configuracao de ambiente

Para builds web em que frontend e API rodam no mesmo dominio, `VITE_API_BASE_URL` pode ficar vazia.

Para builds Android, configure:

```env
VITE_API_BASE_URL=https://api.lembreto.com
```

Todas as chamadas feitas pelo cliente central em `src/api/client.ts` passam a resolver `/api/...` para essa URL quando a variavel esta presente.

Quando a API ficar em um dominio diferente do app web, configure tambem no backend:

```env
CORS_ALLOWED_ORIGINS=https://app.lembreto.com
```

O app Android via Capacitor roda com origem local (`https://localhost` neste projeto) e essa origem ja e aceita pela camada CORS da API.

## Sessao mobile

No navegador, a sessao continua usando cookie HttpOnly.

No Android nativo, o app salva o token em `@aparajita/capacitor-secure-storage`, que usa Android Keystore no Android. A restauracao de sessao chama `GET /api/auth/me` com `Authorization: Bearer <token>`, e o backend aceita esse fluxo sem depender de cookie.

## Comandos

Antes de compilar APK/AAB localmente, instale Android Studio com Android SDK e um JDK compativel. No Windows, confirme:

```bash
java -version
```

Se o comando nao existir, configure `JAVA_HOME` e adicione o Java ao `PATH`.

Gerar o build web e sincronizar com Android:

```bash
npm run mobile:sync
```

Abrir no Android Studio:

```bash
npm run android:open
```

Rodar em um aparelho/emulador:

```bash
npm run android:run
```

Build Android pelo Capacitor:

```bash
npm run android:build
```

Gerar APK e AAB release assinados:

```bash
npm run android:release
```

Para publicar na Google Play, gere um Android App Bundle (`.aab`) assinado pelo Android Studio. Para testes diretos, gere um APK assinado.

Artefatos gerados neste projeto:

- APK debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- APK release assinado: `android/app/build/outputs/apk/release/app-release.apk`
- AAB release assinado: `android/app/build/outputs/bundle/release/app-release.aab`

## Assinatura Android

A assinatura release usa `android/keystore.properties`, que e ignorado pelo Git. A keystore real foi criada fora do repositorio:

```text
C:\Users\pedro\.lembreto\android\lembreto-release.jks
```

Guarde backup seguro da keystore e do `android/keystore.properties`. Se essa chave for perdida depois que o app estiver publicado, nao sera possivel assinar atualizacoes com a mesma identidade.

## Pontos obrigatorios antes de producao

- Definir dominio final da API e configurar `CORS_ALLOWED_ORIGINS` para qualquer frontend web em dominio separado.
- Migrar push mobile para Firebase Cloud Messaging. O Web Push atual continua valido para navegador/PWA.
- Criar planos, organizacoes, membros e limites de uso antes de vender como SaaS multi-tenant.
- Configurar chaves de assinatura Android fora do repositorio.

## Proxima arquitetura SaaS

Tabelas centrais sugeridas:

- `organizations`
- `organization_members`
- `plans`
- `subscriptions`
- `usage_events`

As entidades de produto, como tarefas, notas, notificacoes e integracoes, devem ganhar `organization_id` ou `workspace_id` quando o SaaS deixar de ser apenas individual.

## Base multi-tenant implementada

A migration `202606040001_saas_organizations.sql` cria as tabelas SaaS centrais, adiciona `organization_id` nas principais entidades e faz backfill para uma organizacao pessoal por usuario existente.

Depois de revisar o ambiente alvo, aplique:

```bash
npm run migrate
```

O backend tambem passa a garantir uma organizacao pessoal em cadastro, login, login com Google e restauracao de sessao. O payload de usuario pode incluir:

```ts
currentOrganization: {
  id: string;
  name: string;
  slug: string;
  type: 'personal' | 'team';
  role: 'owner' | 'admin' | 'member' | 'viewer';
  planCode: string;
}
```

As consultas de tarefas, notas, notificacoes e fila de notificacoes ja usam `organization_id` como fronteira de dados do SaaS.

## Painel de workspace implementado

O endpoint `GET /api/organization` retorna a organizacao ativa, plano, limites, uso e membros. O endpoint `PUT /api/organization` permite renomear o workspace para usuarios `owner` ou `admin`.

No frontend, a aba `Configuracoes > Organizacao` agora mostra:

- nome e slug do workspace;
- papel do usuario;
- plano atual;
- uso de tarefas, membros e calendarios;
- lista de membros ativos;
- acao para renomear o workspace.

O proximo passo funcional e implementar convites, troca de papeis, selecao de workspace e billing real.

## Membros e selecao de workspace implementados

A migration `202606050001_workspace_memberships.sql` adiciona:

- `users.current_organization_id`;
- `organization_invitations`;
- indices para convites pendentes e workspace ativo.

O endpoint `/api/organization` agora tambem suporta:

- `POST /api/organization?action=switch` para trocar workspace ativo;
- `POST /api/organization?action=invite` para criar convite por e-mail e gerar token/link;
- `POST /api/organization?action=accept-invite` para aceitar convite;
- `PUT /api/organization?action=member` para alterar papel;
- `DELETE /api/organization?action=member` para remover membro;
- `DELETE /api/organization?action=invite` para revogar convite.

No frontend, `Configuracoes > Organizacao` agora permite trocar workspace, criar convite, aceitar convite por token, revogar convites pendentes, alterar papel de membros e remover membros nao proprietarios.

## Billing Mercado Pago implementado

O backend agora possui os endpoints:

- `POST /api/billing?action=checkout` para criar uma assinatura Mercado Pago (`preapproval`) dos planos Pro e Equipe;
- `POST /api/billing?action=portal` para abrir o link de gerenciamento/assinaturas do Mercado Pago;
- `POST /api/billing/webhook` para receber eventos assinados do Mercado Pago e atualizar `subscriptions`.

Variaveis necessarias no ambiente de producao:

```env
MERCADO_PAGO_ACCESS_TOKEN=
MERCADO_PAGO_WEBHOOK_SECRET=
MERCADO_PAGO_CURRENCY=BRL
MERCADO_PAGO_PRO_MONTHLY_AMOUNT=29.90
MERCADO_PAGO_TEAM_MONTHLY_AMOUNT=79.90
MERCADO_PAGO_WEBHOOK_URL=https://api.lembreto.com/api/billing/webhook
MERCADO_PAGO_SUBSCRIPTIONS_URL=https://www.mercadopago.com.br/subscriptions
```

## Setup do Mercado Pago

O Mercado Pago usa assinatura recorrente via API de `preapproval`. O Lembreto cria uma assinatura individual por workspace/plano, redireciona o usuario para o `init_point` retornado pela API e salva o `preapproval_id` em `subscriptions.provider_subscription_id`.

Para ativar em producao:

1. Crie uma aplicacao no painel de desenvolvedores do Mercado Pago.
2. Configure `MERCADO_PAGO_ACCESS_TOKEN` com o token privado da aplicacao.
3. Configure `MERCADO_PAGO_WEBHOOK_SECRET` com a assinatura secreta de webhook.
4. Configure `MERCADO_PAGO_WEBHOOK_URL` apontando para uma URL publica HTTPS do backend.
5. Ative os eventos de assinatura, principalmente `subscription_preapproval` e `subscription_authorized_payment`.

Valores padrao de preco:

```env
MERCADO_PAGO_CURRENCY=BRL
MERCADO_PAGO_PRO_MONTHLY_AMOUNT=29.90
MERCADO_PAGO_TEAM_MONTHLY_AMOUNT=79.90
```

O Mercado Pago nao envia webhooks para `localhost`. Para validar localmente, exponha o backend com uma URL publica temporaria ou teste em um ambiente de staging HTTPS.

O frontend mostra os controles de assinatura na aba `Configuracoes > Organizacao`, disponiveis para usuarios com permissao de billing.

O enforcement inicial de limites ja cobre:

- criacao de tarefas pelo limite `tasks`;
- novas conexoes de calendario pelo limite `calendar_integrations`.
- convites e aceite de convites pelo limite `members`, contando membros ativos e convites pendentes como assentos ocupados.

Tambem foi ajustada a unicidade de `calendar_integrations` para permitir uma conexao por workspace/usuario/provedor, em vez de uma unica conexao global por usuario.

O proximo passo funcional e preencher as variaveis reais do Mercado Pago na hospedagem e validar o fluxo real de checkout/webhook em modo teste/staging.
