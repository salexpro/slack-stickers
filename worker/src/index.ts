import { Hono } from 'hono';
import type { Env } from './types';
import { telegramWebhook } from './routes/telegramWebhook';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));
app.route('/', telegramWebhook);

export default app;
