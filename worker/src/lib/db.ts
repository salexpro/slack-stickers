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
