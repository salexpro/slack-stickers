import type { Env } from '../types';
import { getSticker, upsertSticker, addUserSticker } from './db';
import { tgGetFilePath, tgFileDownloadUrl } from './telegram';
import { convert } from './converter';

interface TgSticker {
  file_id: string;
  file_unique_id: string;
  is_animated?: boolean;
}
interface TgMessage {
  from: { id: number };
  sticker: TgSticker;
}

export async function ingestSticker(env: Env, msg: TgMessage, nowSec: number): Promise<'saved'> {
  const telegramUserId = msg.from.id;
  const fileUniqueId = msg.sticker.file_unique_id;

  let rec = await getSticker(env.DB, fileUniqueId);
  if (!rec) {
    const filePath = await tgGetFilePath(env.TELEGRAM_BOT_TOKEN, msg.sticker.file_id);
    if (!filePath) throw new Error('could not resolve telegram file path');
    const raw = await fetch(tgFileDownloadUrl(env.TELEGRAM_BOT_TOKEN, filePath));
    const input = await raw.arrayBuffer();

    const kind = msg.sticker.is_animated ? 'animated' : 'static';
    const { bytes, ext } = await convert(env.CONVERTER_URL, kind, input);

    const r2Key = `stickers/${fileUniqueId}.${ext}`;
    await env.IMAGES.put(r2Key, bytes, {
      httpMetadata: { contentType: ext === 'gif' ? 'image/gif' : 'image/png' },
    });

    rec = {
      file_unique_id: fileUniqueId,
      ext,
      animated: msg.sticker.is_animated ? 1 : 0,
      r2_key: r2Key,
      public_url: `${env.R2_PUBLIC_BASE.replace(/\/$/, '')}/${r2Key}`,
      created_at: nowSec,
    };
    await upsertSticker(env.DB, rec);
  }

  await addUserSticker(env.DB, telegramUserId, fileUniqueId, nowSec);
  return 'saved';
}
