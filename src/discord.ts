import type { Giveaway } from "./types";

const DISCORD_API = "https://discord.com/api/v10";

export class DiscordApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

function hexToBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2 !== 0) {
    throw new Error("Valor hexadecimal inválido.");
  }
  return Uint8Array.from(
    value.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
  );
}

export async function verifyDiscordRequest(
  publicKey: string,
  signature: string | null,
  timestamp: string | null,
  body: string,
): Promise<boolean> {
  if (!signature || !timestamp || !publicKey) return false;

  try {
    const key = await crypto.subtle.importKey(
      "raw",
      hexToBytes(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const message = new TextEncoder().encode(`${timestamp}${body}`);
    return crypto.subtle.verify(
      "Ed25519",
      key,
      hexToBytes(signature),
      message,
    );
  } catch {
    return false;
  }
}

async function discordApi<T>(
  token: string,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const details = await response.text();
    throw new DiscordApiError(
      `Discord API ${response.status}: ${details.slice(0, 500)}`,
      response.status,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json<T>();
}

export async function sendDiscordMessage(
  token: string,
  channelId: string,
  content: string,
): Promise<void> {
  await discordApi(token, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      allowed_mentions: { parse: [] },
    }),
  });
}

export async function editDiscordInteractionResponse(
  applicationId: string,
  interactionToken: string,
  content: string,
): Promise<void> {
  const response = await fetch(
    `${DISCORD_API}/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
      }),
    },
  );

  if (!response.ok) {
    throw new DiscordApiError(
      `Falha ao editar resposta do Discord: ${await response.text()}`,
      response.status,
    );
  }
}

export async function registerDiscordCommands(
  token: string,
  applicationId: string,
  deliveryMode: "dm" | "channel" | "both" = "dm",
): Promise<void> {
  const commands = [
    {
      name: "ativar",
      description: "Ativa avisos de jogos grátis nesta conversa",
    },
    {
      name: "agora",
      description: "Mostra os jogos grátis ativos",
    },
    {
      name: "ultimos7dias",
      description: "Mostra as ofertas registradas nos últimos sete dias",
    },
    {
      name: "plataformas",
      description: "Escolhe as lojas acompanhadas nesta conversa",
      options: [
        {
          type: 3,
          name: "lojas",
          description: "Ex.: steam epic gog; use todas para acompanhar tudo",
          required: true,
        },
      ],
    },
    {
      name: "status",
      description: "Mostra a configuração desta conversa",
    },
    {
      name: "parar",
      description: "Desativa os avisos automáticos nesta conversa",
    },
    {
      name: "ajuda",
      description: "Mostra os comandos disponíveis",
    },
    {
      name: "pendentes",
      description: "Lista solicitações aguardando aprovação",
    },
    {
      name: "aprovar",
      description: "Aprova um usuário para receber avisos",
      options: [{
        type: 3,
        name: "usuario",
        description: "ID do usuário exibido em /pendentes",
        required: true,
      }],
    },
    {
      name: "negar",
      description: "Nega o acesso de um usuário",
      options: [{
        type: 3,
        name: "usuario",
        description: "ID do usuário exibido em /pendentes",
        required: true,
      }],
    },
  ];

  const contexts = deliveryMode === "dm"
    ? [1]
    : deliveryMode === "channel"
    ? [0]
    : [0, 1];
  await discordApi(token, `/applications/${applicationId}/commands`, {
    method: "PUT",
    body: JSON.stringify(commands.map((command) => ({ ...command, contexts }))),
  });
}

function discordDate(value: string | null): string {
  if (!value) return "término não informado";
  const milliseconds = Date.parse(value);
  if (Number.isNaN(milliseconds)) return "término não informado";
  return `<t:${Math.floor(milliseconds / 1000)}:f>`;
}

function formatDiscordGiveaway(giveaway: Giveaway): string {
  const stores = giveaway.platforms.join(", ");
  const worth =
    giveaway.worth && giveaway.worth.toLowerCase() !== "n/a"
      ? `\n💰 Preço anterior: ${giveaway.worth}`
      : "";
  const end = giveaway.active
    ? `⏳ Disponível até: ${discordDate(giveaway.endsAt)}`
    : "⚪ Promoção encerrada";

  return [
    `🎮 **${giveaway.title}**`,
    `🏪 ${stores}${worth}`,
    end,
    `🔗 [Abrir oferta](${giveaway.giveawayUrl})`,
  ].join("\n");
}

export interface DiscordMessageChunk {
  content: string;
  giveaways: Giveaway[];
}

export function chunkDiscordGiveaways(
  giveaways: Giveaway[],
  heading: string,
  maxLength = 1900,
): DiscordMessageChunk[] {
  if (giveaways.length === 0) return [];
  const footer = "\n\nFonte: [GamerPower](https://www.gamerpower.com/)";
  const chunks: DiscordMessageChunk[] = [];
  let content = heading;
  let included: Giveaway[] = [];

  for (const giveaway of giveaways) {
    const block = formatDiscordGiveaway(giveaway);
    if (
      included.length > 0 &&
      `${content}\n\n${block}${footer}`.length > maxLength
    ) {
      chunks.push({ content: `${content}${footer}`, giveaways: included });
      content = `**Continuação**\n\n${block}`;
      included = [giveaway];
    } else {
      content = `${content}\n\n${block}`;
      included.push(giveaway);
    }
  }

  chunks.push({ content: `${content}${footer}`, giveaways: included });
  return chunks;
}
