import {
  deactivateDiscordSubscriber,
  getDiscordSubscriber,
  listPendingDiscordSubscribers,
  recordDiscordManualDelivery,
  replaceDiscordPlatforms,
  reviewDiscordAccess,
  upsertDiscordSubscriber,
  type DiscordSubscriber,
} from "./discord-db";
import {
  chunkDiscordGiveaways,
  editDiscordInteractionResponse,
  sendDiscordMessage,
  verifyDiscordRequest,
} from "./discord";
import {
  platformNames,
  resolvePlatformSelection,
} from "./domain";
import { getGiveawaysFromLastSevenDays } from "./db";
import {
  filterByPreferences,
  refreshCatalog,
} from "./service";
import type { Env, Giveaway } from "./types";

interface DiscordOption {
  name: string;
  value?: string | number | boolean;
}

interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: {
    permissions?: string;
    user?: { id: string; username: string };
  };
  user?: { id: string; username: string };
  data?: {
    name?: string;
    options?: DiscordOption[];
  };
}

const EPHEMERAL = 64;
const MANAGE_GUILD = 1n << 5n;

function hasManageGuild(interaction: DiscordInteraction): boolean {
  try {
    return (
      BigInt(interaction.member?.permissions ?? "0") & MANAGE_GUILD
    ) === MANAGE_GUILD;
  } catch {
    return false;
  }
}

function deliveryMode(env: Env): "dm" | "channel" | "both" {
  return env.DISCORD_DELIVERY_MODE === "channel" ||
      env.DISCORD_DELIVERY_MODE === "both"
    ? env.DISCORD_DELIVERY_MODE
    : "dm";
}

function accessMode(env: Env): "approval" | "owner_only" | "open" {
  return env.DISCORD_ACCESS_MODE === "owner_only" ||
      env.DISCORD_ACCESS_MODE === "open"
    ? env.DISCORD_ACCESS_MODE
    : "approval";
}

function interactionResponse(
  type: number,
  data?: Record<string, unknown>,
): Response {
  return Response.json(data ? { type, data } : { type });
}

function optionValue(
  interaction: DiscordInteraction,
  name: string,
): string | undefined {
  const value = interaction.data?.options?.find((option) =>
    option.name === name
  )?.value;
  return typeof value === "string" ? value : undefined;
}

async function requireSubscriber(
  env: Env,
  channelId: string,
): Promise<DiscordSubscriber | null> {
  const subscriber = await getDiscordSubscriber(env.DB, channelId);
  return subscriber?.active ? subscriber : null;
}

async function deliverGiveaways(
  env: Env,
  interaction: DiscordInteraction,
  giveaways: Giveaway[],
  heading: string,
  recordDelivery: boolean,
): Promise<void> {
  if (!interaction.channel_id) return;
  if (giveaways.length === 0) {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      "Nenhuma oferta foi encontrada para as plataformas deste canal.",
    );
    return;
  }

  const chunks = chunkDiscordGiveaways(giveaways, heading);
  const first = chunks.shift();
  if (!first) return;

  await editDiscordInteractionResponse(
    interaction.application_id,
    interaction.token,
    first.content,
  );
  if (recordDelivery) {
    await recordDiscordManualDelivery(
      env.DB,
      interaction.channel_id,
      first.giveaways,
    );
  }

  for (const chunk of chunks) {
    await sendDiscordMessage(
      env.DISCORD_BOT_TOKEN,
      interaction.channel_id,
      chunk.content,
    );
    if (recordDelivery) {
      await recordDiscordManualDelivery(
        env.DB,
        interaction.channel_id,
        chunk.giveaways,
      );
    }
  }
}

async function processCommand(
  interaction: DiscordInteraction,
  env: Env,
): Promise<void> {
  const channelId = interaction.channel_id;
  const user = interaction.member?.user ?? interaction.user;
  const name = interaction.data?.name;
  if (!channelId || !user || !name) {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      "Não foi possível identificar esta conversa.",
    );
    return;
  }

  const mode = deliveryMode(env);
  if (interaction.guild_id && mode === "dm") {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      "Este bot envia avisos por mensagem direta. Abra a conversa privada com o bot e use o comando novamente.",
    );
    return;
  }
  if (!interaction.guild_id && mode === "channel") {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      "Esta instalação recebe avisos em canais de servidor. Use o comando no canal desejado.",
    );
    return;
  }

  const isOwner = user.id === env.DISCORD_OWNER_USER_ID?.trim();
  const isGuild = Boolean(interaction.guild_id);
  const ownerCommands = new Set(["pendentes", "aprovar", "negar"]);
  if (ownerCommands.has(name)) {
    if (!isOwner) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Este comando está disponível somente para o proprietário do bot.",
      );
      return;
    }

    if (name === "pendentes") {
      const pending = await listPendingDiscordSubscribers(env.DB);
      const text = pending.length === 0
        ? "Não há solicitações pendentes."
        : [
            "**Solicitações pendentes**",
            ...pending.map((entry) =>
              `• usuário \`${entry.activatedBy}\` — destino \`${entry.channelId}\``
            ),
          ].join("\n");
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        text,
      );
      return;
    }

    const requestedUserId = optionValue(interaction, "usuario")?.trim();
    if (!requestedUserId) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Informe o ID exibido por `/pendentes`.",
      );
      return;
    }
    const approved = name === "aprovar";
    const reviewed = await reviewDiscordAccess(
      env.DB,
      requestedUserId,
      approved ? "approved" : "denied",
    );
    if (!reviewed) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Solicitação não encontrada.",
      );
      return;
    }
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      approved
        ? `✅ Usuário \`${requestedUserId}\` aprovado.`
        : `🚫 Usuário \`${requestedUserId}\` negado.`,
    );
    await sendDiscordMessage(
      env.DISCORD_BOT_TOKEN,
      reviewed.channelId,
      approved
        ? "✅ Seu acesso aos avisos de jogos grátis foi aprovado."
        : "🚫 Sua solicitação de acesso aos avisos foi negada.",
    );
    return;
  }

  if (name === "ativar") {
    if (isGuild && !hasManageGuild(interaction)) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Você precisa da permissão **Gerenciar servidor** para ativar este canal.",
      );
      return;
    }
    const configuredAccess = accessMode(env);
    if (configuredAccess === "owner_only" && !isOwner) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Esta instalação é exclusiva do proprietário.",
      );
      return;
    }
    const status = isOwner || configuredAccess === "open"
      ? "approved"
      : "pending";
    await upsertDiscordSubscriber(
      env.DB,
      channelId,
      interaction.guild_id ?? "direct-message",
      user.id,
      status,
    );
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      status === "approved"
        ? "✅ Avisos ativados. Todas as lojas estão selecionadas."
        : "⏳ Solicitação registrada. Você receberá uma mensagem após a análise do proprietário.",
    );
    return;
  }

  if (name === "ajuda") {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      [
        "**Comandos**",
        "`/ativar` — ativa avisos nesta conversa privada",
        "`/agora` — mostra ofertas ativas",
        "`/ultimos7dias` — mostra o histórico recente",
        "`/plataformas lojas:steam epic gog` — escolhe lojas",
        "`/status` — mostra a configuração",
        "`/parar` — desativa os avisos",
        ...(isOwner
          ? [
              "`/pendentes` — lista solicitações",
              "`/aprovar usuario:ID` — aprova um usuário",
              "`/negar usuario:ID` — nega um usuário",
            ]
          : []),
      ].join("\n"),
    );
    return;
  }

  const subscriber = await requireSubscriber(env, channelId);
  if (!subscriber) {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      "Os avisos não estão ativos nesta conversa. Use `/ativar`.",
    );
    return;
  }

  if (name === "parar") {
    if (isGuild && !hasManageGuild(interaction)) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Você precisa da permissão **Gerenciar servidor** para desativar este canal.",
      );
      return;
    }
    await deactivateDiscordSubscriber(env.DB, channelId);
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      "🔕 Avisos automáticos desativados nesta conversa.",
    );
    return;
  }

  if (name === "status") {
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      [
        "**Status da conversa privada**",
        `Avisos: ${subscriber.active ? "✅ ativos" : "🔕 desativados"}`,
        `Plataformas: ${platformNames(subscriber.platforms)}`,
        `Verificação: a cada ${env.CHECK_INTERVAL_LABEL ?? "30 minutos"}`,
      ].join("\n"),
    );
    return;
  }

  if (name === "plataformas") {
    if (isGuild && !hasManageGuild(interaction)) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        "Você precisa da permissão **Gerenciar servidor** para alterar este canal.",
      );
      return;
    }
    const raw = optionValue(interaction, "lojas") ?? "";
    const selection = resolvePlatformSelection(raw.split(/[\s,]+/));
    if (!selection.ok) {
      await editDiscordInteractionResponse(
        interaction.application_id,
        interaction.token,
        `${selection.error} Use: steam, epic, gog, itchio, drm-free, pc ou todas.`,
      );
      return;
    }
    await replaceDiscordPlatforms(env.DB, channelId, selection.platforms);
    await editDiscordInteractionResponse(
      interaction.application_id,
      interaction.token,
      `✅ Plataformas atualizadas: ${platformNames(selection.platforms)}.`,
    );
    return;
  }

  if (name === "agora") {
    const active = filterByPreferences(
      await refreshCatalog(env),
      subscriber.platforms,
    );
    await deliverGiveaways(
      env,
      interaction,
      active,
      `🎁 **Jogos grátis ativos (${active.length})**`,
      true,
    );
    return;
  }

  if (name === "ultimos7dias") {
    const recent = filterByPreferences(
      await getGiveawaysFromLastSevenDays(env.DB),
      subscriber.platforms,
    );
    await deliverGiveaways(
      env,
      interaction,
      recent,
      `🗓 **Jogos encontrados nos últimos 7 dias (${recent.length})**`,
      false,
    );
    return;
  }

  await editDiscordInteractionResponse(
    interaction.application_id,
    interaction.token,
    "Comando não reconhecido. Use `/ajuda`.",
  );
}

export async function handleDiscordInteraction(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const body = await request.text();
  const valid = await verifyDiscordRequest(
    env.DISCORD_PUBLIC_KEY,
    request.headers.get("X-Signature-Ed25519"),
    request.headers.get("X-Signature-Timestamp"),
    body,
  );
  if (!valid) return new Response("Assinatura inválida.", { status: 401 });

  let interaction: DiscordInteraction;
  try {
    interaction = JSON.parse(body) as DiscordInteraction;
  } catch {
    return new Response("JSON inválido.", { status: 400 });
  }

  if (interaction.type === 1) return interactionResponse(1);
  if (interaction.type !== 2) {
    return interactionResponse(4, {
      content: "Tipo de interação não suportado.",
      flags: EPHEMERAL,
    });
  }

  ctx.waitUntil(
    processCommand(interaction, env).catch(async (error) => {
      console.error("Falha ao processar comando Discord.", error);
      try {
        await editDiscordInteractionResponse(
          interaction.application_id,
          interaction.token,
          "Ocorreu um erro ao processar o comando. Tente novamente.",
        );
      } catch (editError) {
        console.error("Falha ao responder erro no Discord.", editError);
      }
    }),
  );
  return interactionResponse(5, { flags: EPHEMERAL });
}
