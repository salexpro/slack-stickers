# Slack Stickers

Send your Telegram stickers in Slack. Send a sticker to the Telegram bot, then use the `/ss`
slash command in Slack to post it.

## Architecture

Two free-to-run pieces:

- **`worker/`** — a Cloudflare Worker (Hono + TypeScript) handling all HTTP and storage:
  the Telegram webhook, the Slack `/ss` slash command, Block Kit interactivity, and a dormant
  OAuth callback (the seam for multi-workspace later). State lives in **D1** (SQLite) and
  converted images in a public **R2** bucket.
- **`converter/`** — a small stateless Node container that converts sticker bytes
  (`webp→png` via sharp, `tgs→gif` via headless Lottie with a first-frame PNG fallback).
  Bytes in → image bytes out; holds no secrets.

```
Telegram ──▶ Worker /telegram/webhook ──▶ (dedup) ──▶ Converter ──▶ R2 + D1
Slack /ss ──▶ Worker /slack/command ──▶ Block Kit picker
   click  ──▶ Worker /slack/interact ──▶ posts the image in-channel
```

## Develop

```bash
cd worker && npm install && npm test       # Cloudflare Worker (vitest-pool-workers)
cd converter && npm install && npm test     # converter service (vitest)
```

## Deploy (free)

See [DEPLOY.md](./DEPLOY.md) — Cloudflare Workers + D1 + R2 for the Worker, Koyeb/Render free tier
for the converter. Cost target: $0/month.

## Docs

- Design spec: `docs/superpowers/specs/2026-06-16-slack-stickers-rebuild-design.md`
- Implementation plan: `docs/superpowers/plans/2026-06-16-slack-stickers-rebuild.md`
- Slack app manifest: `docs/slack-app-manifest.yaml`
