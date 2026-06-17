import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

async function signedInteract(payload: unknown) {
  const body = 'payload=' + encodeURIComponent(JSON.stringify(payload));
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const sig = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return SELF.fetch('https://x/slack/interact', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body,
  });
}

describe('slack interactivity', () => {
  it('posts the sticker publicly on Select', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO stickers (file_unique_id, ext, animated, r2_key, public_url, created_at)
       VALUES ('SEL1','png',0,'stickers/SEL1.png','https://img/stickers/SEL1.png',1)`
    ).run();
    const res = await signedInteract({
      user: { id: 'U9' },
      actions: [{ action_id: 'select', value: 'SEL1' }],
    });
    const json = await res.json<any>();
    expect(json.response_type).toBe('in_channel');
    expect(json.delete_original).toBe(true);
    expect(JSON.stringify(json.blocks)).toContain('https://img/stickers/SEL1.png');
  });

  it('deletes the picker on Cancel', async () => {
    const res = await signedInteract({ user: { id: 'U9' }, actions: [{ action_id: 'cancel', value: 'cancel' }] });
    const json = await res.json<any>();
    expect(json.delete_original).toBe(true);
  });
});
