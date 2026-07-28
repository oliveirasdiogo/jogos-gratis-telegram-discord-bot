# Configuração do Discord

O modo padrão envia avisos por mensagem direta (DM). A mesma instalação pode
ser configurada para canais de servidor ou para os dois destinos.

## 1. Criar e instalar a aplicação

1. No [Discord Developer Portal](https://discord.com/developers/applications),
   crie uma aplicação;
2. em **General Information**, copie o Application ID e a Public Key;
3. em **Bot**, use **Reset Token** e guarde o token como senha;
4. em **Installation**, habilite `applications.commands` e `bot`;
5. para uso em canais, conceda também `Send Messages`;
6. instale a aplicação em um servidor compartilhado com as pessoas que usarão
   as DMs do bot.

Nunca publique o bot token.

## 2. Obter seu ID de usuário

No Discord, abra **Configurações > Avançado**, ative **Modo desenvolvedor**,
clique com o botão direito no seu perfil e escolha **Copiar ID do usuário**.
Esse valor será `DISCORD_OWNER_USER_ID`.

## 3. Escolher destino e acesso

Adicione ao bloco `vars` de `wrangler.jsonc`:

```jsonc
"DISCORD_OWNER_USER_ID": "SEU_ID_DE_USUARIO",
"DISCORD_ACCESS_MODE": "approval",
"DISCORD_DELIVERY_MODE": "dm"
```

Destinos disponíveis:

- `dm`: somente mensagens diretas; é o padrão recomendado para uso pessoal;
- `channel`: somente canais de servidor;
- `both`: permite que cada pessoa ative uma DM ou um canal.

Modos de acesso:

- `approval`: novos usuários aguardam sua aprovação;
- `owner_only`: somente o proprietário;
- `open`: qualquer usuário pode ativar.

Ao mudar `DISCORD_DELIVERY_MODE`, execute novamente
`/admin/setup-discord` para atualizar os contextos dos comandos.

## 4. Cadastrar variáveis na Cloudflare

Application ID e Public Key são identificadores públicos. Bot token e
`ADMIN_SETUP_KEY` são segredos:

```bash
npx wrangler secret put DISCORD_APPLICATION_ID
npx wrangler secret put DISCORD_PUBLIC_KEY
npx wrangler secret put DISCORD_BOT_TOKEN
npx wrangler secret put ADMIN_SETUP_KEY
```

No Windows PowerShell, use `npx.cmd` se os scripts `.ps1` estiverem bloqueados.

## 5. Migrar, publicar e registrar comandos

```bash
npm run db:migrate:remote
npm run deploy
```

No Linux:

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_SETUP_KEY" \
  https://SEU_WORKER.workers.dev/admin/setup-discord
```

No Windows PowerShell:

```powershell
$seguro = Read-Host "ADMIN_SETUP_KEY" -AsSecureString
$chave = [System.Net.NetworkCredential]::new("", $seguro).Password
$cabecalhos = @{ Authorization = "Bearer $chave" }
Invoke-RestMethod -Method Post `
  -Uri "https://SEU_WORKER.workers.dev/admin/setup-discord" `
  -Headers $cabecalhos
```

Em **General Information > Interactions Endpoint URL**, informe:

```text
https://SEU_WORKER.workers.dev/discord/interactions
```

## 6. Usar em DM

Abra a conversa privada com o bot e execute `/ativar`. O proprietário é
aprovado automaticamente. Outras pessoas ficam pendentes no modo `approval`.

O proprietário administra solicitações com:

```text
/pendentes
/aprovar usuario:ID
/negar usuario:ID
```

A pessoa recebe a decisão na própria DM.

## 7. Usar em canal

Defina `DISCORD_DELIVERY_MODE` como `channel` ou `both`, registre novamente os
comandos e execute `/ativar` no canal desejado. Ativar, parar ou alterar lojas
em um canal exige **Gerenciar servidor**.

## Solução de problemas

- comandos não aparecem em DM: confirme que são globais, que a aplicação
  compartilha um servidor com você e registre-os novamente;
- assinatura inválida: confira `DISCORD_PUBLIC_KEY`;
- erro 403 no canal: reinstale o bot com `Send Messages`;
- avisos não chegam: confira `/status`, as migrações e `npx wrangler tail`.
