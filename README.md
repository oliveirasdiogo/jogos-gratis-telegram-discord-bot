# Jogos Grátis — Telegram + Discord

[![Verificações](https://github.com/oliveirasdiogo/jogos-gratis-telegram-discord-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/oliveirasdiogo/jogos-gratis-telegram-discord-bot/actions/workflows/ci.yml)
[![TypeScript 7](https://img.shields.io/badge/TypeScript-7.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Telegram](https://img.shields.io/badge/Telegram-Bot-26A5E4?logo=telegram&logoColor=white)](https://core.telegram.org/bots/api)
[![Discord](https://img.shields.io/badge/Discord-App-5865F2?logo=discord&logoColor=white)](https://docs.discord.com/developers/)
[![Licença MIT](https://img.shields.io/badge/Licen%C3%A7a-MIT-2EA44F)](LICENSE)

Bot serverless que consulta jogos grátis para PC e envia avisos pelo Telegram e
pelo Discord. As duas plataformas compartilham catálogo, filtros e histórico,
mas mantêm inscrições e controle de entregas separados.

## Índice

- [Recursos](#recursos)
- [Arquitetura](#arquitetura)
- [Pré-requisitos](#pré-requisitos)
- [Instalação](#instalação)
- [Configuração do Telegram](#configuração-do-telegram)
- [Configuração do Discord](#configuração-do-discord)
- [Publicação](#publicação)
- [Comandos](#comandos)
- [Segurança](#segurança)
- [Desenvolvimento](#desenvolvimento)

## Recursos

- Avisos automáticos de jogos completos gratuitos;
- Steam, Epic Games Store, GOG, itch.io, DRM-Free e outras lojas de PC;
- Deduplicação independente por conversa do Telegram e canal do Discord;
- Preferências de lojas por destino;
- Histórico dos últimos sete dias;
- Acesso configurável no Telegram;
- Permissão **Gerenciar servidor** para configurar canais Discord;
- Execução gratuita ou de baixo custo em Cloudflare Workers e D1;
- Audit de dependências, testes e tipagem no GitHub Actions.

## Arquitetura

```text
Cron Trigger
     |
     v
GamerPower API ---> catálogo compartilhado no D1
                         |
                +--------+--------+
                |                 |
         Telegram Bot       Discord App
        webhook seguro    Interactions HTTP
```

O Discord usa webhooks de Interactions, sem conexão permanente com o Gateway.
As requisições são verificadas com a chave pública Ed25519 da aplicação.

## Pré-requisitos

- Node.js 22 ou superior;
- uma conta Cloudflare;
- um bot criado pelo `@BotFather`;
- uma aplicação no Discord Developer Portal;
- Git.

## Instalação

```bash
git clone https://github.com/oliveirasdiogo/jogos-gratis-telegram-discord-bot.git
cd jogos-gratis-telegram-discord-bot
npm install
```

No Windows PowerShell, use `npm.cmd` e `npx.cmd` caso a política de execução
bloqueie os arquivos `.ps1`.

Copie `wrangler.example.jsonc` para `wrangler.jsonc`, crie um banco D1 e coloque
o `database_id` no arquivo:

```bash
npx wrangler login
npx wrangler d1 create jogos-gratis-multiplataforma
npm run db:migrate:remote
```

## Configuração do Telegram

Cadastre os segredos:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OWNER_CHAT_ID
```

O guia detalhado, incluindo Windows e modos de acesso, está em
[docs/TELEGRAM.md](docs/TELEGRAM.md).

## Configuração do Discord

Crie a aplicação, configure permissões e instale-a no servidor de teste.
`DISCORD_APPLICATION_ID` e `DISCORD_PUBLIC_KEY` são identificadores públicos,
mas podem ser cadastrados junto às variáveis de implantação por conveniência.
O `DISCORD_BOT_TOKEN` é o único segredo Discord:

```bash
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
```

Por padrão, os avisos são enviados em DM e novos usuários precisam da aprovação
do proprietário. `DISCORD_DELIVERY_MODE` permite escolher `dm`, `channel` ou
`both`; `DISCORD_ACCESS_MODE` aceita `approval`, `owner_only` ou `open`.

O passo a passo completo está em [docs/DISCORD.md](docs/DISCORD.md).

## Publicação

```bash
npm run deploy
```

Depois da publicação:

1. configure o webhook do Telegram pelo endpoint administrativo;
2. registre os comandos Discord pelo endpoint administrativo;
3. informe ao Discord a URL pública `/discord/interactions`.

Os exemplos exatos estão nos guias de cada plataforma.

## Comandos

| Telegram | Discord | Função |
|---|---|---|
| `/start` | `/ativar` | Ativar avisos |
| `/agora` | `/agora` | Mostrar ofertas ativas |
| `/ultimos7dias` | `/ultimos7dias` | Mostrar histórico |
| `/plataformas` | `/plataformas` | Escolher lojas |
| `/status` | `/status` | Mostrar configuração |
| `/parar` | `/parar` | Desativar avisos |
| `/ajuda` | `/ajuda` | Mostrar ajuda |

No Discord, ativar, parar e alterar plataformas exige a permissão
**Gerenciar servidor** apenas quando o destino for um canal. O proprietário
administra solicitações com `/pendentes`, `/aprovar` e `/negar`.

## Segurança

- Nunca publique tokens, chaves privadas ou o `database_id`; o Application ID e
  a Public Key do Discord podem ser públicos;
- segredos reais devem ser cadastrados com `wrangler secret put`;
- o webhook Telegram usa um segredo próprio;
- Interactions do Discord são rejeitadas quando a assinatura Ed25519 é inválida;
- menções do Discord são desativadas nas mensagens automáticas;
- consulte [SECURITY.md](SECURITY.md) para resposta a vazamentos.

## Desenvolvimento

```bash
npm run typecheck
npm test
npm run check
npm audit --audit-level=high
```

O arquivo `.dev.vars.example` documenta as variáveis locais sem conter
credenciais reais.
