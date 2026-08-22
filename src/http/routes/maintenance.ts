import type { Hono } from 'hono';
import { dedupeEpisodes, findSimilar } from '../../core/maintenance.js';
import { MEMORY_TYPES, type MemoryType } from '../../types.js';

/** Operator tools. Behind the same auth as everything else. */
export function mountMaintenance(app: Hono): void {
  // Defaults to a dry run: a destructive default on an operator endpoint is a trap.
  app.post('/api/maintenance/dedupe-episodes', async c => {
    const body = (await c.req.json().catch(() => ({}))) as { project?: string; apply?: boolean };
    return c.json(await dedupeEpisodes(body.project, body.apply !== true));
  });

  app.get('/api/maintenance/similar', async c => {
    const raw = Number(c.req.query('threshold'));
    const threshold = Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.85;

    const types = (c.req.query('type') ?? '')
      .split(',')
      .map(t => t.trim())
      .filter((t): t is MemoryType => (MEMORY_TYPES as readonly string[]).includes(t));

    const limitRaw = Number(c.req.query('limit'));

    return c.json(
      await findSimilar({
        ...(c.req.query('project') ? { project: c.req.query('project')! } : {}),
        ...(types.length ? { types } : {}),
        threshold,
        ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}),
      }),
    );
  });
}
