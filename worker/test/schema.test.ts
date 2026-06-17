import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('schema', () => {
  it('has the stickers table', async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='stickers'"
    ).first<{ name: string }>();
    expect(row?.name).toBe('stickers');
  });
});
