import type { StickerRecord } from '../types';

function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createLinkToken(
  db: D1Database,
  telegramUserId: number,
  nowSec: number,
  ttlSec: number
): Promise<string> {
  const token = randomToken();
  await db
    .prepare('INSERT INTO link_tokens (token, telegram_user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, telegramUserId, nowSec + ttlSec)
    .run();
  return token;
}

export async function consumeLinkToken(
  db: D1Database,
  token: string,
  nowSec: number
): Promise<number | null> {
  const row = await db
    .prepare('SELECT telegram_user_id, expires_at FROM link_tokens WHERE token = ?')
    .bind(token)
    .first<{ telegram_user_id: number; expires_at: number }>();
  if (!row) return null;
  await db.prepare('DELETE FROM link_tokens WHERE token = ?').bind(token).run();
  if (row.expires_at < nowSec) return null;
  return row.telegram_user_id;
}

export async function upsertLink(
  db: D1Database,
  teamId: string,
  slackUserId: string,
  telegramUserId: number,
  nowSec: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO links (team_id, slack_user_id, telegram_user_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id, slack_user_id)
       DO UPDATE SET telegram_user_id = excluded.telegram_user_id`
    )
    .bind(teamId, slackUserId, telegramUserId, nowSec)
    .run();
}

export async function getTelegramUserId(
  db: D1Database,
  teamId: string,
  slackUserId: string
): Promise<number | null> {
  const row = await db
    .prepare('SELECT telegram_user_id FROM links WHERE team_id = ? AND slack_user_id = ?')
    .bind(teamId, slackUserId)
    .first<{ telegram_user_id: number }>();
  return row?.telegram_user_id ?? null;
}

export async function getSticker(
  db: D1Database,
  fileUniqueId: string
): Promise<StickerRecord | null> {
  return await db
    .prepare('SELECT * FROM stickers WHERE file_unique_id = ?')
    .bind(fileUniqueId)
    .first<StickerRecord>();
}

export async function upsertSticker(db: D1Database, s: StickerRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stickers (file_unique_id, ext, animated, r2_key, public_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_unique_id) DO UPDATE SET
         ext = excluded.ext, animated = excluded.animated,
         r2_key = excluded.r2_key, public_url = excluded.public_url`
    )
    .bind(s.file_unique_id, s.ext, s.animated, s.r2_key, s.public_url, s.created_at)
    .run();
}

export async function addUserSticker(
  db: D1Database,
  telegramUserId: number,
  fileUniqueId: string,
  nowSec: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_stickers (telegram_user_id, file_unique_id, added_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_user_id, file_unique_id) DO UPDATE SET added_at = excluded.added_at`
    )
    .bind(telegramUserId, fileUniqueId, nowSec)
    .run();
}

export async function removeUserSticker(
  db: D1Database,
  telegramUserId: number,
  fileUniqueId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM user_stickers WHERE telegram_user_id = ? AND file_unique_id = ?')
    .bind(telegramUserId, fileUniqueId)
    .run();
}

export async function listUserStickers(
  db: D1Database,
  telegramUserId: number
): Promise<StickerRecord[]> {
  const res = await db
    .prepare(
      `SELECT s.* FROM user_stickers us
       JOIN stickers s ON s.file_unique_id = us.file_unique_id
       WHERE us.telegram_user_id = ?
       ORDER BY us.added_at DESC`
    )
    .bind(telegramUserId)
    .all<StickerRecord>();
  return res.results ?? [];
}
