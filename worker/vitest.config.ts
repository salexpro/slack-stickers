import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      // Run test files sequentially; combined with isolatedStorage:false below this
      // avoids a pool-workers R2 isolated-storage cleanup bug (WAL .sqlite-shm sidecar).
      // Tests use unique keys so they don't interfere across files.
      fileParallelism: false,
      poolOptions: {
        workers: {
          isolatedStorage: false,
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: 'slack-stickers' },
            r2Buckets: ['IMAGES'],
            bindings: {
              TEST_MIGRATIONS: migrations,
              CONVERTER_URL: 'https://conv.example.com',
              R2_PUBLIC_BASE: 'https://img.example.com',
              TELEGRAM_BOT_TOKEN: 'T',
              TELEGRAM_WEBHOOK_SECRET: 'test-secret',
              SLACK_SIGNING_SECRET: 'shhh',
              SLACK_BOT_TOKEN: 'xoxb',
            },
          },
        },
      },
    },
  };
});
