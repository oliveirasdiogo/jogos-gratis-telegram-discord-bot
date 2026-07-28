import {
  ALL_PLATFORMS,
  type Giveaway,
  type PlatformSlug,
} from "./types";

interface DiscordSubscriberRow {
  channel_id: string;
  guild_id: string;
  activated_by: string;
  active: number;
  access_status: DiscordAccessStatus;
  platforms: string | null;
}

export interface DiscordSubscriber {
  channelId: string;
  guildId: string;
  activatedBy: string;
  active: boolean;
  accessStatus: DiscordAccessStatus;
  platforms: PlatformSlug[];
}

export type DiscordAccessStatus = "pending" | "approved" | "denied";

function parsePlatforms(value: string | null): PlatformSlug[] {
  if (!value) return [];
  const valid = new Set<string>(ALL_PLATFORMS);
  return value
    .split(",")
    .filter((platform): platform is PlatformSlug => valid.has(platform));
}

function rowToSubscriber(row: DiscordSubscriberRow): DiscordSubscriber {
  return {
    channelId: row.channel_id,
    guildId: row.guild_id,
    activatedBy: row.activated_by,
    active: row.active === 1,
    accessStatus: row.access_status,
    platforms: parsePlatforms(row.platforms),
  };
}

const SELECT_SUBSCRIBER = `
  SELECT
    s.channel_id,
    s.guild_id,
    s.activated_by,
    s.active,
    s.access_status,
    group_concat(sp.platform) AS platforms
  FROM discord_subscribers s
  LEFT JOIN discord_subscriber_platforms sp
    ON sp.channel_id = s.channel_id
`;

export async function upsertDiscordSubscriber(
  db: D1Database,
  channelId: string,
  guildId: string,
  activatedBy: string,
  accessStatus: DiscordAccessStatus,
): Promise<void> {
  const existingPreferences = await db
    .prepare(
      `SELECT count(*) AS total
       FROM discord_subscriber_platforms
       WHERE channel_id = ?`,
    )
    .bind(channelId)
    .first<{ total: number }>();

  await db
    .prepare(
      `INSERT INTO discord_subscribers (
         channel_id, guild_id, activated_by, active, access_status
       ) VALUES (?, ?, ?, 1, ?)
       ON CONFLICT(channel_id) DO UPDATE SET
         guild_id = excluded.guild_id,
         activated_by = excluded.activated_by,
         active = 1,
         access_status = CASE
           WHEN discord_subscribers.access_status = 'approved'
             THEN 'approved'
           ELSE excluded.access_status
         END,
         updated_at = CURRENT_TIMESTAMP`,
    )
    .bind(channelId, guildId, activatedBy, accessStatus)
    .run();

  if (!existingPreferences || existingPreferences.total === 0) {
    await db.batch(
      ALL_PLATFORMS.map((platform) =>
        db
          .prepare(
            `INSERT OR IGNORE INTO discord_subscriber_platforms (
               channel_id, platform
             ) VALUES (?, ?)`,
          )
          .bind(channelId, platform),
      ),
    );
  }
}

export async function getDiscordSubscriber(
  db: D1Database,
  channelId: string,
): Promise<DiscordSubscriber | null> {
  const row = await db
    .prepare(
      `${SELECT_SUBSCRIBER}
       WHERE s.channel_id = ?
       GROUP BY s.channel_id, s.guild_id, s.activated_by, s.active,
                s.access_status`,
    )
    .bind(channelId)
    .first<DiscordSubscriberRow>();

  return row ? rowToSubscriber(row) : null;
}

export async function listActiveDiscordSubscribers(
  db: D1Database,
): Promise<DiscordSubscriber[]> {
  const result = await db
    .prepare(
      `${SELECT_SUBSCRIBER}
       WHERE s.active = 1 AND s.access_status = 'approved'
       GROUP BY s.channel_id, s.guild_id, s.activated_by, s.active,
                s.access_status`,
    )
    .all<DiscordSubscriberRow>();

  return result.results.map(rowToSubscriber);
}

export async function listPendingDiscordSubscribers(
  db: D1Database,
): Promise<DiscordSubscriber[]> {
  const result = await db.prepare(
    `${SELECT_SUBSCRIBER}
     WHERE s.access_status = 'pending'
     GROUP BY s.channel_id, s.guild_id, s.activated_by, s.active,
              s.access_status
     ORDER BY datetime(s.created_at)`,
  ).all<DiscordSubscriberRow>();
  return result.results.map(rowToSubscriber);
}

export async function reviewDiscordAccess(
  db: D1Database,
  userId: string,
  status: "approved" | "denied",
): Promise<DiscordSubscriber | null> {
  await db.prepare(
    `UPDATE discord_subscribers
     SET access_status = ?, active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE activated_by = ?`,
  ).bind(status, status === "approved" ? 1 : 0, userId).run();

  const row = await db.prepare(
    `${SELECT_SUBSCRIBER}
     WHERE s.activated_by = ?
     GROUP BY s.channel_id, s.guild_id, s.activated_by, s.active,
              s.access_status
     ORDER BY datetime(s.updated_at) DESC
     LIMIT 1`,
  ).bind(userId).first<DiscordSubscriberRow>();
  return row ? rowToSubscriber(row) : null;
}

export async function deactivateDiscordSubscriber(
  db: D1Database,
  channelId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE discord_subscribers
       SET active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE channel_id = ?`,
    )
    .bind(channelId)
    .run();
}

export async function replaceDiscordPlatforms(
  db: D1Database,
  channelId: string,
  platforms: PlatformSlug[],
): Promise<void> {
  await db.batch([
    db
      .prepare(
        "DELETE FROM discord_subscriber_platforms WHERE channel_id = ?",
      )
      .bind(channelId),
    ...platforms.map((platform) =>
      db
        .prepare(
          `INSERT INTO discord_subscriber_platforms (
             channel_id, platform
           ) VALUES (?, ?)`,
        )
        .bind(channelId, platform),
    ),
    db
      .prepare(
        `UPDATE discord_subscribers
         SET updated_at = CURRENT_TIMESTAMP
         WHERE channel_id = ?`,
      )
      .bind(channelId),
  ]);
}

export async function claimDiscordNotification(
  db: D1Database,
  channelId: string,
  giveawayId: number,
): Promise<boolean> {
  const result = await db
    .prepare(
      `INSERT INTO discord_notifications (
         channel_id, giveaway_id, status
       ) VALUES (?, ?, 'pending')
       ON CONFLICT(channel_id, giveaway_id) DO UPDATE SET
         attempts = discord_notifications.attempts + 1,
         claimed_at = CURRENT_TIMESTAMP,
         last_error = NULL
       WHERE discord_notifications.status = 'pending'
         AND datetime(discord_notifications.claimed_at)
           < datetime('now', '-15 minutes')`,
    )
    .bind(channelId, giveawayId)
    .run();

  return Number(result.meta.changes ?? 0) > 0;
}

export async function markDiscordNotificationsSent(
  db: D1Database,
  channelId: string,
  giveawayIds: number[],
): Promise<void> {
  if (giveawayIds.length === 0) return;
  await db.batch(
    giveawayIds.map((giveawayId) =>
      db
        .prepare(
          `UPDATE discord_notifications
           SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL
           WHERE channel_id = ? AND giveaway_id = ?`,
        )
        .bind(channelId, giveawayId),
    ),
  );
}

export async function releaseDiscordNotifications(
  db: D1Database,
  channelId: string,
  giveawayIds: number[],
  error: string,
): Promise<void> {
  if (giveawayIds.length === 0) return;
  await db.batch(
    giveawayIds.map((giveawayId) =>
      db
        .prepare(
          `UPDATE discord_notifications
           SET claimed_at = datetime('now', '-16 minutes'), last_error = ?
           WHERE channel_id = ? AND giveaway_id = ? AND status = 'pending'`,
        )
        .bind(error.slice(0, 500), channelId, giveawayId),
    ),
  );
}

export async function recordDiscordManualDelivery(
  db: D1Database,
  channelId: string,
  giveaways: Giveaway[],
): Promise<void> {
  const ids = giveaways.flatMap((giveaway) =>
    giveaway.id === undefined ? [] : [giveaway.id]
  );
  if (ids.length === 0) return;

  await db.batch(
    ids.map((giveawayId) =>
      db
        .prepare(
          `INSERT INTO discord_notifications (
             channel_id, giveaway_id, status, sent_at
           ) VALUES (?, ?, 'sent', CURRENT_TIMESTAMP)
           ON CONFLICT(channel_id, giveaway_id) DO NOTHING`,
        )
        .bind(channelId, giveawayId),
    ),
  );
}
