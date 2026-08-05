# Landing Lembreto

Projeto separado da landing page publica do Lembreto.

## Rodar localmente

```bash
npm install
npm run dev
```

## Variaveis de ambiente

Copie `.env.example` para `.env.local` e ajuste:

- `VITE_API_BASE_URL`: URL da hospedagem/API do sistema Lembreto.
- `VITE_APP_URL`: URL para onde o usuario deve ir depois de login/cadastro.
- `VITE_DESKTOP_DOWNLOAD_URL`: link do instalador desktop exibido para usuarios em computador.
- `VITE_MOBILE_DOWNLOAD_URL`: link do instalador mobile exibido para usuarios em celular/tablet.
- `VITE_RECAPTCHA_SITE_KEY`: chave publica do reCAPTCHA, se usada.

Se preferir servir os instaladores pela propria landing, coloque os arquivos em `public/downloads` e use os caminhos `/downloads/lembreto-desktop.exe` e `/downloads/lembreto-mobile.apk`.

## Build

```bash
npm run build
```
