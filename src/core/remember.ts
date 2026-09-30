import { randomUUID } from 'node:crypto';
import { INDEX, LIMITS, config } from '../config.js';
import { embedOne } from '../embed/embedder.js';
import { logger } from '../logger.js';
import { contentHash, cosine, findByHash, findNearDuplicate, planWrite } from '../search/dedupe.js';
import { knnSearch } from '../search/hybrid.js';
import { osRequest } from '../search/client.js';
import {
  DEDUPED_TYPES,
  type EpisodeBody,
  type MemoryDoc,
  type MemorySource,
  type MemoryType,
  type RememberResult,
} from '../types.js';
import { recordEvent } from './events.js';
import { touchProject } from './projects.js';
import { linkRelated } from './related.js';

const nowIso = () => new Date().toISOString();

const EMPTY_SOURCE: MemorySource = { kind: 'tool', client: null, device: null, session_id: null };

/** Episodes store their structured fields and a flattened copy for search. */
export function flattenEpisode(e: EpisodeBody): string {
  return [e.did, e.why, e.outcome, e.deferred].map(s => s?.trim()).filter(Boolean).join(' ');
}

export function normalizeEpisode(input: Partial<EpisodeBody>): EpisodeBody {
  return {
    did: (input.did ?? '').trim(),
    why: (input.why ?? '').trim(),
    outcome: (input.outcome ?? '').trim(),
    deferred: (input.deferred ?? '').trim(),
    files: (input.files ?? []).slice(0, 10),
    commits: input.commits ?? [],
  };
}

async function writeDoc(id: string, doc: MemoryDoc): Promise<void> {
  // wait_for keeps a batch honest: fact N+1 must be able to see fact N when deduping.
  await osRequest('PUT', `/${INDEX.memories}/_doc/${id}`, doc, { refresh: 'wait_for' });
}

async function supersede(oldId: string, newId: string): Promise<void> {
  await osRequest(
    'POST',
    `/${INDEX.memories}/_update/${oldId}`,
    { doc: { status: 'superseded', superseded_by: newId } },
    { refresh: 'wait_for' },
  );
}

export interface RememberInput {
  content?: string;
  type: MemoryType;
  project?: string;
  tags?: string[];
  importance?: number;
  episode?: Partial<EpisodeBody>;
  source?: MemorySource;
  occurred_at?: string;
  /** Repo-relative note paths written by the Stop hook. */
  refs?: string[];
  /** Full markdown of the note, for clients that cannot read the repo. */
  note?: string;
}

/** Normalizes and bounds the note-linking fields shared by create and update. */
function normalizeRefs(refs: string[] | undefined): string[] {
  return [...new Set((refs ?? []).map(r => r.trim()).filter(Boolean))].slice(0, LIMITS.maxRefs);
}

function normalizeNote(note: string | undefined): string | null {
  const trimmed = note?.trim();
  if (!trimmed) return null;
  if (trimmed.length > LIMITS.noteChars) {
    throw new Error(`note exceeds ${LIMITS.noteChars} characters (got ${trimmed.length})`);
  }
  return trimmed;
}

/** The live episode for a session, if the Stop hook already wrote one. */
export async function findEpisodeBySession(sessionId: string): Promise<{ id: string; doc: MemoryDoc } | null> {
  const res = await osRequest<{ hits: { hits: { _id: string; _source: MemoryDoc }[] } }>(
    'POST',
    `/${INDEX.memories}/_search`,
    {
      size: 1,
      query: {
        bool: {
          filter: [
            { term: { type: 'episode' } },
            { term: { 'source.session_id': sessionId } },
            { term: { status: 'active' } },
          ],
        },
      },
      sort: [{ created_at: 'desc' }],
    },
  );
  const hit = res.hits.hits[0];
  return hit ? { id: hit._id, doc: hit._source } : null;
}

/** The todo split out of an episode's `deferred`, if one exists. */
async function findDeferredTodo(sessionId: string): Promise<{ id: string; doc: MemoryDoc } | null> {
  const res = await osRequest<{ hits: { hits: { _id: string; _source: MemoryDoc }[] } }>(
    'POST',
    `/${INDEX.memories}/_search`,
    {
      size: 1,
      query: {
        bool: {
          filter: [
            { term: { type: 'todo' } },
            { term: { 'source.session_id': sessionId } },
            { term: { tags: 'deferred' } },
            { terms: { status: ['active', 'done'] } },
          ],
        },
      },
      sort: [{ created_at: 'desc' }],
    },
  );
  const hit = res.hits.hits[0];
  return hit ? { id: hit._id, doc: hit._source } : null;
}

/** The nearest active decision in the project, if it is close enough to count. */
async function findCoveringDecision(
  vector: number[],
  project: string,
): Promise<{ id: string; similarity: number } | null> {
  try {
    const hits = await knnSearch(vector, { project: [project], type: ['decision'], status: ['active'] }, 3);
    let best: { id: string; similarity: number } | null = null;
    for (const hit of hits) {
      const stored = hit._source.embedding;
      if (!stored) continue;
      const similarity = cosine(vector, stored);
      if (similarity >= config.TODO_DECISION_THRESHOLD && (!best || similarity > best.similarity)) {
        best = { id: hit._id, similarity };
      }
    }
    return best;
  } catch (err) {
    // Failing open means a spurious todo, which is recoverable. Failing closed
    // would silently drop real open work.
    logger.warn({ err: (err as Error).message }, 'covering-decision check failed; creating the todo anyway');
    return null;
  }
}

/**
 * `deferred` is the only part of an episode that is still open work, so it also
 * lives as a real todo — otherwise it is invisible to the Open todos block and
 * can never be closed. Keyed on session_id so repeated Stop hooks update the
 * one todo instead of breeding new ones.
 */
async function syncDeferredTodo(args: {
  sessionId: string | null;
  project: string;
  deferred: string;
  source: MemorySource;
  occurredAt: string;
}): Promise<void> {
  if (!args.sessionId) return;
  const existing = await findDeferredTodo(args.sessionId);
  const deferred = args.deferred.trim();

  if (!deferred) {
    // The session stopped deferring it — close the todo rather than delete it.
    if (existing && existing.doc.status === 'active') {
      await osRequest(
        'POST',
        `/${INDEX.memories}/_update/${existing.id}`,
        { doc: { status: 'done' } },
        { refresh: 'wait_for' },
      );
      logger.info({ id: existing.id, session_id: args.sessionId }, 'deferred todo closed');
    }
    return;
  }

  if (existing) {
    if (existing.doc.content === deferred && existing.doc.status === 'active') return;
    const embedding =
      existing.doc.content === deferred ? existing.doc.embedding : await embedOne(deferred, 'passage');
    await osRequest(
      'POST',
      `/${INDEX.memories}/_update/${existing.id}`,
      {
        doc: {
          content: deferred,
          embedding,
          content_hash: contentHash(deferred),
          status: 'active',
          occurred_at: args.occurredAt,
        },
      },
      { refresh: 'wait_for' },
    );
    logger.info({ id: existing.id, session_id: args.sessionId }, 'deferred todo updated');
    return;
  }

  const embedding = await embedOne(deferred, 'passage');

  // The subject may already be settled by a decision — "we decided not to do
  // this" is recorded as a decision, and turning the same text into an open todo
  // would resurrect closed work every session.
  //
  // NOTE: cosine measures topical overlap, not negation. It cannot tell a
  // contradiction from an agreement, so this suppresses any deferred item whose
  // subject an active decision already covers. That is the intended effect, but
  // it is broader than "contradicts" — a decision that *mandates* the work also
  // suppresses the todo. Raise TODO_DECISION_THRESHOLD if that bites.
  const covering = await findCoveringDecision(embedding, args.project);
  if (covering) {
    logger.info(
      { session_id: args.sessionId, decision: covering.id, cosine: Number(covering.similarity.toFixed(4)) },
      'deferred todo skipped: an active decision already covers this subject',
    );
    return;
  }

  // The same open item restated by a later session: replace the older todo
  // rather than stacking a near-copy next to it.
  const twin = await findNearDuplicate(embedding, 'todo', args.project, config.TODO_MERGE_THRESHOLD);

  const id = randomUUID();
  const timestamp = nowIso();
  await writeDoc(id, {
    content: deferred,
    embedding,
    type: 'todo',
    project: args.project,
    tags: ['deferred'],
    importance: 3,
    status: 'active',
    superseded_by: null,
    episode: null,
    source: args.source,
    related: [],
    // The todo's context lives in the episode's note, not its own.
    refs: [],
    note: null,
    occurred_at: args.occurredAt,
    created_at: timestamp,
    content_hash: contentHash(deferred),
  });
  if (twin) {
    await supersede(twin.id, id);
    logger.info(
      { id, superseded: twin.id, cosine: Number(twin.similarity.toFixed(4)), project: args.project },
      'deferred todo replaced an open todo from an earlier session',
    );
    return;
  }
  logger.info({ id, session_id: args.sessionId, project: args.project }, 'deferred todo created');
}

/**
 * The single write path, shared by the MCP tool and POST /api/ingest.
 *
 * Facts go through hash-then-vector dedupe. Episodes dedupe on session_id
 * instead: the Stop hook fires more than once per session, and one session is
 * one journal entry — so a second write updates the first rather than adding to it.
 */
export async function remember(input: RememberInput): Promise<RememberResult> {
  const project = input.project?.trim() || config.DEFAULT_PROJECT;
  const isEpisode = input.type === 'episode';
  const episode = isEpisode ? normalizeEpisode(input.episode ?? {}) : null;

  const content = (isEpisode && episode ? flattenEpisode(episode) : (input.content ?? '')).trim();
  if (!content) throw new Error(isEpisode ? 'episode has no text' : 'content is empty');
  if (content.length > LIMITS.contentChars) {
    throw new Error(`content exceeds ${LIMITS.contentChars} characters (got ${content.length})`);
  }

  const timestamp = nowIso();
  const hash = contentHash(content);
  const deduped = (DEDUPED_TYPES as readonly MemoryType[]).includes(input.type);

  if (isEpisode && episode) {
    const source = input.source ?? EMPTY_SOURCE;
    const sessionId = source.session_id ?? null;
    const existing = sessionId ? await findEpisodeBySession(sessionId) : null;

    if (existing) {
      // Same session, later Stop hook: overwrite in place. The transcript grew,
      // so the newer summary supersedes the earlier one entirely.
      await osRequest(
        'POST',
        `/${INDEX.memories}/_update/${existing.id}`,
        {
          doc: {
            content,
            embedding: await embedOne(content, 'passage'),
            content_hash: hash,
            episode,
            project,
            tags: [...new Set([...(existing.doc.tags ?? []), ...(input.tags ?? [])])],
            importance: Math.max(existing.doc.importance, input.importance ?? 3),
            // Union rather than overwrite: a later Stop whose extraction found
            // fewer decisions must not drop refs to ADR files still on disk.
            refs: normalizeRefs([...(existing.doc.refs ?? []), ...(input.refs ?? [])]),
            // The note is a full regeneration of the same session — replace it.
            note: normalizeNote(input.note) ?? existing.doc.note ?? null,
            occurred_at: input.occurred_at ?? existing.doc.occurred_at,
          },
        },
        { refresh: 'wait_for' },
      );
      await syncDeferredTodo({
        sessionId,
        project,
        deferred: episode.deferred,
        source,
        occurredAt: input.occurred_at ?? existing.doc.occurred_at,
      });
      await touchProject(project, timestamp);
      logger.info({ id: existing.id, project, session_id: sessionId }, 'remember: episode updated');
      return { id: existing.id, action: 'updated', project, superseded: [] };
    }
  }

  if (deduped) {
    const exact = await findByHash(hash, project, input.type);
    if (exact) {
      // Already stored verbatim — merge metadata rather than create a twin.
      const merged = {
        tags: [...new Set([...(exact._source.tags ?? []), ...(input.tags ?? [])])],
        importance: Math.max(exact._source.importance, input.importance ?? 3),
        occurred_at: input.occurred_at ?? timestamp,
      };
      await osRequest('POST', `/${INDEX.memories}/_update/${exact._id}`, { doc: merged }, { refresh: 'wait_for' });
      await touchProject(project, timestamp);
      logger.info({ id: exact._id, project, type: input.type }, 'remember: updated');
      return { id: exact._id, action: 'updated', project, superseded: [] };
    }
  }

  const embedding = await embedOne(content, 'passage');
  const neighbors = deduped ? await knnSearch(embedding, { project: [project], type: [input.type] }, 5) : [];
  const plan = deduped
    ? planWrite(
        content,
        embedding,
        neighbors.map(h => ({ id: h._id, content: h._source.content, embedding: h._source.embedding })),
        config.DEDUPE_THRESHOLD,
        config.RELATED_THRESHOLD,
      )
    : null;
  const similar = plan?.similar.length ? { similar: plan.similar } : {};

  if (plan?.action === 'contained' && plan.target) {
    // Adds nothing the stored record does not already say — keep that one.
    const target = neighbors.find(h => h._id === plan.target!.id)?._source;
    await osRequest(
      'POST',
      `/${INDEX.memories}/_update/${plan.target.id}`,
      {
        doc: {
          tags: [...new Set([...(target?.tags ?? []), ...(input.tags ?? [])])],
          importance: Math.max(target?.importance ?? 3, input.importance ?? 3),
          refs: normalizeRefs([...(target?.refs ?? []), ...(input.refs ?? [])]),
        },
      },
      { refresh: 'wait_for' },
    );
    await touchProject(project, timestamp);
    logger.info({ id: plan.target.id, project, type: input.type }, 'remember: contained in existing');
    return { id: plan.target.id, action: 'updated', project, superseded: [], ...similar };
  }
  const duplicate = plan?.action === 'supersede' ? plan.target : null;

  const id = randomUUID();
  const doc: MemoryDoc = {
    content,
    embedding,
    type: input.type,
    project,
    tags: input.tags ?? [],
    importance: input.importance ?? 3,
    status: 'active',
    superseded_by: null,
    episode,
    source: input.source ?? EMPTY_SOURCE,
    related: [],
    refs: normalizeRefs(input.refs),
    note: normalizeNote(input.note),
    occurred_at: input.occurred_at ?? timestamp,
    created_at: timestamp,
    content_hash: hash,
  };

  await writeDoc(id, doc);
  await touchProject(project, doc.occurred_at);

  // After the write, so the new doc is not its own neighbour candidate.
  await linkRelated(id, embedding, project);

  if (isEpisode && episode) {
    await syncDeferredTodo({
      sessionId: doc.source.session_id ?? null,
      project,
      deferred: episode.deferred,
      source: doc.source,
      occurredAt: doc.occurred_at,
    });
  }

  if (duplicate) {
    await supersede(duplicate.id, id);
    logger.info(
      { id, superseded: duplicate.id, similarity: Number(duplicate.similarity.toFixed(4)), project },
      'remember: merged',
    );
    return { id, action: 'merged', project, superseded: [duplicate.id], ...similar };
  }

  logger.info({ id, project, type: input.type }, 'remember: created');
  recordEvent({ kind: 'remember', project, source_kind: doc.source.kind, client: doc.source.client });
  return { id, action: 'created', project, superseded: [], ...similar };
}
