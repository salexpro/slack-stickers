import { Hono } from 'hono';
import type { Env } from './types';
import { telegramWebhook } from './routes/telegramWebhook';
import { slackCommand } from './routes/slackCommand';
import { slackInteract } from './routes/slackInteract';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));
app.route('/', telegramWebhook);
app.route('/', slackCommand);
app.route('/', slackInteract);

export default app;
