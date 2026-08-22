import type { Hono } from 'hono';
import { config } from '../../config.js';
import { buildSummary } from '../../core/summary.js';

/**
 * Same text memory_summary returns, as markdown — the SessionStart hook pipes
 * this straight into Claude Code's context.
 */
export function mountSummary(app: Hono): void {
  app.get('/api/summary', async c => {
    const project = c.req.query('project')?.trim();
    const daysRaw = Number(c.req.query('days'));
    const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : config.SUMMARY_DAYS;

    const text = await buildSummary({ ...(project ? { project } : {}), days });
    return c.text(text, 200, { 'content-type': 'text/markdown; charset=utf-8' });
  });
}
