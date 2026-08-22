import type { Hono } from 'hono';
import { LIMITS } from '../../config.js';
import { fileContext } from '../../core/fileContext.js';
import { recall } from '../../core/memory.js';
import { MEMORY_TYPES, type MemoryType } from '../../types.js';

/** Feeds the PreToolUse hooks. Both routes are read-only and deliberately small. */
export function mountFileContext(app: Hono): void {
  app.get('/api/file-context', async c => {
    const path = c.req.query('path')?.trim();
    if (!path) return c.json({ error: 'path is required' }, 400);

    const kRaw = Number(c.req.query('k'));
    const k = Number.isFinite(kRaw) && kRaw > 0 ? Math.min(kRaw, 10) : 3;

    return c.json(await fileContext(path, k));
  });

  // Used by the Bash matcher: "did this command go wrong last time?"
  app.get('/api/recall', async c => {
    const q = c.req.query('q')?.trim();
    if (!q) return c.json({ error: 'q is required' }, 400);

    const kRaw = Number(c.req.query('k'));
    const k = Number.isFinite(kRaw) && kRaw > 0 ? Math.min(kRaw, LIMITS.recallK) : 3;

    const types = (c.req.query('type') ?? '')
      .split(',')
      .map(t => t.trim())
      .filter((t): t is MemoryType => (MEMORY_TYPES as readonly string[]).includes(t));

    const hits = await recall({
      query: q,
      k,
      ...(types.length ? { type: types } : {}),
      ...(c.req.query('project') ? { project: c.req.query('project')! } : {}),
    });

    return c.json({
      query: q,
      items: hits.map(h => ({
        id: h.id,
        date: h.occurred_at.slice(0, 10),
        type: h.type,
        project: h.project,
        summary: h.episode?.did?.trim() || h.content,
        ref: h.refs[0] ?? '',
      })),
    });
  });
}
