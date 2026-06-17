declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    IMAGES: R2Bucket;
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers/config').D1Migration[];
    CONVERTER_URL: string;
    R2_PUBLIC_BASE: string;
    TELEGRAM_BOT_TOKEN: string;
    TELEGRAM_WEBHOOK_SECRET: string;
    SLACK_SIGNING_SECRET: string;
    SLACK_BOT_TOKEN: string;
  }
}
