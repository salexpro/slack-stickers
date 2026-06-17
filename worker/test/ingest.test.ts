import { env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ingestSticker } from '../src/lib/ingest';
import { getSticker, listUserStickers } from '../src/lib/db';

afterEach(() => vi.restoreAllMocks());

const baseMsg = {
  from: { id: 555 },
  sticker: { file_id: 'FID', file_unique_id: 'UNIQ1', is_animated: false },
};

describe('ingestSticker', () => {
  it('converts a new sticker once, stores it in R2, and links it to the user', async () => {
    // getFile → download → convert
    const fetchMock = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/getFile')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'p/x.webp' } }), { status: 200 });
      }
      if (u.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (u.includes('/convert')) {
        return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error('unexpected ' + u);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ingestSticker(env as any, baseMsg as any, 1000);
    expect(result).toBe('saved');

    const rec = await getSticker(env.DB, 'UNIQ1');
    expect(rec?.ext).toBe('png');
    expect(rec?.public_url).toContain('UNIQ1.png');

    const obj = await env.IMAGES.get(rec!.r2_key);
    expect(obj).not.toBeNull();

    const tray = await listUserStickers(env.DB, 555);
    expect(tray.map((s) => s.file_unique_id)).toContain('UNIQ1');
  });

  it('skips conversion when the sticker already exists (dedup) and still links it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO stickers (file_unique_id, ext, animated, r2_key, public_url, created_at)
       VALUES ('UNIQ2','png',0,'stickers/UNIQ2.png','https://img/stickers/UNIQ2.png',1)`
    ).run();

    const msg = { from: { id: 777 }, sticker: { file_id: 'F2', file_unique_id: 'UNIQ2', is_animated: false } };
    const result = await ingestSticker(env as any, msg as any, 1000);
    expect(result).toBe('saved');
    expect(fetchMock).not.toHaveBeenCalled(); // no conversion network calls

    const tray = await listUserStickers(env.DB, 777);
    expect(tray.map((s) => s.file_unique_id)).toContain('UNIQ2');
  });
});
