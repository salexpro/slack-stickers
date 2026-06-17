import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { convertStatic } from '../src/convert';

describe('convertStatic', () => {
  it('converts webp bytes to a 150px-wide png', async () => {
    const webp = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
    }).webp().toBuffer();

    const png = await convertStatic(webp);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(150);
  });
});
