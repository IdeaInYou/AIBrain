import { INDEX, config } from '../config.js';
import { logger } from '../logger.js';
import { osRequest } from '../search/client.js';
import { cosine } from '../search/dedupe.js';
import { knnSearch } from '../search/hybrid.js';
import type { MemoryDoc } from '../types.js';

/**
 * Adds `id` to each target's `related` without clobbering what is there. Done
 * with a script so concurrent writers cannot lose each other's links.
 */
async function addBacklinks(targets: string[], id: string): Promise<void> {
  if (targets.length === 0) return;
  const lines = targets.flatMap(target => [
    { update: { _id: target, _index: INDEX.memories } },
    {
      script: {
        source:
          'if (ctx._source.related == null) { ctx._source.related = [] } ' +
          'if (!ctx._source.related.contains(params.id)) { ctx._source.related.add(params.id) }',
        params: { id },
      },
    },
  ]);
  await osRequest('POST', '/_bulk', `${lines.map(l => JSON.stringify(l)).join('\n')}\n`, {
    refresh: 'wait_for',
  });
}

/**
 * Links a freshly written memory to its neighbours, in both directions.
 *
 * Runs across all types in the project — an episode should surface the decision
 * it implemented, not just other episodes. The threshold is looser than dedupe:
 * these are "about the same thing", not "the same thing".
 */
export interface Candidate {
  id: string;
  embedding?: number[] | undefined;
}

/**
 * Which neighbours qualify. Pure so the threshold behaviour is testable without
 * a cluster — cosine is recomputed here rather than read off `_score`, whose
 * scale depends on the k-NN engine.
 */
export function selectRelated(
  candidates: Candidate[],
  vector: number[],
  selfId: string,
  threshold = config.RELATED_THRESHOLD,
  max = config.RELATED_MAX,
): string[] {
  return candidates
    .filter(c => c.id !== selfId && c.embedding && c.embedding.length > 0)
    .map(c => ({ id: c.id, sim: cosine(vector, c.embedding!) }))
    .filter(x => x.sim >= threshold)
    .sort((a, b) => b.sim - a.sim || a.id.localeCompare(b.id))
    .slice(0, max)
    .map(x => x.id);
}

export async function linkRelated(id: string, vector: number[], project: string): Promise<string[]> {
  try {
    const hits = await knnSearch(vector, { project: [project], status: ['active'] }, config.RELATED_MAX + 1);
    const related = selectRelated(
      hits.map(h => ({ id: h._id, embedding: h._source.embedding })),
      vector,
      id,
    );

    if (related.length === 0) return [];

    await osRequest('POST', `/${INDEX.memories}/_update/${id}`, { doc: { related } }, { refresh: 'wait_for' });
    await addBacklinks(related, id);

    logger.info({ id, related: related.length, project }, 'related: linked');
    return related;
  } catch (err) {
    // A missing link is a degraded result, never a failed write.
    logger.warn({ id, err: (err as Error).message }, 'related: linking failed');
    return [];
  }
}

/** Symmetric link between two ids, used for the todo open→closed chain. */
export async function linkPair(a: string, b: string): Promise<void> {
  if (a === b) return;
  try {
    await addBacklinks([a], b);
    await addBacklinks([b], a);
  } catch (err) {
    logger.warn({ a, b, err: (err as Error).message }, 'related: pair link failed');
  }
}

export interface SeeAlso {
  id: string;
  type: string;
  summary: string;
}

/** Hydrates `related` ids into one-line summaries for recall output. */
export async function hydrateRelated(ids: string[]): Promise<SeeAlso[]> {
  if (ids.length === 0) return [];
  try {
    const res = await osRequest<{ docs: { _id: string; found: boolean; _source?: MemoryDoc }[] }>(
      'POST',
      `/${INDEX.memories}/_mget`,
      { ids },
      { _source_excludes: 'embedding,note' },
    );
    return res.docs
      .filter(d => d.found && d._source && d._source.status === 'active')
      .map(d => {
        const s = d._source!;
        const text = s.episode?.did?.trim() || s.content;
        const first = /^(.+?[.!?])(\s|$)/s.exec(text.trim())?.[1] ?? text.trim();
        return { id: d._id, type: s.type, summary: first.slice(0, 120) };
      });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'related: hydrate failed');
    return [];
  }
}
