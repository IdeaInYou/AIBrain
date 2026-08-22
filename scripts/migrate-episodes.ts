/**
 * One-off migration for episodes written before session-scoped dedupe existed.
 *
 * The Stop hook fires several times per session, so each session produced one
 * episode per firing. Keeps the newest episode per session_id and supersedes the
 * rest, then splits any non-empty `deferred` out into a real todo.
 *
 *   npx tsx scripts/migrate-episodes.ts --dry-run
 *   npx tsx scripts/migrate-episodes.ts
 *
 * Episodes with no session_id are left alone — they were written by hand through
 * memory_remember and are not hook duplicates.
 */
import { randomUUID } from 'node:crypto';
import { INDEX } from '../src/config.js';
import { embedOne } from '../src/embed/embedder.js';
import { logger } from '../src/logger.js';
import { osRequest } from '../src/search/client.js';
import { contentHash } from '../src/search/dedupe.js';
import type { MemoryDoc } from '../src/types.js';

const dryRun = process.argv.includes('--dry-run');

interface Hit {
  _id: string;
  _source: MemoryDoc;
}

const res = await osRequest<{ hits: { hits: Hit[] } }>('POST', `/${INDEX.memories}/_search`, {
  size: 1000,
  _source: { excludes: ['embedding'] },
  query: { bool: { filter: [{ term: { type: 'episode' } }, { term: { status: 'active' } }] } },
  sort: [{ created_at: 'desc' }],
});

const bySession = new Map<string, Hit[]>();
let orphans = 0;
for (const hit of res.hits.hits) {
  const sid = hit._source.source?.session_id;
  if (!sid) {
    orphans++;
    continue;
  }
  if (!bySession.has(sid)) bySession.set(sid, []);
  bySession.get(sid)!.push(hit);
}

let superseded = 0;
let todosCreated = 0;
const keepers: Hit[] = [];

for (const [sid, hits] of bySession) {
  // Sorted created_at desc, so the first is the newest and most complete.
  const [keep, ...rest] = hits;
  if (!keep) continue;
  keepers.push(keep);

  if (rest.length) {
    console.log(`session ${sid}: keeping ${keep._id}, superseding ${rest.length}`);
    if (!dryRun) {
      for (const dup of rest) {
        await osRequest(
          'POST',
          `/${INDEX.memories}/_update/${dup._id}`,
          { doc: { status: 'superseded', superseded_by: keep._id } },
          { refresh: 'wait_for' },
        );
      }
    }
    superseded += rest.length;
  }
}

// Split deferred out of every surviving episode that has one and lacks a todo.
for (const keep of keepers) {
  const deferred = keep._source.episode?.deferred?.trim();
  if (!deferred) continue;
  const sid = keep._source.source?.session_id;
  if (!sid) continue;

  const existing = await osRequest<{ hits: { total: { value: number } } }>(
    'POST',
    `/${INDEX.memories}/_search`,
    {
      size: 0,
      query: {
        bool: {
          filter: [{ term: { type: 'todo' } }, { term: { 'source.session_id': sid } }, { term: { tags: 'deferred' } }],
        },
      },
    },
  );
  if (existing.hits.total.value > 0) continue;

  console.log(`session ${sid}: creating todo -> ${deferred.slice(0, 70)}`);
  todosCreated++;
  if (dryRun) continue;

  const now = new Date().toISOString();
  const doc: MemoryDoc = {
    content: deferred,
    embedding: await embedOne(deferred, 'passage'),
    type: 'todo',
    project: keep._source.project,
    tags: ['deferred'],
    importance: 3,
    status: 'active',
    superseded_by: null,
    episode: null,
    source: keep._source.source,
    related: [],
    refs: [],
    note: null,
    occurred_at: keep._source.occurred_at,
    created_at: now,
    content_hash: contentHash(deferred),
  };
  await osRequest('PUT', `/${INDEX.memories}/_doc/${randomUUID()}`, doc, { refresh: 'wait_for' });
}

logger.info(
  { sessions: bySession.size, kept: keepers.length, superseded, todosCreated, orphans, dryRun },
  'episode migration complete',
);
console.log(
  `\n${dryRun ? '[dry run] ' : ''}sessions=${bySession.size} kept=${keepers.length} ` +
    `superseded=${superseded} todos=${todosCreated} no-session-id=${orphans}`,
);
