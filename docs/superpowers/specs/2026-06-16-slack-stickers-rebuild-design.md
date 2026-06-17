# Slack Stickers — Modernized Rebuild Design

**Date:** 2026-06-16
**Status:** Approved design, ready for implementation planning

## Goal

Rebuild the existing "Telegram sticker → Slack" bridge on a clean, current stack
with proper architecture, keeping the same core feature set, deployable for **$0/month**
with no servers to maintain.

- **Scope:** Modernize & rebuild properly. Same core feature; no new product features in v1.
- **Distribution:** Single workspace now, structured so multi-workspace OAuth is a clean
  later extension (not a rewrite).
- **Hosting:** Cloudflare Workers + R2 + D1, plus one small free converter container.

## Why the rebuild (problems with the 2020 version)

- **Legacy Slack APIs (likely already broken):** uses `oauth.access` (now `oauth.v2.access`)
  and legacy interactive message attachments with `actions` buttons (deprecated in favor of
  Block Kit).
- **No request authentication:** `index.js` captured `rawBody` for signature verification but
  never verified it. Endpoints were open.
- **Stateful local disk:** `lowdb` JSON file + images in `temp/images/` require persistent disk
  and an always-on process — incompatible with free/serverless tiers.
- **Long-polling Telegram bot:** needs an always-on process; free tiers sleep when idle.
- **Native conversion only:** `sharp` + a git-sourced `tgs-to-gif` need native binaries.
- **Stale deps with CVEs:** `axios@0.18`, `express@4`, `sharp@0.26`, `node-telegram-bot-api@0.30`,
  `dotenv@6`, etc.
- **Weak identity:** `md5(userId)` used as both identity and linking token; guessable.
- **Deploy tied to a personal VPS** via PM2 (`deploy.json`).

## Architecture

Three components:

1. **Cloudflare Worker** (TypeScript + Hono) — all HTTP and orchestration, no heavy CPU.
   Routes:
   - `POST /telegram/webhook` — Telegram updates (`/start`, `/help`, incoming stickers)
   - `POST /slack/command` — the `/ss` slash command
   - `POST /slack/interact` — Block Kit interactivity (Select / Remove / Prev / Next / Cancel)
   - `GET  /slack/oauth` — OAuth callback; built but dormant in v1 (the multi-workspace seam)
   - Bindings: **D1** (database), **R2** (image bucket)
   - Secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`,
     `SLACK_BOT_TOKEN`, `CONVERTER_URL`

2. **Converter service** (small Node container on Koyeb/Render free tier) — one stateless route
   `POST /convert`: bytes in → PNG/GIF bytes out. `sharp` for `webp→png` (resize 150px), a Lottie
   renderer for `tgs→gif`. Holds no secrets. Free to cold-start (only hit when saving a new sticker).

3. **R2 bucket** (public) — stores converted images at `stickers/<file_unique_id>.png|.gif`.
   Its public URL is what Slack loads as the image.

The Worker holds the Telegram token + R2 binding; it fetches the raw sticker, hands bytes to the
converter, gets converted bytes back, and stores them in R2. The converter is a pure
bytes-in → bytes-out function.

## Data flow

### Flow A — saving a sticker (Telegram side)

```
You send sticker → Telegram → Worker /telegram/webhook
  → dedup: is file_unique_id already in D1.stickers?
      yes → just link it to you
      no  → Worker getFile + download raw bytes
          → POST bytes to Converter → get PNG/GIF back
          → Worker writes to R2, inserts stickers row
  → link sticker to your telegram_user_id (user_stickers)
  → bot replies "saved" (for animated: "processing…" then edit to "done")
```

Conversion is off the Slack hot path and deduped globally — each unique sticker is converted
once, ever.

### Flow B — linking Slack ↔ Telegram

```
/start in Telegram → bot replies a short random code
                     (stored token → telegram_user_id, with expiry)
/ss <code> in Slack → Worker verifies Slack signature → resolves code
                     → stores link (team_id, slack_user_id → telegram_user_id) → "registered"
```

### Flow C — posting a sticker (Slack side)

```
/ss  → verify signature → resolve link → load your stickers (paginated)
     → respond <3s with Block Kit: image blocks + Select/Remove + Prev/Next/Cancel
Select → /slack/interact → post publicly (in_channel) as an image block, delete the picker
Remove → unlink + re-render page
Prev/Next → re-render with new page offset
Cancel → delete the picker
```

## Data model (D1 / SQLite)

```sql
-- One row per installed workspace. v1 has a single row; this is the multi-tenant seam.
CREATE TABLE workspaces (
  team_id      TEXT PRIMARY KEY,
  bot_token    TEXT NOT NULL,          -- Slack bot token (xoxb-…)
  installed_at INTEGER NOT NULL
);

-- Slack user ↔ Telegram user link.
CREATE TABLE links (
  team_id          TEXT NOT NULL,
  slack_user_id    TEXT NOT NULL,
  telegram_user_id INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,
  PRIMARY KEY (team_id, slack_user_id)
);

-- Short-lived codes handed out by /start in Telegram, consumed by /ss in Slack.
CREATE TABLE link_tokens (
  token            TEXT PRIMARY KEY,    -- crypto-random, not md5(userId)
  telegram_user_id INTEGER NOT NULL,
  expires_at       INTEGER NOT NULL
);

-- Global converted-sticker cache (dedup across all users).
CREATE TABLE stickers (
  file_unique_id TEXT PRIMARY KEY,
  ext            TEXT NOT NULL,         -- 'png' | 'gif'
  animated       INTEGER NOT NULL,
  r2_key         TEXT NOT NULL,
  public_url     TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

-- Which stickers a given Telegram user has saved (their personal tray).
CREATE TABLE user_stickers (
  telegram_user_id INTEGER NOT NULL,
  file_unique_id   TEXT NOT NULL,
  added_at         INTEGER NOT NULL,
  PRIMARY KEY (telegram_user_id, file_unique_id)
);
```

This removes the old `md5(userId)`-as-identity confusion: linking uses real random tokens, and the
Slack → Telegram → stickers chain is explicit relations instead of two overloaded JSON maps.

## Security (all new vs. the 2020 version, which had none)

- **Slack signature verification** on `/slack/command` and `/slack/interact`: HMAC-SHA256 of
  `v0:{timestamp}:{rawBody}` with the signing secret; reject if the timestamp is older than 5 min
  (replay guard).
- **Telegram webhook secret:** set via `setWebhook(secret_token=…)`; verify the
  `X-Telegram-Bot-Api-Secret-Token` header on every update.
- **Link tokens:** crypto-random, single-use, short TTL.
- **R2:** public bucket is acceptable (sticker images are non-sensitive and posted publicly anyway);
  keys are by `file_unique_id`, no user enumeration.
- **Secrets** via `wrangler secret put`; never committed. The old `.env` should be rotated/abandoned.

## Tech stack

- **Worker:** TypeScript, Hono router, Cloudflare Workers runtime, `wrangler` for deploy.
- **Storage:** D1 (SQLite) + R2 (object storage), both via native Worker bindings.
- **Converter:** Node + Hono/Express in a Docker container; `sharp` + a maintained Lottie renderer.
- **Dropped deps:** `axios`, `lodash`, `qs`, `dotenv`, `lowdb`, `body-parser`, `node-telegram-bot-api`,
  PM2 (replaced by webhook + `fetch` + bindings + Slack/Telegram REST calls directly).

## Free deployment

**Worker (Cloudflare):**
1. `wrangler init`; bind D1 + R2 in `wrangler.toml`.
2. `wrangler d1 create slack-stickers` → run schema migration.
3. `wrangler r2 bucket create slack-stickers-img` → enable public access.
4. `wrangler secret put TELEGRAM_BOT_TOKEN / TELEGRAM_WEBHOOK_SECRET / SLACK_SIGNING_SECRET /
   SLACK_BOT_TOKEN / CONVERTER_URL`.
5. `wrangler deploy`.

**Slack app:** create from a manifest — slash command `/ss` → `…/slack/command`, interactivity →
`…/slack/interact`, scopes `commands` + `chat:write`; install to your workspace; copy signing secret
+ bot token into Worker secrets; insert one `workspaces` row.

**Telegram:** `setWebhook` to `…/telegram/webhook` with the secret token.

**Converter:** Dockerfile (`sharp` + Lottie renderer); deploy to **Koyeb free instance** (one free web
service, no card) or Render free; set its URL as `CONVERTER_URL`. Cold-start is acceptable since it is
only hit when saving a new sticker.

**Cost: $0/month**, no servers to patch, no PM2, no VPS.

## Risks / validate during implementation

- **Animated `.tgs` rendering is the riskiest single piece.** The old `tgs-to-gif` is an unmaintained
  git dependency that renders Lottie via headless Chromium (heavy). Spike a maintained alternative
  (current Lottie → GIF/APNG renderer) early. **Fallback:** render the first frame as a static PNG for
  animated stickers — still in-container, no UX cliff.
- **Slack `webp` rendering:** convert `webp → png` for reliability rather than relying on Slack to
  render webp.
- **3-second Slack response budget:** `/slack/command` must respond within 3s; D1 reads are fast, but
  keep the picker render free of network calls beyond D1.

## Migration

No data migration. The old `lowdb` data and `temp/images` are discardable — users re-link via `/start`
and re-send stickers (conversion is deduped, so popular stickers convert once). The old VPS/PM2 deploy
and committed `.env` are abandoned and the token rotated.

## Out of scope (v1)

- Multi-workspace OAuth distribution (data model supports it; flow is dormant).
- Sticker search, packs, favorites, or any new UX beyond the 2020 feature set.
