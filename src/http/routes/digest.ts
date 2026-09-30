import type { Hono } from 'hono';
import { formatDigest, generateDigest } from '../../core/digest.js';

/** `?period=daily|weekly&project=slug&format=md|json` — markdown by default, like /api/summary. */
export function mountDigest(app: Hono): void {
  app.get('/api/digest', async c => {
    const period = c.req.query('period') === 'weekly' ? 'weekly' : 'daily';
    const digest = await generateDigest(period, c.req.query('project') || undefined);
    if (c.req.query('format') === 'json') return c.json(digest);
    return c.text(formatDigest(digest), 200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  });
}
