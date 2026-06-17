import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Build a signed Slack form POST.
async function signedForm(form: Record<string, string>, path = '/slack/command') {
  const body = new URLSearchParams(form).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const sig = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return SELF.fetch('https://x' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body,
  });
}

describe('slack /ss command', () => {
  it('rejects an unsigned request', async () => {
    const res = await SELF.fetch('https://x/slack/command', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'team_id=T1&user_id=U1&text=',
    });
    expect(res.status).toBe(401);
  });

  it('registers a link when given a token, then reports success', async () => {
    // seed a link token for telegram user 321
    await env.DB.prepare('INSERT INTO link_tokens (token, telegram_user_id, expires_at) VALUES (?,?,?)')
      .bind('abc123def456', 321, Math.floor(Date.now() / 1000) + 600).run();
    const res = await signedForm({ team_id: 'T1', user_id: 'U1', text: 'abc123def456' });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.response_type).toBe('ephemeral');
    expect(json.text).toMatch(/registered/i);
  });

  it('tells an unregistered user to link first', async () => {
    const res = await signedForm({ team_id: 'T1', user_id: 'UNREG', text: '' });
    const json = await res.json<any>();
    expect(json.text).toMatch(/\/start/);
  });
});
