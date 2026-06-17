import sharp from 'sharp';
import pako from 'pako';
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';

// gifenc ships CJS whose default-interop differs between Node ESM and esbuild/vitest.
// createRequire returns the full module.exports identically in both runtimes.
const require = createRequire(import.meta.url);
const { GIFEncoder, quantize, applyPalette } = require('gifenc') as typeof import('gifenc').default;

const WIDTH = 150;

export async function convertStatic(input: Buffer | Uint8Array): Promise<Buffer> {
  return await sharp(input).resize({ width: WIDTH }).png().toBuffer();
}

export interface AnimatedResult {
  bytes: Buffer;
  ext: 'gif' | 'png';
}

export function parseTgs(input: Buffer | Uint8Array): any {
  const json = pako.ungzip(input, { to: 'string' });
  return JSON.parse(json);
}

const SIZE = 150;
const MAX_FRAMES = 30;

// Pure: encode RGBA frames into an animated GIF. Testable without a browser.
export function encodeGif(frames: Uint8ClampedArray[], size: number, delayMs: number): Buffer {
  const enc = GIFEncoder();
  for (const frame of frames) {
    const palette = quantize(frame, 256);
    const index = applyPalette(frame, palette);
    enc.writeFrame(index, size, size, { palette, delay: delayMs, transparent: true });
  }
  enc.finish();
  return Buffer.from(enc.bytes());
}

// Pure: render a single RGBA frame to a PNG. Testable without a browser.
export async function firstFramePng(frame: Uint8ClampedArray, size: number): Promise<Buffer> {
  return await sharp(Buffer.from(frame), { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

// Renders Lottie frames to RGBA in headless Chromium via lottie-web.
async function renderFrames(animation: any): Promise<{ frames: Uint8ClampedArray[]; delayMs: number }> {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="c"></div>');
    await page.addScriptTag({
      url: 'https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js',
    });
    const result = await page.evaluate(async (data, size, maxFrames) => {
      // @ts-ignore lottie is injected globally
      const anim = lottie.loadAnimation({
        container: document.getElementById('c'),
        renderer: 'canvas',
        loop: false, autoplay: false,
        animationData: data,
        rendererSettings: { clearCanvas: true },
      });
      const total = Math.min(Math.ceil(anim.totalFrames), maxFrames);
      const step = Math.max(1, Math.floor(anim.totalFrames / total));
      const canvas: HTMLCanvasElement = document.querySelector('#c canvas')!;
      canvas.width = size; canvas.height = size;
      const out: number[][] = [];
      for (let f = 0; f < anim.totalFrames; f += step) {
        anim.goToAndStop(f, true);
        const ctx = canvas.getContext('2d')!;
        const img = ctx.getImageData(0, 0, size, size);
        out.push(Array.from(img.data));
      }
      return { frames: out, fr: anim.frameRate, step };
    }, animation, SIZE, MAX_FRAMES);

    const frames = result.frames.map((f: number[]) => new Uint8ClampedArray(f));
    const delayMs = Math.round((1000 / (result.fr || 30)) * result.step);
    return { frames, delayMs };
  } finally {
    await browser.close();
  }
}

export async function convertAnimated(input: Buffer | Uint8Array): Promise<AnimatedResult> {
  const animation = parseTgs(input);
  try {
    const { frames, delayMs } = await renderFrames(animation);
    if (frames.length === 0) throw new Error('no frames rendered');
    return { bytes: encodeGif(frames, SIZE, delayMs), ext: 'gif' };
  } catch (err) {
    // Fallback: render just the first frame to a static PNG.
    const { frames } = await renderFrames(animation).catch(() => ({ frames: [] as Uint8ClampedArray[] }));
    if (frames.length > 0) {
      return { bytes: await firstFramePng(frames[0], SIZE), ext: 'png' };
    }
    throw err;
  }
}
