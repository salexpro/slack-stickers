import { describe, it, expect } from 'vitest';
import pako from 'pako';
import puppeteer from 'puppeteer';
import { parseTgs, encodeGif, firstFramePng, convertAnimated } from '../src/convert';
import sharp from 'sharp';

// Minimal valid Lottie: 2 frames, 100x100, one static rectangle.
const lottie = {
  v: '5.5.2', fr: 30, ip: 0, op: 2, w: 100, h: 100, nm: 'x', ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 1, nm: 'bg', sr: 1,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    ao: 0, sw: 100, sh: 100, sc: '#00ff00', ip: 0, op: 2, st: 0, bm: 0,
  }],
};

const SIZE = 150;

// Build N synthetic opaque RGBA frames of SIZE x SIZE.
function syntheticFrames(n: number): Uint8ClampedArray[] {
  return Array.from({ length: n }, (_, i) => {
    const buf = new Uint8ClampedArray(SIZE * SIZE * 4);
    for (let p = 0; p < buf.length; p += 4) {
      buf[p] = (i * 40) % 256; buf[p + 1] = 80; buf[p + 2] = 160; buf[p + 3] = 255;
    }
    return buf;
  });
}

describe('parseTgs', () => {
  it('gunzips tgs bytes into Lottie JSON', () => {
    const tgs = pako.gzip(JSON.stringify(lottie));
    const json = parseTgs(Buffer.from(tgs));
    expect(json.w).toBe(100);
    expect(json.op).toBe(2);
  });
});

describe('encodeGif (pure)', () => {
  it('encodes frames into a GIF with the GIF87/89a header', () => {
    const gif = encodeGif(syntheticFrames(2), SIZE, 33);
    expect(gif.length).toBeGreaterThan(0);
    expect(gif.subarray(0, 3).toString('ascii')).toBe('GIF');
  });
});

describe('firstFramePng (pure)', () => {
  it('renders one RGBA frame to a SIZE-wide PNG', async () => {
    const png = await firstFramePng(syntheticFrames(1)[0], SIZE);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(SIZE);
  });
});

// The full path needs headless Chromium. It is validated end-to-end on the
// converter container (Task 17). Locally it runs only if a browser can launch;
// otherwise it is skipped rather than failing on environments without Chrome.
describe('convertAnimated (browser-bound)', () => {
  it('renders a tgs to gif or first-frame png', async (ctx) => {
    let browserOk = false;
    try {
      const b = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], headless: true });
      await b.close();
      browserOk = true;
    } catch {
      ctx.skip();
    }
    if (!browserOk) return;

    const tgs = pako.gzip(JSON.stringify(lottie));
    const out = await convertAnimated(Buffer.from(tgs));
    expect(['png', 'gif']).toContain(out.ext);
    expect(out.bytes.length).toBeGreaterThan(0);
  });
});
