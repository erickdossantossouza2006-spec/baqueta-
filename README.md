# Baqueta

App para aprender bateria lendo partitura, do iniciante ao avançado.

Publicado com GitHub Pages. Abra o site no celular e use "Adicionar à tela inicial" para instalar.

---

## Prospecta — prospecção de youtubers (pasta `prospect/`)

App de celular (PWA) para achar youtubers por tags, pegar e-mail e redes sociais e enviar mensagens personalizadas.

Endereço depois de publicado: `https://<seu-usuario>.github.io/baqueta-/prospect/` — abra no celular e use "Adicionar à tela inicial".

**O que faz**

- Busca vídeos/canais no YouTube pelas tags (ex.: `minecraft adventure`, `smp`), com "todas as tags" ou "qualquer uma" e exclusão com `-` (ex.: `-roblox`).
- Filtra por faixa de inscritos (500, 1 mil, … 1 milhão, 5 milhões, ou valor personalizado), idioma, país e data do último vídeo.
- Lê a descrição do canal e dos últimos vídeos e extrai **e-mail**, **X/Twitter**, **Discord** (servidor ou usuário), Instagram, TikTok, Twitch, Telegram, WhatsApp e links de bio (Linktree etc.), inclusive e-mails escondidos como `nome [at] gmail [dot] com`.
- Mensagem padrão editável com variáveis: `(cliente)`, `(canal)`, `(inscritos)`, `(subs)`, `(handle)`, `(link)` — trocadas pelo dado de cada youtuber na hora de enviar.
- Botão de enviar: e-mail primeiro; se não tiver, DM no X, Instagram, Discord, WhatsApp, Telegram… (copia a mensagem personalizada e abre o perfil/conversa).
- Envio em massa: fila no app de e-mail do celular, ou envio automático pelo Gmail (configuração única no Google Cloud, explicada dentro do app).
- Leads com status (Novo, Contatado, Respondeu, Fechou, Descartado), notas, histórico, exportação CSV e backup.

**Requisitos**: uma chave gratuita da YouTube Data API v3 (passo a passo em Ajustes, dentro do app). Os dados ficam só no aparelho.

**Testes**: `node --test prospect/tests/core.test.js`
