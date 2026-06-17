import { Hono } from 'hono';
import type { Env } from '../types';
import { tgSendMessage } from '../lib/telegram';
import { createLinkToken } from '../lib/db';
import { ingestSticker } from '../lib/ingest';

const HELP = 'This bot lets you send Telegram stickers in Slack.\nType /start and follow the instructions.';
const LINK_TTL = 15 * 60;

export const telegramWebhook = new Hono<{ Bindings: Env }>();

telegramWebhook.post('/telegram/webhook', async (c) => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('unauthorized', 401);
  }
  const update = await c.req.json<any>();
  const msg = update?.message;
  if (!msg) return c.json({ ok: true });

  const nowSec = Math.floor(Date.now() / 1000);

  if (msg.text === '/help') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN, msg.chat.id, HELP);
    return c.json({ ok: true });
  }

  if (msg.text === '/start') {
    const token = await createLinkToken(c.env.DB, msg.from.id, nowSec, LINK_TTL);
    await tgSendMessage(
      c.env.TELEGRAM_BOT_TOKEN, msg.chat.id,
      `In Slack, run:\n\`/ss ${token}\`\n\nThen send me stickers and pick them in Slack with \`/ss\`.`
    );
    return c.json({ ok: true });
  }

  if (msg.sticker?.file_id) {
    if (msg.sticker.is_animated) {
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN, msg.chat.id, 'Processing animated sticker…');
    }
    try {
      await ingestSticker(c.env, msg, nowSec);
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN, msg.chat.id, 'Saved! Use /ss in Slack to send it.');
    } catch (err) {
      console.error(err);
      await tgSendMessage(
        c.env.TELEGRAM_BOT_TOKEN, msg.chat.id,
        'Sorry, that sticker could not be processed.'
      );
    }
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});
