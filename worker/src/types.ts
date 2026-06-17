export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  CONVERTER_URL: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  R2_PUBLIC_BASE: string; // e.g. https://img.example.com or the r2.dev URL, no trailing slash
}

export interface StickerRecord {
  file_unique_id: string;
  ext: 'png' | 'gif';
  animated: number; // 0 | 1
  r2_key: string;
  public_url: string;
  created_at: number;
}
