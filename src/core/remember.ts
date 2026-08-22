import { randomUUID } from 'node:crypto';
import { INDEX, LIMITS, config } from '../config.js';
import { embedOne } from '../embed/embedder.js';
import { logger } from '../logger.js';
import { contentHash, findByHash, findNearDuplicate } from '../search/dedupe.js';
import { osRequest } from '../search/client.js';
import {
  DEDUPED_TYPES,
  type EpisodeBody,
  type MemoryDoc,
  type MemorySource,
  type MemoryType,
  type RememberResult,
} from '../types.js';
import { touchProject } from './projects.js';

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
}

/**
 * The single write path, shared by the MCP tool and POST /api/ingest.
 *
 * Facts go through hash-then-vector dedupe. Episodes never do: each session is a
 * distinct entry in the journal even when two sessions read alike.
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
  const duplicate = deduped ? await findNearDuplicate(embedding, input.type, project) : null;

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
    occurred_at: input.occurred_at ?? timestamp,
    created_at: timestamp,
    content_hash: hash,
  };

  await writeDoc(id, doc);
  await touchProject(project, doc.occurred_at);

  if (duplicate) {
    await supersede(duplicate.id, id);
    logger.info(
      { id, superseded: duplicate.id, similarity: Number(duplicate.similarity.toFixed(4)), project },
      'remember: merged',
    );
    return { id, action: 'merged', project, superseded: [duplicate.id] };
  }

  logger.info({ id, project, type: input.type }, 'remember: created');
  return { id, action: 'created', project, superseded: [] };
}
