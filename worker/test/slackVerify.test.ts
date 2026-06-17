import { describe, it, expect } from 'vitest';
import { verifySlackSignature } from '../src/lib/slackVerify';

const secret = 'shhh';

// Helper to compute a valid signature the same way Slack does.
async function sign(ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}`;
}

describe('verifySlackSignature', () => {
  const body = 'token=x&user_id=U1';
  const nowSec = 1_700_000_000;

  it('accepts a valid, fresh signature', async () => {
    const ts = String(nowSec);
    const sig = await sign(ts, body);
    expect(await verifySlackSignature(secret, ts, sig, body, nowSec)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const ts = String(nowSec);
    const sig = await sign(ts, body);
    expect(await verifySlackSignature(secret, ts, sig, body + 'x', nowSec)).toBe(false);
  });

  it('rejects a stale timestamp (>5 min)', async () => {
    const ts = String(nowSec - 301);
    const sig = await sign(ts, body);
    expect(await verifySlackSignature(secret, ts, sig, body, nowSec)).toBe(false);
  });

  it('rejects a missing signature', async () => {
    expect(await verifySlackSignature(secret, String(nowSec), null, body, nowSec)).toBe(false);
  });
});
