const API = 'https://api.telegram.org';

async function call(token: string, method: string, payload: unknown): Promise<any> {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function tgSendMessage(token: string, chatId: number, text: string): Promise<number | null> {
  const data = await call(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
  return data?.result?.message_id ?? null;
}

export async function tgEditMessage(
  token: string, chatId: number, messageId: number, text: string
): Promise<void> {
  await call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text });
}

export async function tgGetFilePath(token: string, fileId: string): Promise<string | null> {
  const data = await call(token, 'getFile', { file_id: fileId });
  return data?.result?.file_path ?? null;
}

export function tgFileDownloadUrl(token: string, filePath: string): string {
  return `${API}/file/bot${token}/${filePath}`;
}
