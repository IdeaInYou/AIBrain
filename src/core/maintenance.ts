import { INDEX } from '../config.js';
import { logger } from '../logger.js';
import { osRequest } from '../search/client.js';
import { cosine } from '../search/dedupe.js';
import { DEDUPED_TYPES, type MemoryDoc, type MemoryType } from '../types.js';

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

/* --------------------------------------------------- duplicate merging */

export interface MergeCandidate {
  id: string;
  project: string;
  type: MemoryType;
  occurred_at: string;
  created_at: string;
  embedding: number[];
}

export interface PlannedMerge {
  keep: string;
  drop: string;
  cosine: number;
}

/**
 * Which records to fold into which. Only same project + same type, closest
 * pairs first; a record already dropped in this plan is never kept or dropped
 * again, so chains resolve without cycles. The newer record wins — it is the
 * later statement of the same thing.
 */
export function planMerges(docs: MergeCandidate[], threshold: number): PlannedMerge[] {
  const pairs: PlannedMerge[] = [];
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i]!;
      const b = docs[j]!;
      if (a.project !== b.project || a.type !== b.type) continue;
      const sim = cosine(a.embedding, b.embedding);
      if (sim < threshold) continue;
      const aNewer = (a.occurred_at || a.created_at) > (b.occurred_at || b.created_at);
      pairs.push({ keep: aNewer ? a.id : b.id, drop: aNewer ? b.id : a.id, cosine: Number(sim.toFixed(4)) });
    }
  }
  pairs.sort((x, y) => y.cosine - x.cosine);

  const dropped = new Set<string>();
  const plan: PlannedMerge[] = [];
  for (const p of pairs) {
    if (dropped.has(p.keep) || dropped.has(p.drop)) continue;
    dropped.add(p.drop);
    plan.push(p);
  }
  return plan;
}

export interface MergeReport {
  dry_run: boolean;
  scanned: number;
  threshold: number;
  merges: (PlannedMerge & { keep_content: string; drop_content: string })[];
}

/**
 * Folds near-identical facts/decisions/preferences/todos that slipped past
 * write-time dedupe. Episodes are excluded: each session is its own record.
 * The dropped record is superseded, not deleted; its refs, tags and importance
 * move onto the kept one so no note link is lost.
 */
export async function mergeDuplicates(args: {
  project?: string;
  threshold: number;
  limit: number;
  dryRun: boolean;
}): Promise<MergeReport> {
  const filter: unknown[] = [{ term: { status: 'active' } }, { terms: { type: [...DEDUPED_TYPES] } }];
  if (args.project) filter.push({ term: { project: args.project } });

  const res = await osRequest<{ hits: { hits: Hit[] } }>('POST', `/${INDEX.memories}/_search`, {
    size: args.limit,
    _source: { excludes: ['note'] },
    query: { bool: { filter } },
    sort: [{ occurred_at: 'desc' }],
  });

  const byId = new Map(res.hits.hits.map(h => [h._id, h._source]));
  const docs: MergeCandidate[] = res.hits.hits
    .filter(h => Array.isArray(h._source.embedding) && h._source.embedding.length > 0)
    .map(h => ({
      id: h._id,
      project: h._source.project,
      type: h._source.type,
      occurred_at: h._source.occurred_at,
      created_at: h._source.created_at,
      embedding: h._source.embedding,
    }));

  const plan = planMerges(docs, args.threshold);
  const report: MergeReport = {
    dry_run: args.dryRun,
    scanned: docs.length,
    threshold: args.threshold,
    merges: plan.map(p => ({
      ...p,
      keep_content: byId.get(p.keep)!.content,
      drop_content: byId.get(p.drop)!.content,
    })),
  };

  if (!args.dryRun) {
    for (const { keep, drop } of plan) {
      const k = byId.get(keep)!;
      const d = byId.get(drop)!;
      // Chains (A→B→C) mutate `k` in place so later merges see accumulated fields.
      k.refs = [...new Set([...(k.refs ?? []), ...(d.refs ?? [])])];
      k.tags = [...new Set([...(k.tags ?? []), ...(d.tags ?? [])])];
      k.importance = Math.max(k.importance, d.importance);
      await osRequest('POST', `/${INDEX.memories}/_update/${keep}`, {
        doc: { refs: k.refs, tags: k.tags, importance: k.importance },
      });
      await osRequest(
        'POST',
        `/${INDEX.memories}/_update/${drop}`,
        { doc: { status: 'superseded', superseded_by: keep } },
        { refresh: 'wait_for' },
      );
    }
  }

  logger.info(
    { scanned: report.scanned, merges: plan.length, dry_run: args.dryRun },
    args.dryRun ? 'maintenance: duplicate merge (dry run)' : 'maintenance: duplicates merged',
  );
  return report;
}
