import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('health', () => {
  it('responds on GET /health', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
