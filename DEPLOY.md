# Deployment

Slack Stickers runs as two free pieces:

- **Worker** (`worker/`) — Cloudflare Worker handling all HTTP + storage (D1 + R2).
- **Converter** (`converter/`) — a small container (Koyeb/Render free) that converts
  sticker bytes (`webp→png`, `tgs→gif`).

Cost target: **$0/month**.

---

## 1. Converter container (do this first — you need its URL for the Worker)

The converter is a stateless `POST /convert` service. Deploy the `converter/` Dockerfile to a
free container host.

### Koyeb (recommended — one free instance, no card)

1. Push this repo to GitHub.
2. Koyeb → Create Service → GitHub → pick the repo, set the build context to `converter/`
   (Dockerfile build).
3. Expose port `8080`. Deploy.
4. Copy the public URL, e.g. `https://slack-stickers-converter-xxxx.koyeb.app`.

### Render (alternative)

1. New → Web Service → connect repo → root directory `converter/` → Docker runtime.
2. Free instance type, port `8080`. Deploy and copy the URL.

Verify: `curl https://<converter-url>/health` returns `ok`.

> Cold-start is fine: the converter is only hit when you *save* a new sticker, not when you
> post one in Slack.

---

## 2. Worker (Cloudflare)

From `worker/`:

```bash
# 1. Create the D1 database, then paste the printed database_id into wrangler.toml
npx wrangler d1 create slack-stickers

# 2. Apply the schema to the remote DB
npx wrangler d1 migrations apply slack-stickers --remote

# 3. Create the R2 bucket
npx wrangler r2 bucket create slack-stickers-img
```

Enable **public access** on the bucket in the Cloudflare dashboard (R2 → bucket → Settings →
Public access — use the `r2.dev` URL or attach a custom domain). Put the resulting base URL
(no trailing slash) into `worker/wrangler.toml`:

```toml
[vars]
R2_PUBLIC_BASE = "https://<your-public-bucket-base>"
```

Set secrets:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN       # from @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any long random string you choose
npx wrangler secret put SLACK_SIGNING_SECRET     # from the Slack app (Basic Information)
npx wrangler secret put SLACK_BOT_TOKEN          # xoxb-… after installing the Slack app
npx wrangler secret put CONVERTER_URL            # the converter URL from step 1
```

Deploy:

```bash
npx wrangler deploy   # prints your Worker URL, e.g. https://slack-stickers.<subdomain>.workers.dev
```

---

## 3. Slack app

1. api.slack.com/apps → Create New App → **From a manifest** → paste
   `docs/slack-app-manifest.yaml`, replacing `<worker-url>` with your Worker URL.
2. Install the app to your workspace (Install App).
3. Copy the **Bot User OAuth Token** (`xoxb-…`) → set it as the Worker secret `SLACK_BOT_TOKEN`,
   then redeploy (`npx wrangler deploy`).
4. Copy the **Signing Secret** (Basic Information) → set it as `SLACK_SIGNING_SECRET`.

Seed the single workspace row (find your `team_id` in Slack, or it appears in slash-command
payloads):

```bash
cd worker
npx wrangler d1 execute slack-stickers --remote \
  --command "INSERT INTO workspaces (team_id, bot_token, installed_at) VALUES ('<TEAM_ID>', '<xoxb-...>', strftime('%s','now'));"
```

---

## 4. Telegram webhook

Register the webhook once (use the same secret you set as `TELEGRAM_WEBHOOK_SECRET`):

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<worker-url>/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

Verify: `curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"` shows your URL.

---

## 5. End-to-end smoke test

1. DM the Telegram bot `/start` → it replies with `/ss <code>`.
2. In Slack run `/ss <code>` → ephemeral "You are registered".
3. Send a static sticker to the bot → "Saved!"; run `/ss` → picker shows it → **Select** posts it
   publicly.
4. Send an animated sticker → "Processing…" → "Saved!"; appears in `/ss` (GIF, or first-frame PNG
   if the fallback triggered).
5. Save 6+ stickers → confirm Next/Prev and Remove work.
6. Security: a POST to `/slack/command` without a signature returns 401; a POST to
   `/telegram/webhook` with a wrong secret header returns 401.

---

## Notes

- The old `.env` Telegram token (committed historically) must be **rotated** via @BotFather before
  go-live.
- No data migration from the old `lowdb`/`temp` setup — users re-link via `/start` and re-send
  stickers (conversion is deduped globally, so popular stickers convert once).
