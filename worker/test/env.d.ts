/// <reference path="../node_modules/@cloudflare/vitest-pool-workers/types/cloudflare-test.d.ts" />

declare module 'cloudflare:test' {
  // Augments the ProvidedEnv declared by @cloudflare/vitest-pool-workers/types.
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
