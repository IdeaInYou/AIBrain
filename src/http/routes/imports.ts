import type { Hono } from 'hono';
import * as z from 'zod';
import { LIMITS } from '../../config.js';
import { importMemories } from '../../core/imports.js';
import { MEMORY_TYPES } from '../../types.js';

const RecordSchema = z.object({
  content: z.string().max(LIMITS.contentChars).optional(),
  type: z.enum(MEMORY_TYPES),
  project: z.string().optional(),
  tags: z.array(z.string()).max(6).optional(),
  importance: z.number().int().min(1).max(5).optional(),
  refs: z.array(z.string()).max(LIMITS.maxRefs).optional(),
  occurred_at: z.string().optional(),
  episode: z
    .object({
      did: z.string().optional(),
      why: z.string().optional(),
      outcome: z.string().optional(),
      deferred: z.string().optional(),
      files: z.array(z.string()).max(10).optional(),
    })
    .optional(),
});

const MAX_RECORDS = 500;

/** JSON body `{ records: [...] }`, or an NDJSON body with one record per line. */
export function mountImports(app: Hono): void {
  app.post('/api/imports', async c => {
    const isNdjson = (c.req.header('content-type') ?? '').includes('ndjson');
    let raw: unknown[];
    try {
      raw = isNdjson
        ? (await c.req.text())
            .split('\n')
            .map(l => l.trim())
            .filter(Boolean)
            .map(l => JSON.parse(l) as unknown)
        : ((await c.req.json()) as { records?: unknown[] }).records ?? [];
    } catch {
      return c.json({ error: 'body is not valid JSON / NDJSON' }, 400);
    }

    const parsed = z.array(RecordSchema).max(MAX_RECORDS).safeParse(raw);
    if (!parsed.success) return c.json({ error: 'invalid records', issues: parsed.error.issues.slice(0, 10) }, 400);

    return c.json(await importMemories(parsed.data));
  });
}
