import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { app } from '../src/server';

describe('POST /convert', () => {
  it('converts a static sticker and returns image/png', async () => {
    const webp = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).webp().toBuffer();

    const res = await app.request('/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-sticker-kind': 'static' },
      body: webp,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const out = Buffer.from(await res.arrayBuffer());
    expect((await sharp(out).metadata()).width).toBe(150);
  });

  it('rejects an unknown kind', async () => {
    const res = await app.request('/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-sticker-kind': 'bogus' },
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(400);
  });
});
