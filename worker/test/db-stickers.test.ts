import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { getSticker, upsertSticker, addUserSticker, removeUserSticker, listUserStickers } from '../src/lib/db';

const now = 2_000_000;
const rec = {
  file_unique_id: 'AAA',
  ext: 'png' as const,
  animated: 0,
  r2_key: 'stickers/AAA.png',
  public_url: 'https://img/stickers/AAA.png',
  created_at: now,
};

describe('stickers', () => {
  it('upserts and reads a sticker (dedup by file_unique_id)', async () => {
    expect(await getSticker(env.DB, 'AAA')).toBeNull();
    await upsertSticker(env.DB, rec);
    const got = await getSticker(env.DB, 'AAA');
    expect(got?.public_url).toBe(rec.public_url);
    await upsertSticker(env.DB, rec); // idempotent, no throw
  });

  it('manages a user tray newest-first with add/remove', async () => {
    await upsertSticker(env.DB, rec);
    await upsertSticker(env.DB, { ...rec, file_unique_id: 'BBB', r2_key: 'stickers/BBB.png' });
    await addUserSticker(env.DB, 5, 'AAA', now);
    await addUserSticker(env.DB, 5, 'BBB', now + 1);
    let tray = await listUserStickers(env.DB, 5);
    expect(tray.map((s) => s.file_unique_id)).toEqual(['BBB', 'AAA']); // newest first
    await removeUserSticker(env.DB, 5, 'BBB');
    tray = await listUserStickers(env.DB, 5);
    expect(tray.map((s) => s.file_unique_id)).toEqual(['AAA']);
  });
});
