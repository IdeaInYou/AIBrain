import { randomUUID } from 'node:crypto';
import { INDEX, LIMITS, config } from '../config.js';
import { embedOne } from '../embed/embedder.js';
import { logger } from '../logger.js';
import { osRequest, statusOf } from '../search/client.js';
import { contentHash } from '../search/dedupe.js';
import { listMemories, searchMemories, type RawHit } from '../search/hybrid.js';
import { rerank } from '../search/rerank.js';
import { findEpisodeBySession } from './remember.js';
import { recordEvent } from './events.js';
import { hydrateRelated, linkPair, type SeeAlso } from './related.js';
import type {
  MemoryDoc,
  MemoryFilters,
  MemoryHit,
  MemoryStatus,
  MemoryType,
  RememberResult,
} from '../types.js';

/** Accepts an ISO timestamp or a relative shorthand: `30d`, `12h`, `4w`, `6m`. */
export function parseSince(input?: string): string | undefined {
  if (!input) return undefined;
  const rel = /^(\d+)\s*([hdwm])$/i.exec(input.trim());
  if (rel) {
    const unitMs = { h: 3_600_000, d: 86_400_000, w: 604_800_000, m: 2_592_000_000 };
    const unit = unitMs[rel[2]!.toLowerCase() as keyof typeof unitMs];
    return new Date(Date.now() - Number(rel[1]) * unit).toISOString();
  }
  const parsed = Date.parse(input);
  if (Number.isNaN(parsed)) throw new Error(`Cannot parse "since": ${input}`);
  return new Date(parsed).toISOString();
}

/** Context budget: see_also on the top 3 hits only, 3 neighbours each. */
const SEE_ALSO_FOR = 3;
const SEE_ALSO_MAX = 3;

export function toHit(raw: RawHit): MemoryHit {
  const s = raw._source;
  return {
    id: raw._id,
    content: s.content,
    type: s.type,
    project: s.project,
    tags: s.tags ?? [],
    importance: s.importance,
    status: s.status,
    episode: s.episode ?? null,
    refs: s.refs ?? [],
    has_note: Boolean(s.note),
    occurred_at: s.occurred_at,
    created_at: s.created_at,
    score: raw._score,
  };
}

export interface RecallInput {
  query: string;
  project?: string | string[];
  type?: MemoryType[];
  since?: string;
  until?: string;
  k?: number;
}

/** Recall result plus the neighbours of the strongest hits. */
export interface RecalledHit extends MemoryHit {
  see_also?: SeeAlso[];
}

export async function recall(input: RecallInput): Promise<RecalledHit[]> {
  const k = Math.min(Math.max(input.k ?? config.RECALL_DEFAULT_K, 1), LIMITS.recallK);
  const filters: MemoryFilters = {
    status: ['active'],
    ...(input.project ? { project: Array.isArray(input.project) ? input.project : [input.project] } : {}),
    ...(input.type?.length ? { type: input.type } : {}),
    ...(input.since ? { since: parseSince(input.since)! } : {}),
    ...(input.until ? { until: parseSince(input.until)! } : {}),
  };

  const started = Date.now();
  const vector = await embedOne(input.query, 'query');
  // Over-fetch so the type-aware rerank has room to reorder before truncating.
  const raw = await searchMemories({ query: input.query, vector, filters, k: k * 3 });
  const hits: RecalledHit[] = rerank(raw.map(toHit)).slice(0, k);

  // Only the top few: see_also on every hit would swamp the context budget.
  const byId = new Map(raw.map(h => [h._id, h._source.related ?? []]));
  await Promise.all(
    hits.slice(0, SEE_ALSO_FOR).map(async hit => {
      const ids = (byId.get(hit.id) ?? []).filter(id => !hits.some(h => h.id === id));
      const seeAlso = await hydrateRelated(ids.slice(0, SEE_ALSO_MAX));
      if (seeAlso.length) hit.see_also = seeAlso;
    }),
  );

  recordEvent({
    kind: 'recall',
    k,
    hits: hits.length,
    latency_ms: Date.now() - started,
    query_len: input.query.length,
    ...(hits[0] ? { top_score: Number(hits[0].score.toFixed(4)) } : {}),
  });
  return hits;
}

/** Backs memory://notes/{id} — gives clients without the repo the full note text. */
export async function getNote(id: string): Promise<{ note: string; project: string; refs: string[] } | null> {
  const doc = await getById(id);
  if (!doc?.note) return null;
  return { note: doc.note, project: doc.project, refs: doc.refs ?? [] };
}

export async function getById(id: string): Promise<MemoryDoc | null> {
  try {
    const res = await osRequest<{ _source: MemoryDoc }>('GET', `/${INDEX.memories}/_doc/${id}`);
    return res._source;
  } catch (err) {
    if (statusOf(err) === 404) return null;
    throw err;
  }
}

/** How far back to look for the session that closed a todo. Same window as commits. */
const CLOSURE_WINDOW = 'now-2h';

/**
 * When a todo raised in one session is closed in another, link the two episodes
 * so "when did we actually finish this?" is answerable.
 *
 * Heuristic by necessity: the closer does not tell us which session it belongs
 * to, so the newest episode in the same project inside the window is taken as
 * the closing one. Bounded and skipped entirely when nothing matches, so the
 * worst case is a missing link rather than a wrong one.
 */
async function linkTodoClosure(todoId: string, todo: MemoryDoc): Promise<void> {
  const sessionId = todo.source?.session_id;
  if (!sessionId) return;

  const origin = await findEpisodeBySession(sessionId);
  if (!origin) return;

  const recent = await listMemories(
    { status: ['active'], type: ['episode'], project: [todo.project], since: CLOSURE_WINDOW },
    2,
  );
  const closing = recent.map(toHit).find(e => e.id !== origin.id);
  if (!closing) return;

  await linkPair(origin.id, closing.id);
  await linkPair(todoId, closing.id);
  logger.info({ todoId, origin: origin.id, closing: closing.id }, 'related: todo closure chained');
}

export interface UpdateInput {
  id: string;
  content?: string;
  type?: MemoryType;
  tags?: string[];
  importance?: number;
  status?: Extract<MemoryStatus, 'active' | 'done'>;
}

/**
 * A status-only change (marking a todo done) is applied in place. A content
 * change writes a new document and points the old one at it, so the history
 * stays walkable via `superseded_by`.
 */
export async function updateMemory(input: UpdateInput): Promise<RememberResult> {
  const existing = await getById(input.id);
  if (!existing) throw new Error(`Memory ${input.id} not found`);

  const statusOnly =
    input.status !== undefined &&
    input.content === undefined &&
    input.type === undefined &&
    input.tags === undefined &&
    input.importance === undefined;

  if (statusOnly) {
    await osRequest(
      'POST',
      `/${INDEX.memories}/_update/${input.id}`,
      { doc: { status: input.status } },
      { refresh: 'wait_for' },
    );
    if (input.status === 'done' && existing.type === 'todo') {
      await linkTodoClosure(input.id, existing);
    }
    logger.info({ id: input.id, status: input.status }, 'update: status');
    return { id: input.id, action: 'updated', project: existing.project, superseded: [] };
  }

  const content = (input.content ?? existing.content).trim();
  if (content.length > LIMITS.contentChars) {
    throw new Error(`content exceeds ${LIMITS.contentChars} characters`);
  }

  const contentChanged = content !== existing.content;
  const embedding = contentChanged ? await embedOne(content, 'passage') : existing.embedding;
  const newId = randomUUID();

  const doc: MemoryDoc = {
    ...existing,
    content,
    embedding,
    type: input.type ?? existing.type,
    tags: input.tags ?? existing.tags,
    importance: input.importance ?? existing.importance,
    status: input.status ?? 'active',
    superseded_by: null,
    created_at: new Date().toISOString(),
    content_hash: contentHash(content),
  };

  await osRequest('PUT', `/${INDEX.memories}/_doc/${newId}`, doc, { refresh: 'wait_for' });
  await osRequest(
    'POST',
    `/${INDEX.memories}/_update/${input.id}`,
    { doc: { status: 'superseded', superseded_by: newId } },
    { refresh: 'wait_for' },
  );

  logger.info({ id: newId, replaced: input.id }, 'update: new version');
  return { id: newId, action: 'updated', project: doc.project, superseded: [input.id] };
}

export interface ForgetInput {
  id?: string;
  filter?: { project?: string; type?: MemoryType[]; tags?: string[]; before?: string };
  reason?: string;
}

/** Soft delete only. Hard delete lives in scripts/, deliberately off the MCP surface. */
export async function forget(input: ForgetInput): Promise<{ deleted: number }> {
  if (input.id) {
    await osRequest(
      'POST',
      `/${INDEX.memories}/_update/${input.id}`,
      { doc: { status: 'deleted' } },
      { refresh: 'wait_for' },
    );
    logger.info({ id: input.id, reason: input.reason }, 'forget: single');
    return { deleted: 1 };
  }

  if (!input.filter || Object.keys(input.filter).length === 0) {
    throw new Error('forget requires either an id or a non-empty filter');
  }

  const filter: unknown[] = [{ terms: { status: ['active'] } }];
  if (input.filter.project) filter.push({ term: { project: input.filter.project } });
  if (input.filter.type?.length) filter.push({ terms: { type: input.filter.type } });
  if (input.filter.tags?.length) filter.push({ terms: { tags: input.filter.tags } });
  if (input.filter.before) filter.push({ range: { occurred_at: { lt: parseSince(input.filter.before) } } });

  const res = await osRequest<{ updated: number }>(
    'POST',
    `/${INDEX.memories}/_update_by_query`,
    { query: { bool: { filter } }, script: { source: "ctx._source.status = 'deleted'" } },
    { refresh: 'true', conflicts: 'proceed' },
  );

  logger.info({ deleted: res.updated, reason: input.reason }, 'forget: bulk');
  return { deleted: res.updated };
}

export async function recentEpisodes(days: number, size: number, project?: string): Promise<MemoryHit[]> {
  const hits = await listMemories(
    {
      status: ['active'],
      type: ['episode'],
      since: `now-${days}d`,
      ...(project ? { project: [project] } : {}),
    },
    size,
  );
  return hits.map(toHit);
}

/** Episodes older than the Recent window — `days` bounds the block, not the memory. */
export async function earlierEpisodes(days: number, size: number, project?: string): Promise<MemoryHit[]> {
  const hits = await listMemories(
    {
      status: ['active'],
      type: ['episode'],
      until: `now-${days}d`,
      ...(project ? { project: [project] } : {}),
    },
    size,
  );
  return hits.map(toHit);
}

/** Anything the model or the user marked as significant, at any age. */
export async function milestones(size: number, project?: string): Promise<MemoryHit[]> {
  const hits = await listMemories(
    {
      status: ['active'],
      type: ['episode', 'decision', 'fact'],
      minImportance: 4,
      ...(project ? { project: [project] } : {}),
    },
    size,
    [{ importance: 'desc' }, { occurred_at: 'desc' }],
  );
  return hits.map(toHit);
}

export async function openTodos(project?: string, size = 20): Promise<MemoryHit[]> {
  const hits = await listMemories(
    { status: ['active'], type: ['todo'], ...(project ? { project: [project] } : {}) },
    size,
    [{ importance: 'desc' }, { occurred_at: 'desc' }],
  );
  return hits.map(toHit);
}

export async function allPreferences(size = 20): Promise<MemoryHit[]> {
  const hits = await listMemories({ status: ['active'], type: ['preference'] }, size, [
    { importance: 'desc' },
    { occurred_at: 'desc' },
  ]);
  return hits.map(toHit);
}
