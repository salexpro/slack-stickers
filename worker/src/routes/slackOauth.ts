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
