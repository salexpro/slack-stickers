import { Hono } from 'hono';
import type { Env } from '../types';
import { verifySlackSignature } from '../lib/slackVerify';
import { ACTION, buildPickerBlocks, buildPostedBlocks } from '../lib/blocks';
import { getSticker, getTelegramUserId, removeUserSticker, listUserStickers } from '../lib/db';
import { paginate } from '../lib/pagination';

export const slackInteract = new Hono<{ Bindings: Env }>();

async function pickerResponse(env: Env, teamId: string, slackUserId: string, page: number) {
  const tgId = await getTelegramUserId(env.DB, teamId, slackUserId);
  const stickers = tgId ? await listUserStickers(env.DB, tgId) : [];
  const p = paginate(stickers, page);
  return {
    replace_original: true,
    response_type: 'ephemeral',
    blocks: buildPickerBlocks(p.pageItems, { page: p.page, hasPrev: p.hasPrev, hasNext: p.hasNext }),
  };
}

slackInteract.post('/slack/interact', async (c) => {
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
  const payload = JSON.parse(form.get('payload') ?? '{}');
  const action = payload.actions?.[0];
  const slackUserId: string = payload.user?.id ?? '';
  const teamId: string = payload.team?.id ?? payload.user?.team_id ?? '';

  switch (action?.action_id) {
    case ACTION.select: {
      const rec = await getSticker(c.env.DB, action.value);
      if (!rec) return c.json({ replace_original: true, text: 'That sticker is no longer available.' });
      return c.json({
        delete_original: true,
        response_type: 'in_channel',
        blocks: buildPostedBlocks(rec.public_url, slackUserId),
      });
    }
    case ACTION.remove: {
      const [fileUniqueId, pageStr] = String(action.value).split(':');
      const tgId = await getTelegramUserId(c.env.DB, teamId, slackUserId);
      if (tgId) await removeUserSticker(c.env.DB, tgId, fileUniqueId);
      return c.json(await pickerResponse(c.env, teamId, slackUserId, Number(pageStr) || 0));
    }
    case ACTION.prev:
    case ACTION.next:
      return c.json(await pickerResponse(c.env, teamId, slackUserId, Number(action.value) || 0));
    case ACTION.cancel:
    default:
      return c.json({ delete_original: true });
  }
});
