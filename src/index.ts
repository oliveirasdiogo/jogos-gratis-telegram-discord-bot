import { handleTelegramUpdate } from "./bot";
import { handleDiscordInteraction } from "./discord-bot";
import { runDiscordScheduledCheck } from "./discord-service";
import { registerDiscordCommands } from "./discord";
import { runScheduledCheck } from "./service";
import { configureWebhook } from "./telegram";
import type { Env, TelegramUpdate } from "./types";

function secretsEqual(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function handleAdminSetup(request: Request, env: Env): Promise<Response> {
  const authorization = request.headers.get("Authorization");
  const expected = env.ADMIN_SETUP_KEY
    ? `Bearer ${env.ADMIN_SETUP_KEY}`
    : undefined;
  if (!secretsEqual(authorization, expected)) {
    return json({ ok: false, error: "Não autorizado." }, 401);
  }

  const origin = new URL(request.url).origin;
  const webhookUrl = `${origin}/telegram/webhook`;
  await configureWebhook(
    env.TELEGRAM_BOT_TOKEN,
    webhookUrl,
    env.TELEGRAM_WEBHOOK_SECRET,
  );

  return json({ ok: true, webhook_url: webhookUrl, commands_configured: true });
}

async function handleDiscordSetup(
  request: Request,
  env: Env,
): Promise<Response> {
  const authorization = request.headers.get("Authorization");
  const expected = env.ADMIN_SETUP_KEY
    ? `Bearer ${env.ADMIN_SETUP_KEY}`
    : undefined;
  if (!secretsEqual(authorization, expected)) {
    return json({ ok: false, error: "Não autorizado." }, 401);
  }

  await registerDiscordCommands(
    env.DISCORD_BOT_TOKEN,
    env.DISCORD_APPLICATION_ID,
    env.DISCORD_DELIVERY_MODE === "channel" ||
        env.DISCORD_DELIVERY_MODE === "both"
      ? env.DISCORD_DELIVERY_MODE
      : "dm",
  );
  return json({
    ok: true,
    scope: "global",
    context: env.DISCORD_DELIVERY_MODE ?? "dm",
    interactions_endpoint: `${new URL(request.url).origin}/discord/interactions`,
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "jogos-gratis-telegram-discord-bot",
        time: new Date().toISOString(),
      });
    }

    if (request.method === "GET" && url.pathname === "/") {
      return new Response(
        "Bot de jogos grátis para Telegram e Discord ativo. Use /health.",
      );
    }

    if (request.method === "POST" && url.pathname === "/admin/setup-webhook") {
      try {
        return await handleAdminSetup(request, env);
      } catch (error) {
        console.error("Falha ao configurar o webhook.", error);
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/admin/setup-discord"
    ) {
      try {
        return await handleDiscordSetup(request, env);
      } catch (error) {
        console.error("Falha ao configurar comandos Discord.", error);
        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          },
          500,
        );
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === "/discord/interactions"
    ) {
      return handleDiscordInteraction(request, env, ctx);
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      const webhookSecret = request.headers.get(
        "X-Telegram-Bot-Api-Secret-Token",
      );
      if (!secretsEqual(webhookSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
        return json({ ok: false, error: "Webhook não autorizado." }, 401);
      }

      let update: TelegramUpdate;
      try {
        update = (await request.json()) as TelegramUpdate;
      } catch {
        return json({ ok: false, error: "JSON inválido." }, 400);
      }

      ctx.waitUntil(
        handleTelegramUpdate(update, env).catch((error) => {
          console.error("Falha ao processar uma atualização do Telegram.", error);
        }),
      );
      return json({ ok: true });
    }

    return json({ ok: false, error: "Rota não encontrada." }, 404);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const activeGiveaways = await runScheduledCheck(env);
        await runDiscordScheduledCheck(env, activeGiveaways);
      })().catch((error) => {
        console.error("Falha na verificação agendada.", error);
        throw error;
      }),
    );
  },
} satisfies ExportedHandler<Env>;
