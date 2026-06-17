# Slack Stickers Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Telegram-sticker → Slack bridge on Cloudflare Workers + D1 + R2, with a small free converter container, deployable for $0/month.

**Architecture:** A single Cloudflare Worker (Hono) handles all HTTP: the Telegram webhook, the Slack `/ss` slash command, Slack Block Kit interactivity, and a dormant OAuth callback. It stores state in D1 (SQLite) and converted images in a public R2 bucket. A separate stateless Node container converts sticker bytes (`webp→png` via `sharp`, `tgs→gif` via headless Lottie rendering) — bytes in, image bytes out.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/D1/R2, `wrangler`, `vitest` + `@cloudflare/vitest-pool-workers` (Worker), Node + `sharp` + `puppeteer` + `gifenc` (converter), Docker.

**Spec:** `docs/superpowers/specs/2026-06-16-slack-stickers-rebuild-design.md`

---

## File Structure

**Worker (`worker/`):**
- `wrangler.toml` — Worker config, D1 + R2 bindings, routes
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `migrations/0001_init.sql` — D1 schema
- `src/types.ts` — `Env` bindings type + domain types
- `src/lib/slackVerify.ts` — Slack request signature verification
- `src/lib/blocks.ts` — Block Kit builders (picker page, posted sticker)
- `src/lib/pagination.ts` — page-slice + nav-button logic (pure)
- `src/lib/db.ts` — D1 query helpers
- `src/lib/telegram.ts` — Telegram REST calls (sendMessage, editMessageText, getFile, download)
- `src/lib/converter.ts` — call the converter service
- `src/routes/telegramWebhook.ts` — Telegram update handler
- `src/routes/slackCommand.ts` — `/ss` slash command
- `src/routes/slackInteract.ts` — Block Kit interactivity
- `src/routes/slackOauth.ts` — OAuth callback (dormant in v1)
- `src/index.ts` — Hono app wiring all routes
- `test/**` — vitest tests

**Converter (`converter/`):**
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/convert.ts` — `convertStatic` (webp→png) + `convertAnimated` (tgs→gif, first-frame fallback)
- `src/server.ts` — Hono Node server exposing `POST /convert`
- `Dockerfile`
- `test/convert.test.ts`

**Repo root:**
- Old `src/`, `deploy.json`, `temp/` are removed in the final task once parity is confirmed.

---

## Phase 0 — Worker scaffolding

### Task 0: Initialize the Worker project

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`, `worker/vitest.config.ts`, `worker/src/index.ts`, `worker/test/health.test.ts`

- [ ] **Step 1: Create the Worker package**

`worker/package.json`:
```json
{
  "name": "slack-stickers-worker",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "hono": "^4.6.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20240909.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0",
    "wrangler": "^4.0.0"
  }
}
```

`worker/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "lib": ["es2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 2: Create `wrangler.toml` with bindings**

`worker/wrangler.toml`:
```toml
name = "slack-stickers"
main = "src/index.ts"
compatibility_date = "2024-09-23"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "slack-stickers"
database_id = "PLACEHOLDER_SET_AFTER_d1_create"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "slack-stickers-img"
```

Note: `database_id` is filled in during Task 13 (`wrangler d1 create`). `CONVERTER_URL`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, and `R2_PUBLIC_BASE` are set as secrets/vars, not in this file.

- [ ] **Step 3: Create `vitest.config.ts`**

`worker/vitest.config.ts`:
```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: { compatibilityFlags: ['nodejs_compat'] },
      },
    },
  },
});
```

- [ ] **Step 4: Write a health-check test**

`worker/test/health.test.ts`:
```ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('health', () => {
  it('responds on GET /health', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd worker && npm install && npm test`
Expected: FAIL — no `src/index.ts` export / 404.

- [ ] **Step 6: Create the minimal Hono app**

`worker/src/index.ts`:
```ts
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => c.text('ok'));

export default app;
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd worker && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add worker/package.json worker/tsconfig.json worker/wrangler.toml worker/vitest.config.ts worker/src/index.ts worker/test/health.test.ts worker/package-lock.json
git commit -m "feat(worker): scaffold Cloudflare Worker with Hono + vitest"
```

---

## Phase 1 — Data layer

### Task 1: D1 schema migration

**Files:**
- Create: `worker/migrations/0001_init.sql`
- Create: `worker/src/types.ts`

- [ ] **Step 1: Write the migration**

`worker/migrations/0001_init.sql`:
```sql
CREATE TABLE workspaces (
  team_id      TEXT PRIMARY KEY,
  bot_token    TEXT NOT NULL,
  installed_at INTEGER NOT NULL
);

CREATE TABLE links (
  team_id          TEXT NOT NULL,
  slack_user_id    TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
);

CREATE TABLE link_tokens (
  token            TEXT PRIMARY KEY,
  telegram_user_id INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

CREATE TABLE stickers (
  file_unique_id TEXT PRIMARY KEY,
  ext            TEXT NOT NULL,
  animated       INTEGER NOT NULL,
  r2_key         TEXT NOT NULL,
  public_url     TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE TABLE user_stickers (
  telegram_user_id INTEGER NOT NULL,
  file_unique_id   TEXT NOT NULL,
  added_at         INTEGER NOT NULL,
  PRIMARY KEY (telegram_user_id, file_unique_id)
);

CREATE INDEX idx_user_stickers_user ON user_stickers (telegram_user_id, added_at DESC);
```

- [ ] **Step 2: Define the `Env` and domain types**

`worker/src/types.ts`:
```ts
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
```

- [ ] **Step 3: Configure vitest to apply migrations**

Update `worker/vitest.config.ts` to read and apply the migration into the test D1. Replace the file contents with:
```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersConfig(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, 'migrations'));
  return {
    test: {
      setupFiles: ['./test/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.toml' },
          miniflare: {
            compatibilityFlags: ['nodejs_compat'],
            d1Databases: { DB: 'slack-stickers' },
            r2Buckets: ['IMAGES'],
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
```

`worker/test/apply-migrations.ts`:
```ts
import { applyD1Migrations, env } from 'cloudflare:test';
import { beforeAll } from 'vitest';

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as any).TEST_MIGRATIONS);
});
```

`worker/test/env.d.ts`:
```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    DB: D1Database;
    IMAGES: R2Bucket;
    TEST_MIGRATIONS: import('@cloudflare/vitest-pool-workers/config').D1Migration[];
  }
}
```

- [ ] **Step 4: Verify migrations load (smoke test)**

`worker/test/schema.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('schema', () => {
  it('has the stickers table', async () => {
    const row = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='stickers'"
    ).first<{ name: string }>();
    expect(row?.name).toBe('stickers');
  });
});
```

Run: `cd worker && npm test -- schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations worker/src/types.ts worker/vitest.config.ts worker/test/apply-migrations.ts worker/test/env.d.ts worker/test/schema.test.ts
git commit -m "feat(worker): add D1 schema, env types, and test migrations"
```

### Task 2: DB helper — link tokens and links

**Files:**
- Create: `worker/src/lib/db.ts`
- Test: `worker/test/db-links.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/db-links.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createLinkToken, consumeLinkToken, upsertLink, getTelegramUserId } from '../src/lib/db';

const now = 1_000_000;

describe('link tokens', () => {
  it('creates then consumes a valid token once', async () => {
    const token = await createLinkToken(env.DB, 42, now, 600);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);

    const tgId = await consumeLinkToken(env.DB, token, now + 10);
    expect(tgId).toBe(42);

    const second = await consumeLinkToken(env.DB, token, now + 20);
    expect(second).toBeNull(); // single-use
  });

  it('rejects an expired token', async () => {
    const token = await createLinkToken(env.DB, 7, now, 600);
    const tgId = await consumeLinkToken(env.DB, token, now + 601);
    expect(tgId).toBeNull();
  });
});

describe('links', () => {
  it('upserts and resolves a slack→telegram link', async () => {
    await upsertLink(env.DB, 'T1', 'U1', 99, now);
    expect(await getTelegramUserId(env.DB, 'T1', 'U1')).toBe(99);
    await upsertLink(env.DB, 'T1', 'U1', 100, now + 5); // re-link overwrites
    expect(await getTelegramUserId(env.DB, 'T1', 'U1')).toBe(100);
    expect(await getTelegramUserId(env.DB, 'T1', 'UNKNOWN')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- db-links`
Expected: FAIL — `../src/lib/db` not found.

- [ ] **Step 3: Implement the helpers**

`worker/src/lib/db.ts`:
```ts
function randomToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createLinkToken(
  db: D1Database,
  telegramUserId: number,
  nowSec: number,
  ttlSec: number
): Promise<string> {
  const token = randomToken();
  await db
    .prepare('INSERT INTO link_tokens (token, telegram_user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, telegramUserId, nowSec + ttlSec)
    .run();
  return token;
}

export async function consumeLinkToken(
  db: D1Database,
  token: string,
  nowSec: number
): Promise<number | null> {
  const row = await db
    .prepare('SELECT telegram_user_id, expires_at FROM link_tokens WHERE token = ?')
    .bind(token)
    .first<{ telegram_user_id: number; expires_at: number }>();
  if (!row) return null;
  await db.prepare('DELETE FROM link_tokens WHERE token = ?').bind(token).run();
  if (row.expires_at < nowSec) return null;
  return row.telegram_user_id;
}

export async function upsertLink(
  db: D1Database,
  teamId: string,
  slackUserId: string,
  telegramUserId: number,
  nowSec: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO links (team_id, slack_user_id, telegram_user_id, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(team_id, slack_user_id)
       DO UPDATE SET telegram_user_id = excluded.telegram_user_id`
    )
    .bind(teamId, slackUserId, telegramUserId, nowSec)
    .run();
}

export async function getTelegramUserId(
  db: D1Database,
  teamId: string,
  slackUserId: string
): Promise<number | null> {
  const row = await db
    .prepare('SELECT telegram_user_id FROM links WHERE team_id = ? AND slack_user_id = ?')
    .bind(teamId, slackUserId)
    .first<{ telegram_user_id: number }>();
  return row?.telegram_user_id ?? null;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- db-links`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/db.ts worker/test/db-links.test.ts
git commit -m "feat(worker): db helpers for link tokens and slack-telegram links"
```

### Task 3: DB helper — stickers and user tray

**Files:**
- Modify: `worker/src/lib/db.ts`
- Test: `worker/test/db-stickers.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/db-stickers.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { getSticker, upsertSticker, addUserSticker, removeUserSticker, listUserStickers } from '../src/lib/db';

const now = 2_000_000;
const rec = {
  file_unique_id: 'AAA',
  ext: 'png' as const,
  animated: 0,
  r2_key: 'stickers/AAA.png',
  public_url: 'https://img/stickers/AAA.png',
  created_at: now,
};

describe('stickers', () => {
  it('upserts and reads a sticker (dedup by file_unique_id)', async () => {
    expect(await getSticker(env.DB, 'AAA')).toBeNull();
    await upsertSticker(env.DB, rec);
    const got = await getSticker(env.DB, 'AAA');
    expect(got?.public_url).toBe(rec.public_url);
    await upsertSticker(env.DB, rec); // idempotent, no throw
  });

  it('manages a user tray newest-first with add/remove', async () => {
    await upsertSticker(env.DB, rec);
    await upsertSticker(env.DB, { ...rec, file_unique_id: 'BBB', r2_key: 'stickers/BBB.png' });
    await addUserSticker(env.DB, 5, 'AAA', now);
    await addUserSticker(env.DB, 5, 'BBB', now + 1);
    let tray = await listUserStickers(env.DB, 5);
    expect(tray.map((s) => s.file_unique_id)).toEqual(['BBB', 'AAA']); // newest first
    await removeUserSticker(env.DB, 5, 'BBB');
    tray = await listUserStickers(env.DB, 5);
    expect(tray.map((s) => s.file_unique_id)).toEqual(['AAA']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- db-stickers`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Append the helpers to `db.ts`**

Add to `worker/src/lib/db.ts`:
```ts
import type { StickerRecord } from '../types';

export async function getSticker(
  db: D1Database,
  fileUniqueId: string
): Promise<StickerRecord | null> {
  return await db
    .prepare('SELECT * FROM stickers WHERE file_unique_id = ?')
    .bind(fileUniqueId)
    .first<StickerRecord>();
}

export async function upsertSticker(db: D1Database, s: StickerRecord): Promise<void> {
  await db
    .prepare(
      `INSERT INTO stickers (file_unique_id, ext, animated, r2_key, public_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(file_unique_id) DO UPDATE SET
         ext = excluded.ext, animated = excluded.animated,
         r2_key = excluded.r2_key, public_url = excluded.public_url`
    )
    .bind(s.file_unique_id, s.ext, s.animated, s.r2_key, s.public_url, s.created_at)
    .run();
}

export async function addUserSticker(
  db: D1Database,
  telegramUserId: number,
  fileUniqueId: string,
  nowSec: number
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_stickers (telegram_user_id, file_unique_id, added_at)
       VALUES (?, ?, ?)
       ON CONFLICT(telegram_user_id, file_unique_id) DO UPDATE SET added_at = excluded.added_at`
    )
    .bind(telegramUserId, fileUniqueId, nowSec)
    .run();
}

export async function removeUserSticker(
  db: D1Database,
  telegramUserId: number,
  fileUniqueId: string
): Promise<void> {
  await db
    .prepare('DELETE FROM user_stickers WHERE telegram_user_id = ? AND file_unique_id = ?')
    .bind(telegramUserId, fileUniqueId)
    .run();
}

export async function listUserStickers(
  db: D1Database,
  telegramUserId: number
): Promise<StickerRecord[]> {
  const res = await db
    .prepare(
      `SELECT s.* FROM user_stickers us
       JOIN stickers s ON s.file_unique_id = us.file_unique_id
       WHERE us.telegram_user_id = ?
       ORDER BY us.added_at DESC`
    )
    .bind(telegramUserId)
    .all<StickerRecord>();
  return res.results ?? [];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- db-stickers`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/db.ts worker/test/db-stickers.test.ts
git commit -m "feat(worker): db helpers for sticker cache and user tray"
```

---

## Phase 2 — Slack signature verification

### Task 4: Verify Slack request signatures

**Files:**
- Create: `worker/src/lib/slackVerify.ts`
- Test: `worker/test/slackVerify.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/slackVerify.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { verifySlackSignature } from '../src/lib/slackVerify';

const secret = 'shhh';

// Helper to compute a valid signature the same way Slack does.
async function sign(ts: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `v0=${hex}`;
}

describe('verifySlackSignature', () => {
  const body = 'token=x&user_id=U1';
  const nowSec = 1_700_000_000;

  it('accepts a valid, fresh signature', async () => {
    const ts = String(nowSec);
    const sig = await sign(ts, body);
    expect(await verifySlackSignature(secret, ts, sig, body, nowSec)).toBe(true);
  });

  it('rejects a tampered body', async () => {
    const ts = String(nowSec);
    const sig = await sign(ts, body);
    expect(await verifySlackSignature(secret, ts, sig, body + 'x', nowSec)).toBe(false);
  });

  it('rejects a stale timestamp (>5 min)', async () => {
    const ts = String(nowSec - 301);
    const sig = await sign(ts, body);
    expect(await verifySlackSignature(secret, ts, sig, body, nowSec)).toBe(false);
  });

  it('rejects a missing signature', async () => {
    expect(await verifySlackSignature(secret, String(nowSec), null, body, nowSec)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- slackVerify`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement verification**

`worker/src/lib/slackVerify.ts`:
```ts
const FIVE_MIN = 60 * 5;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifySlackSignature(
  signingSecret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
  nowSec: number
): Promise<boolean> {
  if (!timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > FIVE_MIN) return false;

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(signingSecret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`v0:${timestamp}:${rawBody}`)
  );
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(`v0=${hex}`, signature);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- slackVerify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/slackVerify.ts worker/test/slackVerify.test.ts
git commit -m "feat(worker): Slack request signature verification"
```

---

## Phase 3 — Pagination + Block Kit

### Task 5: Pagination logic (pure)

**Files:**
- Create: `worker/src/lib/pagination.ts`
- Test: `worker/test/pagination.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/pagination.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { paginate, PER_PAGE } from '../src/lib/pagination';

describe('paginate', () => {
  it('exposes a page size constant', () => {
    expect(PER_PAGE).toBe(5);
  });

  it('slices the requested page and reports nav availability', () => {
    const items = [1, 2, 3, 4, 5, 6, 7]; // 7 items, PER_PAGE 5
    const p0 = paginate(items, 0);
    expect(p0.pageItems).toEqual([1, 2, 3, 4, 5]);
    expect(p0.hasPrev).toBe(false);
    expect(p0.hasNext).toBe(true);

    const p1 = paginate(items, 1);
    expect(p1.pageItems).toEqual([6, 7]);
    expect(p1.hasPrev).toBe(true);
    expect(p1.hasNext).toBe(false);
  });

  it('clamps out-of-range pages to a valid page', () => {
    const items = [1, 2, 3];
    const p = paginate(items, 9);
    expect(p.page).toBe(0);
    expect(p.pageItems).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- pagination`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement pagination**

`worker/src/lib/pagination.ts`:
```ts
export const PER_PAGE = 5;

export interface Page<T> {
  page: number;
  pageItems: T[];
  hasPrev: boolean;
  hasNext: boolean;
}

export function paginate<T>(items: T[], requestedPage: number): Page<T> {
  const lastPage = Math.max(0, Math.ceil(items.length / PER_PAGE) - 1);
  const page = requestedPage >= 0 && requestedPage <= lastPage ? requestedPage : 0;
  const start = page * PER_PAGE;
  const pageItems = items.slice(start, start + PER_PAGE);
  return { page, pageItems, hasPrev: page > 0, hasNext: page < lastPage };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- pagination`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/pagination.ts worker/test/pagination.test.ts
git commit -m "feat(worker): pure pagination helper"
```

### Task 6: Block Kit builders

**Files:**
- Create: `worker/src/lib/blocks.ts`
- Test: `worker/test/blocks.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/blocks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildPickerBlocks, buildPostedBlocks } from '../src/lib/blocks';
import type { StickerRecord } from '../src/types';

const sticker = (id: string): StickerRecord => ({
  file_unique_id: id, ext: 'png', animated: 0,
  r2_key: `stickers/${id}.png`, public_url: `https://img/${id}.png`, created_at: 0,
});

describe('buildPickerBlocks', () => {
  it('renders an image + Select/Remove per sticker and nav row', () => {
    const blocks = buildPickerBlocks([sticker('A'), sticker('B')], { page: 0, hasPrev: false, hasNext: true });
    const json = JSON.stringify(blocks);
    expect(json).toContain('https://img/A.png');
    expect(json).toContain('select'); // select action_id
    expect(json).toContain('remove');
    expect(json).toContain('next');   // next button present
    expect(json).not.toContain('"action_id":"prev"'); // no prev on page 0
    expect(json).toContain('cancel');
  });

  it('encodes page into prev/next button values', () => {
    const blocks = buildPickerBlocks([sticker('A')], { page: 2, hasPrev: true, hasNext: true });
    const json = JSON.stringify(blocks);
    expect(json).toContain('"value":"1"'); // prev → page-1
    expect(json).toContain('"value":"3"'); // next → page+1
  });
});

describe('buildPostedBlocks', () => {
  it('renders a public image block crediting the poster', () => {
    const blocks = buildPostedBlocks('https://img/A.png', 'U123');
    const json = JSON.stringify(blocks);
    expect(json).toContain('https://img/A.png');
    expect(json).toContain('<@U123>');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- blocks`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the builders**

`worker/src/lib/blocks.ts`:
```ts
import type { StickerRecord } from '../types';

interface NavState {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
}

// Action IDs are stable contract strings consumed by slackInteract.ts.
export const ACTION = {
  select: 'select',
  remove: 'remove',
  prev: 'prev',
  next: 'next',
  cancel: 'cancel',
} as const;

export function buildPickerBlocks(stickers: StickerRecord[], nav: NavState): unknown[] {
  const blocks: unknown[] = [
    { type: 'section', text: { type: 'mrkdwn', text: '*Select a sticker*' } },
  ];

  for (const s of stickers) {
    blocks.push({ type: 'image', image_url: s.public_url, alt_text: 'sticker' });
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Select' },
          action_id: ACTION.select,
          value: s.file_unique_id,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Remove' },
          style: 'danger',
          action_id: ACTION.remove,
          // value packs sticker id + current page so re-render returns to the same page
          value: `${s.file_unique_id}:${nav.page}`,
        },
      ],
    });
  }

  const navElements: unknown[] = [];
  if (nav.hasPrev) {
    navElements.push({
      type: 'button', text: { type: 'plain_text', text: 'Prev' },
      action_id: ACTION.prev, value: String(nav.page - 1),
    });
  }
  if (nav.hasNext) {
    navElements.push({
      type: 'button', text: { type: 'plain_text', text: 'Next' },
      action_id: ACTION.next, value: String(nav.page + 1),
    });
  }
  navElements.push({
    type: 'button', text: { type: 'plain_text', text: 'Cancel' },
    style: 'danger', action_id: ACTION.cancel, value: 'cancel',
  });
  blocks.push({ type: 'actions', elements: navElements });

  return blocks;
}

export function buildPostedBlocks(imageUrl: string, slackUserId: string): unknown[] {
  return [
    { type: 'context', elements: [{ type: 'mrkdwn', text: `<@${slackUserId}> posted` }] },
    { type: 'image', image_url: imageUrl, alt_text: 'sticker' },
  ];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- blocks`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/blocks.ts worker/test/blocks.test.ts
git commit -m "feat(worker): Block Kit builders for picker and posted sticker"
```

---

## Phase 4 — External-call helpers

### Task 7: Telegram and converter client helpers

**Files:**
- Create: `worker/src/lib/telegram.ts`
- Create: `worker/src/lib/converter.ts`
- Test: `worker/test/telegram.test.ts`

These wrap `fetch`; tests use `vi.stubGlobal('fetch', ...)` to assert URL/shape rather than hit the network.

- [ ] **Step 1: Write failing tests**

`worker/test/telegram.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { tgSendMessage, tgGetFilePath, tgFileDownloadUrl } from '../src/lib/telegram';

afterEach(() => vi.restoreAllMocks());

describe('telegram helpers', () => {
  it('sendMessage posts to the bot API with chat_id and text', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- telegram`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the Telegram helper**

`worker/src/lib/telegram.ts`:
```ts
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
```

- [ ] **Step 4: Implement the converter helper**

`worker/src/lib/converter.ts`:
```ts
export interface ConvertResult {
  bytes: ArrayBuffer;
  ext: 'png' | 'gif';
}

// Sends raw sticker bytes to the converter service; returns converted image bytes.
// Throws on non-2xx so the caller can report failure to the user.
export async function convert(
  converterUrl: string,
  kind: 'static' | 'animated',
  input: ArrayBuffer
): Promise<ConvertResult> {
  const res = await fetch(`${converterUrl.replace(/\/$/, '')}/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-sticker-kind': kind },
    body: input,
  });
  if (!res.ok) throw new Error(`converter failed: ${res.status}`);
  const contentType = res.headers.get('content-type') ?? '';
  const ext = contentType.includes('gif') ? 'gif' : 'png';
  return { bytes: await res.arrayBuffer(), ext };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- telegram`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/lib/telegram.ts worker/src/lib/converter.ts worker/test/telegram.test.ts
git commit -m "feat(worker): Telegram and converter client helpers"
```

### Task 8: Sticker ingestion orchestrator

This is the core "save a sticker" logic, factored out of the route so it's testable: dedup, convert, store in R2, upsert, link to user.

**Files:**
- Create: `worker/src/lib/ingest.ts`
- Test: `worker/test/ingest.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/ingest.test.ts`:
```ts
import { env } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ingestSticker } from '../src/lib/ingest';
import { getSticker, listUserStickers } from '../src/lib/db';

afterEach(() => vi.restoreAllMocks());

const baseMsg = {
  from: { id: 555 },
  sticker: { file_id: 'FID', file_unique_id: 'UNIQ1', is_animated: false },
};

describe('ingestSticker', () => {
  it('converts a new sticker once, stores it in R2, and links it to the user', async () => {
    // getFile → download → convert
    const fetchMock = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/getFile')) {
        return new Response(JSON.stringify({ ok: true, result: { file_path: 'p/x.webp' } }), { status: 200 });
      }
      if (u.includes('/file/bot')) return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (u.includes('/convert')) {
        return new Response(new Uint8Array([9, 9]), { status: 200, headers: { 'content-type': 'image/png' } });
      }
      throw new Error('unexpected ' + u);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await ingestSticker(env as any, baseMsg as any, 1000);
    expect(result).toBe('saved');

    const rec = await getSticker(env.DB, 'UNIQ1');
    expect(rec?.ext).toBe('png');
    expect(rec?.public_url).toContain('UNIQ1.png');

    const obj = await env.IMAGES.get(rec!.r2_key);
    expect(obj).not.toBeNull();

    const tray = await listUserStickers(env.DB, 555);
    expect(tray.map((s) => s.file_unique_id)).toContain('UNIQ1');
  });

  it('skips conversion when the sticker already exists (dedup) and still links it', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // UNIQ1 already in DB from previous test run? Tests share no state — pre-seed:
    await env.DB.prepare(
      `INSERT OR IGNORE INTO stickers (file_unique_id, ext, animated, r2_key, public_url, created_at)
       VALUES ('UNIQ2','png',0,'stickers/UNIQ2.png','https://img/stickers/UNIQ2.png',1)`
    ).run();

    const msg = { from: { id: 777 }, sticker: { file_id: 'F2', file_unique_id: 'UNIQ2', is_animated: false } };
    const result = await ingestSticker(env as any, msg as any, 1000);
    expect(result).toBe('saved');
    expect(fetchMock).not.toHaveBeenCalled(); // no conversion network calls

    const tray = await listUserStickers(env.DB, 777);
    expect(tray.map((s) => s.file_unique_id)).toContain('UNIQ2');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- ingest`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the orchestrator**

`worker/src/lib/ingest.ts`:
```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd worker && npm test -- ingest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/lib/ingest.ts worker/test/ingest.test.ts
git commit -m "feat(worker): sticker ingestion orchestrator (dedup, convert, store, link)"
```

---

## Phase 5 — Routes

### Task 9: Telegram webhook route

**Files:**
- Create: `worker/src/routes/telegramWebhook.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/route-telegram.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/route-telegram.test.ts`:
```ts
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
```

Note: the test relies on `env.TELEGRAM_WEBHOOK_SECRET`. Add test vars in `worker/vitest.config.ts` under `miniflare.bindings` (e.g. `TELEGRAM_WEBHOOK_SECRET: 'test-secret'`, `TELEGRAM_BOT_TOKEN: 'T'`, `CONVERTER_URL: 'https://conv'`, `R2_PUBLIC_BASE: 'https://img'`, `SLACK_SIGNING_SECRET: 'shhh'`, `SLACK_BOT_TOKEN: 'xoxb'`). Update `worker/test/env.d.ts` to include these string members.

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- route-telegram`
Expected: FAIL — route 404 / secret not configured.

- [ ] **Step 3: Implement the route**

`worker/src/routes/telegramWebhook.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { tgSendMessage } from '../lib/telegram';
import { createLinkToken } from '../lib/db';
import { ingestSticker } from '../lib/ingest';

const HELP = 'This bot lets you send Telegram stickers in Slack.\nType /start and follow the instructions.';
const LINK_TTL = 15 * 60;

export const telegramWebhook = new Hono<{ Bindings: Env }>();

telegramWebhook.post('/telegram/webhook', async (c) => {
  if (c.req.header('x-telegram-bot-api-secret-token') !== c.env.TELEGRAM_WEBHOOK_SECRET) {
    return c.text('unauthorized', 401);
  }
  const update = await c.req.json<any>();
  const msg = update?.message;
  if (!msg) return c.json({ ok: true });

  const nowSec = Math.floor(Date.now() / 1000);

  if (msg.text === '/help') {
    await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN, msg.chat.id, HELP);
    return c.json({ ok: true });
  }

  if (msg.text === '/start') {
    const token = await createLinkToken(c.env.DB, msg.from.id, nowSec, LINK_TTL);
    await tgSendMessage(
      c.env.TELEGRAM_BOT_TOKEN, msg.chat.id,
      `In Slack, run:\n\`/ss ${token}\`\n\nThen send me stickers and pick them in Slack with \`/ss\`.`
    );
    return c.json({ ok: true });
  }

  if (msg.sticker?.file_id) {
    let progressId: number | null = null;
    if (msg.sticker.is_animated) {
      progressId = await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN, msg.chat.id, 'Processing animated sticker…');
    }
    try {
      await ingestSticker(c.env, msg, nowSec);
      await tgSendMessage(c.env.TELEGRAM_BOT_TOKEN, msg.chat.id, 'Saved! Use /ss in Slack to send it.');
    } catch (err) {
      console.error(err);
      await tgSendMessage(
        c.env.TELEGRAM_BOT_TOKEN, msg.chat.id,
        'Sorry, that sticker could not be processed.'
      );
    }
    return c.json({ ok: true });
  }

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Wire it into `index.ts`**

`worker/src/index.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from './types';
import { telegramWebhook } from './routes/telegramWebhook';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', (c) => c.text('ok'));
app.route('/', telegramWebhook);

export default app;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- route-telegram`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/telegramWebhook.ts worker/src/index.ts worker/vitest.config.ts worker/test/env.d.ts worker/test/route-telegram.test.ts
git commit -m "feat(worker): Telegram webhook route (help, start, sticker ingest)"
```

### Task 10: Slack slash command route

**Files:**
- Create: `worker/src/routes/slackCommand.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/route-slack-command.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/route-slack-command.test.ts`:
```ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Build a signed Slack form POST.
async function signedForm(form: Record<string, string>, path = '/slack/command') {
  const body = new URLSearchParams(form).toString();
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const sig = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return SELF.fetch('https://x' + path, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body,
  });
}

describe('slack /ss command', () => {
  it('rejects an unsigned request', async () => {
    const res = await SELF.fetch('https://x/slack/command', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'team_id=T1&user_id=U1&text=',
    });
    expect(res.status).toBe(401);
  });

  it('registers a link when given a token, then reports success', async () => {
    // seed a link token for telegram user 321
    await env.DB.prepare('INSERT INTO link_tokens (token, telegram_user_id, expires_at) VALUES (?,?,?)')
      .bind('abc123def456', 321, Math.floor(Date.now() / 1000) + 600).run();
    const res = await signedForm({ team_id: 'T1', user_id: 'U1', text: 'abc123def456' });
    expect(res.status).toBe(200);
    const json = await res.json<any>();
    expect(json.response_type).toBe('ephemeral');
    expect(json.text).toMatch(/registered/i);
  });

  it('tells an unregistered user to link first', async () => {
    const res = await signedForm({ team_id: 'T1', user_id: 'UNREG', text: '' });
    const json = await res.json<any>();
    expect(json.text).toMatch(/\/start/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- route-slack-command`
Expected: FAIL — route 404.

- [ ] **Step 3: Implement the route**

`worker/src/routes/slackCommand.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifySlackSignature } from '../lib/slackVerify';
import { consumeLinkToken, upsertLink, getTelegramUserId, listUserStickers } from '../lib/db';
import { paginate } from '../lib/pagination';
import { buildPickerBlocks } from '../lib/blocks';

export const slackCommand = new Hono<{ Bindings: Env }>();

slackCommand.post('/slack/command', async (c) => {
  const raw = await c.req.text();
  const ok = await verifySlackSignature(
    c.env.SLACK_SIGNING_SECRET,
    c.req.header('x-slack-request-timestamp') ?? null,
    c.req.header('x-slack-signature') ?? null,
    raw,
    Math.floor(Date.now() / 1000)
  );
  if (!ok) return c.text('unauthorized', 401);

  const form = new URLSearchParams(raw);
  const teamId = form.get('team_id') ?? '';
  const userId = form.get('user_id') ?? '';
  const text = (form.get('text') ?? '').trim();
  const nowSec = Math.floor(Date.now() / 1000);

  // Linking: any non-empty text is treated as a link token.
  if (text) {
    const tgId = await consumeLinkToken(c.env.DB, text, nowSec);
    if (!tgId) {
      return c.json({ response_type: 'ephemeral', text: 'That code is invalid or expired. Type /start in the Telegram bot for a new one.' });
    }
    await upsertLink(c.env.DB, teamId, userId, tgId, nowSec);
    return c.json({ response_type: 'ephemeral', text: 'You are registered — now send stickers with /ss.' });
  }

  const tgId = await getTelegramUserId(c.env.DB, teamId, userId);
  if (!tgId) {
    return c.json({
      response_type: 'ephemeral',
      text: 'You are not registered yet. Open the Telegram bot, type `/start`, and follow the instructions.',
    });
  }

  const stickers = await listUserStickers(c.env.DB, tgId);
  if (stickers.length === 0) {
    return c.json({
      response_type: 'ephemeral',
      text: 'You have no stickers yet. Send some to the Telegram bot, then try `/ss` again.',
    });
  }

  const page = paginate(stickers, 0);
  return c.json({
    response_type: 'ephemeral',
    blocks: buildPickerBlocks(page.pageItems, { page: page.page, hasPrev: page.hasPrev, hasNext: page.hasNext }),
  });
});
```

- [ ] **Step 4: Wire into `index.ts`**

Add to `worker/src/index.ts` (after the telegram route):
```ts
import { slackCommand } from './routes/slackCommand';
// ...
app.route('/', slackCommand);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- route-slack-command`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/slackCommand.ts worker/src/index.ts worker/test/route-slack-command.test.ts
git commit -m "feat(worker): Slack slash command route (linking + picker)"
```

### Task 11: Slack interactivity route

**Files:**
- Create: `worker/src/routes/slackInteract.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/route-slack-interact.test.ts`

- [ ] **Step 1: Write failing tests**

`worker/test/route-slack-interact.test.ts`:
```ts
import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

async function signedInteract(payload: unknown) {
  const body = 'payload=' + encodeURIComponent(JSON.stringify(payload));
  const ts = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`v0:${ts}:${body}`));
  const sig = 'v0=' + [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return SELF.fetch('https://x/slack/interact', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': ts,
      'x-slack-signature': sig,
    },
    body,
  });
}

describe('slack interactivity', () => {
  it('posts the sticker publicly on Select', async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO stickers (file_unique_id, ext, animated, r2_key, public_url, created_at)
       VALUES ('SEL1','png',0,'stickers/SEL1.png','https://img/stickers/SEL1.png',1)`
    ).run();
    const res = await signedInteract({
      user: { id: 'U9' },
      actions: [{ action_id: 'select', value: 'SEL1' }],
    });
    const json = await res.json<any>();
    expect(json.response_type).toBe('in_channel');
    expect(json.delete_original).toBe(true);
    expect(JSON.stringify(json.blocks)).toContain('https://img/stickers/SEL1.png');
  });

  it('deletes the picker on Cancel', async () => {
    const res = await signedInteract({ user: { id: 'U9' }, actions: [{ action_id: 'cancel', value: 'cancel' }] });
    const json = await res.json<any>();
    expect(json.delete_original).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- route-slack-interact`
Expected: FAIL — route 404.

- [ ] **Step 3: Implement the route**

`worker/src/routes/slackInteract.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../types';
import { verifySlackSignature } from '../lib/slackVerify';
import { ACTION, buildPickerBlocks, buildPostedBlocks } from '../lib/blocks';
import { getSticker, getTelegramUserId, removeUserSticker, listUserStickers } from '../lib/db';
import { paginate } from '../lib/pagination';

export const slackInteract = new Hono<{ Bindings: Env }>();

async function pickerResponse(env: Env, teamId: string, slackUserId: string, page: number) {
  const tgId = await getTelegramUserId(env.DB, teamId, slackUserId);
  const stickers = tgId ? await listUserStickers(env.DB, tgId) : [];
  const p = paginate(stickers, page);
  return {
    replace_original: true,
    response_type: 'ephemeral',
    blocks: buildPickerBlocks(p.pageItems, { page: p.page, hasPrev: p.hasPrev, hasNext: p.hasNext }),
  };
}

slackInteract.post('/slack/interact', async (c) => {
  const raw = await c.req.text();
  const ok = await verifySlackSignature(
    c.env.SLACK_SIGNING_SECRET,
    c.req.header('x-slack-request-timestamp') ?? null,
    c.req.header('x-slack-signature') ?? null,
    raw,
    Math.floor(Date.now() / 1000)
  );
  if (!ok) return c.text('unauthorized', 401);

  const form = new URLSearchParams(raw);
  const payload = JSON.parse(form.get('payload') ?? '{}');
  const action = payload.actions?.[0];
  const slackUserId: string = payload.user?.id ?? '';
  const teamId: string = payload.team?.id ?? payload.user?.team_id ?? '';

  switch (action?.action_id) {
    case ACTION.select: {
      const rec = await getSticker(c.env.DB, action.value);
      if (!rec) return c.json({ replace_original: true, text: 'That sticker is no longer available.' });
      return c.json({
        delete_original: true,
        response_type: 'in_channel',
        blocks: buildPostedBlocks(rec.public_url, slackUserId),
      });
    }
    case ACTION.remove: {
      const [fileUniqueId, pageStr] = String(action.value).split(':');
      const tgId = await getTelegramUserId(c.env.DB, teamId, slackUserId);
      if (tgId) await removeUserSticker(c.env.DB, tgId, fileUniqueId);
      return c.json(await pickerResponse(c.env, teamId, slackUserId, Number(pageStr) || 0));
    }
    case ACTION.prev:
    case ACTION.next:
      return c.json(await pickerResponse(c.env, teamId, slackUserId, Number(action.value) || 0));
    case ACTION.cancel:
    default:
      return c.json({ delete_original: true });
  }
});
```

- [ ] **Step 4: Wire into `index.ts`**

Add to `worker/src/index.ts`:
```ts
import { slackInteract } from './routes/slackInteract';
// ...
app.route('/', slackInteract);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- route-slack-interact`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/src/routes/slackInteract.ts worker/src/index.ts worker/test/route-slack-interact.test.ts
git commit -m "feat(worker): Slack interactivity route (select/remove/paginate/cancel)"
```

### Task 12: Dormant OAuth callback route

**Files:**
- Create: `worker/src/routes/slackOauth.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/route-oauth.test.ts`

This is the multi-workspace seam. v1 only needs the route to exist and handle the `code` exchange shape; it is not wired to a public install button yet.

- [ ] **Step 1: Write failing test**

`worker/test/route-oauth.test.ts`:
```ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('slack oauth callback', () => {
  it('redirects to an error when code is missing', async () => {
    const res = await SELF.fetch('https://x/slack/oauth', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('error');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd worker && npm test -- route-oauth`
Expected: FAIL — route 404.

- [ ] **Step 3: Implement the route**

`worker/src/routes/slackOauth.ts`:
```ts
import { Hono } from 'hono';
import type { Env } from '../types';

export const slackOauth = new Hono<{ Bindings: Env }>();

// Dormant in v1: present so multi-workspace install is a clean later extension.
// When enabled, exchange `code` via oauth.v2.access and insert a workspaces row.
slackOauth.get('/slack/oauth', async (c) => {
  const code = c.req.query('code');
  if (!code) return c.redirect('/?error=access_denied', 302);

  // Placeholder exchange (kept minimal until distribution is enabled):
  // const res = await fetch('https://slack.com/api/oauth.v2.access', { ... });
  // await c.env.DB.prepare('INSERT OR REPLACE INTO workspaces ...').run();
  return c.redirect('/?installed=1', 302);
});
```

- [ ] **Step 4: Wire into `index.ts`**

Add to `worker/src/index.ts`:
```ts
import { slackOauth } from './routes/slackOauth';
// ...
app.route('/', slackOauth);
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd worker && npm test -- route-oauth`
Expected: PASS.

- [ ] **Step 6: Run the full suite + typecheck**

Run: `cd worker && npm test && npm run typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add worker/src/routes/slackOauth.ts worker/src/index.ts worker/test/route-oauth.test.ts
git commit -m "feat(worker): dormant OAuth callback route (multi-workspace seam)"
```

---

## Phase 6 — Converter service

### Task 13: Converter — static webp→png

**Files:**
- Create: `converter/package.json`, `converter/tsconfig.json`, `converter/vitest.config.ts`, `converter/src/convert.ts`
- Test: `converter/test/convert.test.ts`

- [ ] **Step 1: Create the package**

`converter/package.json`:
```json
{
  "name": "slack-stickers-converter",
  "private": true,
  "type": "module",
  "scripts": {
    "start": "node dist/server.js",
    "build": "tsc",
    "dev": "tsx src/server.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@hono/node-server": "^1.13.0",
    "hono": "^4.6.0",
    "sharp": "^0.33.5",
    "puppeteer": "^23.0.0",
    "gifenc": "^1.0.3",
    "pako": "^2.1.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

`converter/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "es2022",
    "moduleResolution": "bundler",
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "lib": ["es2022", "dom"]
  },
  "include": ["src"]
}
```

`converter/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 30000 } });
```

- [ ] **Step 2: Write a failing test for static conversion**

`converter/test/convert.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { convertStatic } from '../src/convert';

describe('convertStatic', () => {
  it('converts webp bytes to a 150px-wide png', async () => {
    const webp = await sharp({
      create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 128, b: 255, alpha: 1 } },
    }).webp().toBuffer();

    const png = await convertStatic(webp);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(150);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd converter && npm install && npm test`
Expected: FAIL — `../src/convert` not found.

- [ ] **Step 4: Implement `convertStatic`**

`converter/src/convert.ts`:
```ts
import sharp from 'sharp';

const WIDTH = 150;

export async function convertStatic(input: Buffer | Uint8Array): Promise<Buffer> {
  return await sharp(input).resize({ width: WIDTH }).png().toBuffer();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd converter && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add converter/package.json converter/tsconfig.json converter/vitest.config.ts converter/src/convert.ts converter/test/convert.test.ts converter/package-lock.json
git commit -m "feat(converter): static webp→png conversion"
```

### Task 14: Converter — animated tgs→gif with first-frame fallback

**Files:**
- Modify: `converter/src/convert.ts`
- Test: `converter/test/convert-animated.test.ts`

The risky piece per the spec. `tgs` is gzipped Lottie JSON. We render frames in headless Chromium with `lottie-web` (loaded from a CDN inside the page), capture canvas frames, and encode a GIF with `gifenc`. On any rendering error, fall back to a single transparent-trimmed first frame as PNG so the user still gets something.

- [ ] **Step 1: Write a failing test (parsing + fallback contract)**

`converter/test/convert-animated.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import pako from 'pako';
import { parseTgs, convertAnimated } from '../src/convert';

// Minimal valid Lottie: 2 frames, 100x100, one static rectangle.
const lottie = {
  v: '5.5.2', fr: 30, ip: 0, op: 2, w: 100, h: 100, nm: 'x', ddd: 0, assets: [],
  layers: [{
    ddd: 0, ind: 1, ty: 1, nm: 'bg', sr: 1,
    ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [50, 50, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
    ao: 0, sw: 100, sh: 100, sc: '#00ff00', ip: 0, op: 2, st: 0, bm: 0,
  }],
};

describe('parseTgs', () => {
  it('gunzips tgs bytes into Lottie JSON', () => {
    const tgs = pako.gzip(JSON.stringify(lottie));
    const json = parseTgs(Buffer.from(tgs));
    expect(json.w).toBe(100);
    expect(json.op).toBe(2);
  });
});

describe('convertAnimated', () => {
  it('returns a result tagged png or gif', async () => {
    const tgs = pako.gzip(JSON.stringify(lottie));
    const out = await convertAnimated(Buffer.from(tgs));
    expect(['png', 'gif']).toContain(out.ext);
    expect(out.bytes.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd converter && npm test -- convert-animated`
Expected: FAIL — `parseTgs`/`convertAnimated` not exported.

- [ ] **Step 3: Implement parsing + animated conversion**

Append to `converter/src/convert.ts`:
```ts
import pako from 'pako';
import puppeteer from 'puppeteer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';

export interface AnimatedResult {
  bytes: Buffer;
  ext: 'gif' | 'png';
}

export function parseTgs(input: Buffer | Uint8Array): any {
  const json = pako.ungzip(input, { to: 'string' });
  return JSON.parse(json);
}

const SIZE = 150;
const MAX_FRAMES = 30;

// Renders Lottie frames to RGBA in headless Chromium via lottie-web.
async function renderFrames(animation: any): Promise<{ frames: Uint8ClampedArray[]; delayMs: number }> {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="c"></div>');
    await page.addScriptTag({
      url: 'https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js',
    });
    const result = await page.evaluate(async (data, size, maxFrames) => {
      // @ts-ignore lottie is injected globally
      const anim = lottie.loadAnimation({
        container: document.getElementById('c'),
        renderer: 'canvas',
        loop: false, autoplay: false,
        animationData: data,
        rendererSettings: { clearCanvas: true },
      });
      const total = Math.min(Math.ceil(anim.totalFrames), maxFrames);
      const step = Math.max(1, Math.floor(anim.totalFrames / total));
      const canvas: HTMLCanvasElement = document.querySelector('#c canvas')!;
      canvas.width = size; canvas.height = size;
      const out: number[][] = [];
      for (let f = 0; f < anim.totalFrames; f += step) {
        anim.goToAndStop(f, true);
        const ctx = canvas.getContext('2d')!;
        const img = ctx.getImageData(0, 0, size, size);
        out.push(Array.from(img.data));
      }
      return { frames: out, fr: anim.frameRate, step };
    }, animation, SIZE, MAX_FRAMES);

    const frames = result.frames.map((f: number[]) => new Uint8ClampedArray(f));
    const delayMs = Math.round((1000 / (result.fr || 30)) * result.step);
    return { frames, delayMs };
  } finally {
    await browser.close();
  }
}

export async function convertAnimated(input: Buffer | Uint8Array): Promise<AnimatedResult> {
  const animation = parseTgs(input);
  try {
    const { frames, delayMs } = await renderFrames(animation);
    if (frames.length === 0) throw new Error('no frames rendered');

    const enc = GIFEncoder();
    for (const frame of frames) {
      const palette = quantize(frame, 256);
      const index = applyPalette(frame, palette);
      enc.writeFrame(index, SIZE, SIZE, { palette, delay: delayMs, transparent: true });
    }
    enc.finish();
    return { bytes: Buffer.from(enc.bytes()), ext: 'gif' };
  } catch (err) {
    // Fallback: render just the first frame to a static PNG.
    const { frames } = await renderFrames(animation).catch(() => ({ frames: [] as Uint8ClampedArray[] }));
    if (frames.length > 0) {
      const png = await sharp(Buffer.from(frames[0]), { raw: { width: SIZE, height: SIZE, channels: 4 } })
        .png().toBuffer();
      return { bytes: png, ext: 'png' };
    }
    throw err;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd converter && npm test -- convert-animated`
Expected: PASS. (If Chromium is unavailable locally, run `npx puppeteer browsers install chrome` first.)

- [ ] **Step 5: Commit**

```bash
git add converter/src/convert.ts converter/test/convert-animated.test.ts
git commit -m "feat(converter): tgs→gif animated conversion with first-frame fallback"
```

### Task 15: Converter HTTP server + Dockerfile

**Files:**
- Create: `converter/src/server.ts`
- Create: `converter/Dockerfile`
- Test: `converter/test/server.test.ts`

- [ ] **Step 1: Write a failing test**

`converter/test/server.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { app } from '../src/server';

describe('POST /convert', () => {
  it('converts a static sticker and returns image/png', async () => {
    const webp = await sharp({
      create: { width: 256, height: 256, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } },
    }).webp().toBuffer();

    const res = await app.request('/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-sticker-kind': 'static' },
      body: webp,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('image/png');
    const out = Buffer.from(await res.arrayBuffer());
    expect((await sharp(out).metadata()).width).toBe(150);
  });

  it('rejects an unknown kind', async () => {
    const res = await app.request('/convert', {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-sticker-kind': 'bogus' },
      body: new Uint8Array([1, 2]),
    });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd converter && npm test -- server`
Expected: FAIL — `../src/server` not found.

- [ ] **Step 3: Implement the server**

`converter/src/server.ts`:
```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { convertStatic, convertAnimated } from './convert';

export const app = new Hono();

app.get('/health', (c) => c.text('ok'));

app.post('/convert', async (c) => {
  const kind = c.req.header('x-sticker-kind');
  const input = Buffer.from(await c.req.arrayBuffer());

  try {
    if (kind === 'static') {
      const png = await convertStatic(input);
      return new Response(png, { headers: { 'content-type': 'image/png' } });
    }
    if (kind === 'animated') {
      const { bytes, ext } = await convertAnimated(input);
      return new Response(bytes, { headers: { 'content-type': ext === 'gif' ? 'image/gif' : 'image/png' } });
    }
    return c.text('unknown x-sticker-kind', 400);
  } catch (err) {
    console.error(err);
    return c.text('conversion failed', 422);
  }
});

// Only start a listener when run directly (not under test).
if (process.env.NODE_ENV !== 'test' && process.argv[1]?.endsWith('server.js')) {
  const port = Number(process.env.PORT ?? 8080);
  serve({ fetch: app.fetch, port });
  console.log(`converter listening on ${port}`);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd converter && npm test -- server`
Expected: PASS.

- [ ] **Step 5: Write the Dockerfile**

`converter/Dockerfile`:
```dockerfile
# Puppeteer image ships a compatible Chromium + all system libs.
FROM ghcr.io/puppeteer/puppeteer:23.6.0

USER root
WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV PUPPETEER_SKIP_DOWNLOAD=  
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

- [ ] **Step 6: Build the image to verify it compiles**

Run: `cd converter && docker build -t slack-stickers-converter .`
Expected: image builds successfully.

- [ ] **Step 7: Commit**

```bash
git add converter/src/server.ts converter/Dockerfile converter/test/server.test.ts
git commit -m "feat(converter): HTTP /convert server and Dockerfile"
```

---

## Phase 7 — Deploy + cutover

### Task 16: Provision Cloudflare resources and deploy

**Files:**
- Modify: `worker/wrangler.toml` (fill `database_id`, add `R2_PUBLIC_BASE` var)
- Create: `DEPLOY.md` (repo root)

- [ ] **Step 1: Create D1 and apply migration**

Run:
```bash
cd worker
npx wrangler d1 create slack-stickers
# copy the printed database_id into wrangler.toml
npx wrangler d1 migrations apply slack-stickers --remote
```

- [ ] **Step 2: Create the R2 bucket and enable public access**

Run:
```bash
npx wrangler r2 bucket create slack-stickers-img
```
Then in the Cloudflare dashboard enable public access (r2.dev URL or a custom domain). Put the resulting base URL (no trailing slash) into `wrangler.toml` as a var:
```toml
[vars]
R2_PUBLIC_BASE = "https://<your-public-bucket-base>"
```

- [ ] **Step 3: Set secrets**

Run:
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put SLACK_SIGNING_SECRET
npx wrangler secret put SLACK_BOT_TOKEN
npx wrangler secret put CONVERTER_URL
```

- [ ] **Step 4: Deploy**

Run: `npx wrangler deploy`
Expected: prints the deployed Worker URL.

- [ ] **Step 5: Write `DEPLOY.md`**

`DEPLOY.md` documents, end-to-end: (a) deploying the converter to Koyeb/Render and getting its URL for `CONVERTER_URL`; (b) the Slack app manifest below; (c) the Telegram `setWebhook` call; (d) seeding the single `workspaces` row.

Slack app manifest (`docs/slack-app-manifest.yaml`):
```yaml
display_information:
  name: Slack Stickers
features:
  bot_user:
    display_name: slack-stickers
    always_online: true
  slash_commands:
    - command: /ss
      url: https://<worker-url>/slack/command
      description: Send a Telegram sticker
      usage_hint: "[link-code]"
oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
settings:
  interactivity:
    is_enabled: true
    request_url: https://<worker-url>/slack/interact
```

Telegram webhook registration (run once):
```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<worker-url>/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Seed the workspace row (replace placeholders):
```bash
cd worker
npx wrangler d1 execute slack-stickers --remote \
  --command "INSERT INTO workspaces (team_id, bot_token, installed_at) VALUES ('<TEAM_ID>', '<xoxb-...>', strftime('%s','now'));"
```

- [ ] **Step 6: Commit**

```bash
git add worker/wrangler.toml DEPLOY.md docs/slack-app-manifest.yaml
git commit -m "chore: cloudflare provisioning config and deploy docs"
```

### Task 17: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Deploy the converter** to Koyeb/Render from `converter/Dockerfile`; set its public URL as the Worker's `CONVERTER_URL` secret; redeploy the Worker.

- [ ] **Step 2: Telegram linking** — DM the bot `/start`; confirm it replies with `/ss <code>`.

- [ ] **Step 3: Slack linking** — in Slack run `/ss <code>`; confirm the ephemeral "You are registered" reply.

- [ ] **Step 4: Static sticker** — send a normal sticker to the bot; confirm "Saved!"; run `/ss`; confirm the picker shows the image; click **Select**; confirm it posts publicly crediting you.

- [ ] **Step 5: Animated sticker** — send an animated sticker; confirm "Processing…" → "Saved!"; verify it appears in `/ss` (as GIF, or static first-frame if the fallback triggered).

- [ ] **Step 6: Pagination + remove** — save 6+ stickers; confirm Next/Prev work and Remove drops a sticker and re-renders the same page.

- [ ] **Step 7: Security spot-check** — POST to `/slack/command` without a signature → 401; POST to `/telegram/webhook` with a wrong secret header → 401.

### Task 18: Remove the legacy implementation

**Files:**
- Delete: `src/`, `deploy.json`, `temp/`, root `package.json`/`package-lock.json` (replaced by per-service packages), `prettier.config.js` (or move into the services)

- [ ] **Step 1: Confirm parity** — Task 17 fully passed.

- [ ] **Step 2: Remove old code and VPS deploy config**

Run:
```bash
git rm -r src deploy.json
git rm -r --ignore-unmatch temp
git rm package.json package-lock.json prettier.config.js
```

- [ ] **Step 3: Rotate the old Telegram token** that was committed in `.env` historically (regenerate via BotFather), update the Worker secret, and re-run `setWebhook`.

- [ ] **Step 4: Update the root `README.md`** to describe the new architecture and point to `DEPLOY.md`.

- [ ] **Step 5: Run both test suites**

Run: `cd worker && npm test && cd ../converter && npm test`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove legacy lowdb/express implementation after cutover"
```

---

## Self-Review notes

- **Spec coverage:** D1 schema (Task 1), security/signature verification (Tasks 4, 9, 10, 11), Block Kit picker + posting (Tasks 6, 10, 11), Telegram webhook + linking (Task 9), dedup + R2 storage + conversion orchestration (Task 8), converter static + animated with first-frame fallback (Tasks 13–15), multi-workspace seam (Tasks 1, 12), free deployment steps (Tasks 16–17), cutover/cleanup + token rotation (Task 18). All spec sections map to a task.
- **Action-ID contract:** `ACTION` constants in `blocks.ts` (Task 6) are the single source consumed by `slackInteract.ts` (Task 11) — names match (`select`, `remove`, `prev`, `next`, `cancel`).
- **Remove-button value contract:** `buildPickerBlocks` packs `"<file_unique_id>:<page>"` (Task 6); `slackInteract` splits on `:` (Task 11) — consistent.
- **Type contract:** `StickerRecord` (Task 1) is used unchanged by db helpers (Tasks 2–3), blocks (Task 6), and ingest (Task 8).
