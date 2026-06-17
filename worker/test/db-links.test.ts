import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createLinkToken, consumeLinkToken, upsertLink, getTelegramUserId } from '../src/lib/db';

const now = 1_000_000;

describe('link tokens', () => {
  it('creates then consumes a valid token once', async () => {
    const token = await createLinkToken(env.DB, 42, now, 600);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);

    const tgId = await consumeLinkToken(env.DB, token, now + 10);
    expect(tgId).toBe(42);

    const second = await consumeLinkToken(env.DB, token, now + 20);
    expect(second).toBeNull(); // single-use
  });

  it('rejects an expired token', async () => {
    const token = await createLinkToken(env.DB, 7, now, 600);
    const tgId = await consumeLinkToken(env.DB, token, now + 601);
    expect(tgId).toBeNull();
  });
});

describe('links', () => {
  it('upserts and resolves a slack→telegram link', async () => {
    await upsertLink(env.DB, 'T1', 'U1', 99, now);
    expect(await getTelegramUserId(env.DB, 'T1', 'U1')).toBe(99);
    await upsertLink(env.DB, 'T1', 'U1', 100, now + 5); // re-link overwrites
    expect(await getTelegramUserId(env.DB, 'T1', 'U1')).toBe(100);
    expect(await getTelegramUserId(env.DB, 'T1', 'UNKNOWN')).toBeNull();
  });
});
