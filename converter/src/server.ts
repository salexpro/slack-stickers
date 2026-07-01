import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { convertStatic, convertAnimated, convertVideo } from './convert.js';

export const app = new Hono();

app.get('/health', (c) => c.text('ok'));

app.post('/convert', async (c) => {
  const kind = c.req.header('x-sticker-kind');
  const input = Buffer.from(await c.req.arrayBuffer());

  try {
    if (kind === 'static') {
      const png = await convertStatic(input);
      return new Response(new Uint8Array(png), { headers: { 'content-type': 'image/png' } });
    }
    if (kind === 'animated') {
      const { bytes, ext } = await convertAnimated(input);
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': ext === 'gif' ? 'image/gif' : 'image/png' },
      });
    }
    if (kind === 'video') {
      const { bytes, ext } = await convertVideo(input);
      return new Response(new Uint8Array(bytes), {
        headers: { 'content-type': ext === 'gif' ? 'image/gif' : 'image/png' },
      });
    }
    return c.text('unknown x-sticker-kind', 400);
  } catch (err) {
    console.error(err);
    return c.text('conversion failed', 422);
  }
});

// Only start a listener when run directly (not under test).
if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('server.js')) {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port });
  console.log(`converter listening on ${port}`);
}
