import { describe, it, expect, vi, afterEach } from 'vitest';
import { tgSendMessage, tgGetFilePath, tgFileDownloadUrl } from '../src/lib/telegram';

afterEach(() => vi.restoreAllMocks());

describe('telegram helpers', () => {
  it('sendMessage posts to the bot API with chat_id and text', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await tgSendMessage('TOKEN', 123, 'hello');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/botTOKEN/sendMessage');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toMatchObject({ chat_id: 123, text: 'hello' });
  });

  it('getFilePath returns file_path from the API result', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { file_path: 'stickers/x.webp' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const path = await tgGetFilePath('TOKEN', 'FILEID');
    expect(path).toBe('stickers/x.webp');
  });

  it('builds the file download URL', () => {
    expect(tgFileDownloadUrl('TOKEN', 'stickers/x.webp'))
      .toBe('https://api.telegram.org/file/botTOKEN/stickers/x.webp');
  });
});
