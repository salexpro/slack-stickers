import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

// Isolated storage is disabled (see vitest.config.ts), so the D1 instance is shared
// across test files. Apply migrations only once — re-applying would fail with
// "table already exists".
beforeAll(async () => {
  const applied = await env.DB.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='stickers'"
  ).first();
  if (!applied) {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  }
});
