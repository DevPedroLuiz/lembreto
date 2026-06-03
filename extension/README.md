# Extensao Lembreto

Extensao Manifest V3 para criar lembretes rapidamente pelo navegador.

## Instalar em modo desenvolvedor

1. Abra `opera://extensions`, `chrome://extensions` ou `edge://extensions`.
2. Ative o modo desenvolvedor.
3. Clique em `Carregar sem compactacao`.
4. Selecione a pasta `extension` deste projeto.

Em producao, baixe `lembreto-extension.zip` pelo painel `Configuracoes > Integracoes > Extensao Lembreto`, extraia o arquivo e selecione a pasta extraida.

## Configurar

No popup da extensao, informe o endereco onde o Lembreto esta rodando.

- Producao: `https://lembreto.vercel.app`
- Desenvolvimento: `http://localhost:3001`

Depois abra o Lembreto em `Configuracoes > Integracoes > Extensao Lembreto` e clique em `Ativar extensao`.
Tambem da para entrar pelo popup com e-mail/senha ou usar `Usar sessao do site`.

## Recursos

- Modo sistema completo em uma aba da extensao.
- Criacao manual de lembrete.
- Comando de texto para a IA criar, listar ou organizar lembretes.
- Salvamento rapido da pagina atual com titulo e link.
- Lista de proximos lembretes pendentes com acao de abrir ou concluir.
- Ativacao a partir da aba Integracoes do Lembreto.
- Sincronizacao com o cookie de sessao do site.
- Captura da parte visivel da aba atual.
- Analise da captura pelo endpoint `/api/assistant/screenshot`.
- Criacao automatica do lembrete com os dados encontrados pela IA.

Para a analise por imagem funcionar, o backend precisa ter `GEMINI_API_KEY` configurada.
