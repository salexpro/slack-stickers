import { Hono } from 'hono';
import type { Env } from '../types';
import { verifySlackSignature } from '../lib/slackVerify';
import { consumeLinkToken, upsertLink, getTelegramUserId, listUserStickers } from '../lib/db';
import { paginate } from '../lib/pagination';
import { buildPickerBlocks } from '../lib/blocks';

export const slackCommand = new Hono<{ Bindings: Env }>();

slackCommand.post('/slack/command', async (c) => {
  const raw = await c.req.text();
  const ok = await verifySlackSignature(
    c.env.SLACK_SIGNING_SECRET,
    c.req.header('x-slack-request-timestamp') ?? null,
    c.req.header('x-slack-signature') ?? null,
    raw,
    Math.floor(Date.now() / 1000)
  );
  if (!ok) return c.text('unauthorized', 401);

  const form = new URLSearchParams(raw);
  const teamId = form.get('team_id') ?? '';
  const userId = form.get('user_id') ?? '';
  const text = (form.get('text') ?? '').trim();
  const nowSec = Math.floor(Date.now() / 1000);

  // Linking: any non-empty text is treated as a link token.
  if (text) {
    const tgId = await consumeLinkToken(c.env.DB, text, nowSec);
    if (!tgId) {
      return c.json({ response_type: 'ephemeral', text: 'That code is invalid or expired. Type /start in the Telegram bot for a new one.' });
    }
    await upsertLink(c.env.DB, teamId, userId, tgId, nowSec);
    return c.json({ response_type: 'ephemeral', text: 'You are registered — now send stickers with /ss.' });
  }

  const tgId = await getTelegramUserId(c.env.DB, teamId, userId);
  if (!tgId) {
    return c.json({
      response_type: 'ephemeral',
      text: 'You are not registered yet. Open the Telegram bot, type `/start`, and follow the instructions.',
    });
  }

  const stickers = await listUserStickers(c.env.DB, tgId);
  if (stickers.length === 0) {
    return c.json({
      response_type: 'ephemeral',
      text: 'You have no stickers yet. Send some to the Telegram bot, then try `/ss` again.',
    });
  }

  const page = paginate(stickers, 0);
  return c.json({
    response_type: 'ephemeral',
    blocks: buildPickerBlocks(page.pageItems, { page: page.page, hasPrev: page.hasPrev, hasNext: page.hasNext }),
  });
});
