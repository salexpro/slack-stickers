import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => vi.restoreAllMocks());

const SECRET_HEADER = 'x-telegram-bot-api-secret-token';

describe('telegram webhook', () => {
  it('rejects requests without the correct secret header', async () => {
    const res = await SELF.fetch('https://x/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SECRET_HEADER]: 'wrong' },
      body: JSON.stringify({ message: { text: '/help', chat: { id: 1 }, from: { id: 1 } } }),
    });
    expect(res.status).toBe(401);
  });

  it('responds to /start by sending a code via the bot API', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } })));
    vi.stubGlobal('fetch', fetchMock);

    const res = await SELF.fetch('https://x/telegram/webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json', [SECRET_HEADER]: env.TELEGRAM_WEBHOOK_SECRET },
      body: JSON.stringify({ message: { text: '/start', chat: { id: 9 }, from: { id: 9 } } }),
    });
    expect(res.status).toBe(200);
    const sent = fetchMock.mock.calls.find((c) => String(c[0]).includes('/sendMessage'));
    expect(sent).toBeTruthy();
    const body = JSON.parse((sent![1] as RequestInit).body as string);
    expect(body.text).toMatch(/\/ss /); // instructs the user to run /ss <code> in Slack
  });
});
