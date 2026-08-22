import type { Hono } from 'hono';
import * as z from 'zod';
import { LIMITS } from '../../config.js';
import { ingest } from '../../core/ingest.js';
import { MEMORY_TYPES, SOURCE_KINDS } from '../../types.js';

const FactSchema = z.object({
  content: z.string().min(1).max(LIMITS.contentChars),
  type: z.enum(MEMORY_TYPES),
  project: z.string().optional(),
  tags: z.array(z.string()).max(6).default([]),
  importance: z.number().int().min(1).max(5).default(3),
});

const IngestSchema = z.object({
  episode: z
    .object({
      did: z.string().default(''),
      why: z.string().default(''),
      outcome: z.string().default(''),
      deferred: z.string().default(''),
      files: z.array(z.string()).max(10).default([]),
    })
    .optional(),
  facts: z.array(FactSchema).max(LIMITS.ingestFacts).default([]),
  project: z.string().optional(),
  occurred_at: z.string().optional(),
  source: z
    .object({
      kind: z.enum(SOURCE_KINDS).default('hook'),
      client: z.string().nullish().default(null),
      device: z.string().nullish().default(null),
      session_id: z.string().nullish().default(null),
    })
    .optional(),
});

/** The Stop hook's write path. Body must already be English — the server never translates. */
export function mountIngest(app: Hono): void {
  app.post('/api/ingest', async c => {
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > LIMITS.ingestBytes) {
      return c.json({ error: `body exceeds ${LIMITS.ingestBytes} bytes` }, 413);
    }

    const raw = await c.req.json().catch(() => null);
    const parsed = IngestSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid body', issues: parsed.error.issues.slice(0, 10) }, 400);
    }

    const body = parsed.data;
    if (!body.episode && body.facts.length === 0) {
      return c.json({ error: 'nothing to ingest: provide episode, facts, or both' }, 400);
    }

    const result = await ingest({
      ...(body.episode ? { episode: body.episode } : {}),
      facts: body.facts,
      ...(body.project ? { project: body.project } : {}),
      ...(body.occurred_at ? { occurred_at: body.occurred_at } : {}),
      ...(body.source
        ? {
            source: {
              kind: body.source.kind,
              client: body.source.client ?? null,
              device: body.source.device ?? null,
              session_id: body.source.session_id ?? null,
            },
          }
        : {}),
    });

    return c.json(result);
  });
}
