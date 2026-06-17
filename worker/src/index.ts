import { Hono } from 'hono';
import type { Env } from './types';
import { telegramWebhook } from './routes/telegramWebhook';
import { slackCommand } from './routes/slackCommand';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));
app.route('/', telegramWebhook);
app.route('/', slackCommand);

export default app;
