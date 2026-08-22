import { INDEX } from '../config.js';
import { logger } from '../logger.js';
import { osRequest } from '../search/client.js';
import { cosine } from '../search/dedupe.js';
import type { MemoryDoc, MemoryType } from '../types.js';

interface Hit {
  _id: string;
  _source: MemoryDoc;
}

/* ------------------------------------------------ episode deduplication */

export interface EpisodeDedupeReport {
  dry_run: boolean;
  sessions: number;
  kept: number;
  superseded: number;
  no_session_id: number;
  groups: { session_id: string; kept: string; superseded: string[] }[];
}

/**
 * Collapses episodes written before session-scoped dedupe existed: the Stop hook
 * fired several times per session, so one session produced several records.
 * Keeps the newest per session — it saw the most of the transcript — and
 * supersedes the rest rather than deleting, so the history stays walkable.
 *
 * Episodes with no session_id are left alone: they came from memory_remember by
 * hand, not from hook duplication.
 */
export async function dedupeEpisodes(project: string | undefined, dryRun: boolean): Promise<EpisodeDedupeReport> {
  const filter: unknown[] = [{ term: { type: 'episode' } }, { term: { status: 'active' } }];
  if (project) filter.push({ term: { project } });

  const res = await osRequest<{ hits: { hits: Hit[] } }>('POST', `/${INDEX.memories}/_search`, {
    size: 1000,
    _source: { excludes: ['embedding', 'note'] },
    query: { bool: { filter } },
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

  const report: EpisodeDedupeReport = {
    dry_run: dryRun,
    sessions: bySession.size,
    kept: 0,
    superseded: 0,
    no_session_id: orphans,
    groups: [],
  };

  for (const [sessionId, hits] of bySession) {
    const [keep, ...rest] = hits; // sorted created_at desc
    if (!keep) continue;
    report.kept++;
    if (rest.length === 0) continue;

    report.groups.push({ session_id: sessionId, kept: keep._id, superseded: rest.map(h => h._id) });
    report.superseded += rest.length;

    if (dryRun) continue;
    for (const dup of rest) {
      await osRequest(
        'POST',
        `/${INDEX.memories}/_update/${dup._id}`,
        { doc: { status: 'superseded', superseded_by: keep._id } },
        { refresh: 'wait_for' },
      );
    }
  }

  logger.info(
    { ...report, groups: report.groups.length },
    dryRun ? 'maintenance: episode dedupe (dry run)' : 'maintenance: episodes deduped',
  );
  return report;
}

/* ------------------------------------------------------ similarity audit */

export interface SimilarPair {
  a: { id: string; content: string; occurred_at: string; importance: number };
  b: { id: string; content: string; occurred_at: string; importance: number };
  cosine: number;
}

/**
 * Pairwise similarity above a threshold, for calibrating DEDUPE_THRESHOLD
 * against real data and for spotting decisions that may contradict each other.
 *
 * Runs against the live embeddings, so the numbers reflect the model actually in
 * use — the only honest way to answer "would a lower threshold have merged these?".
 */
export async function findSimilar(args: {
  project?: string;
  types?: MemoryType[];
  threshold: number;
  limit?: number;
}): Promise<{ scanned: number; threshold: number; pairs: SimilarPair[] }> {
  const filter: unknown[] = [{ term: { status: 'active' } }];
  if (args.project) filter.push({ term: { project: args.project } });
  if (args.types?.length) filter.push({ terms: { type: args.types } });

  const res = await osRequest<{ hits: { hits: Hit[] } }>('POST', `/${INDEX.memories}/_search`, {
    size: Math.min(args.limit ?? 200, 500),
    _source: { excludes: ['note'] }, // embeddings needed here
    query: { bool: { filter } },
    sort: [{ occurred_at: 'desc' }],
  });

  const docs = res.hits.hits.filter(h => Array.isArray(h._source.embedding) && h._source.embedding.length > 0);
  const pairs: SimilarPair[] = [];

  // O(n²) but bounded by `limit`; this is an operator tool, not a hot path.
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i]!;
      const b = docs[j]!;
      const sim = cosine(a._source.embedding, b._source.embedding);
      if (sim < args.threshold) continue;
      pairs.push({
        a: { id: a._id, content: a._source.content, occurred_at: a._source.occurred_at, importance: a._source.importance },
        b: { id: b._id, content: b._source.content, occurred_at: b._source.occurred_at, importance: b._source.importance },
        cosine: Number(sim.toFixed(4)),
      });
    }
  }

  pairs.sort((x, y) => y.cosine - x.cosine);
  return { scanned: docs.length, threshold: args.threshold, pairs };
}
