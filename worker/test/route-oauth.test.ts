import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('slack oauth callback', () => {
  it('redirects to an error when code is missing', async () => {
    const res = await SELF.fetch('https://x/slack/oauth', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error');
  });
});
