import { INDEX, SEARCH_PIPELINE, config } from '../config.js';
import { logger } from '../logger.js';
import { osExists, osRequest, statusOf } from './client.js';

/** Storage is English-only, so the built-in `english` analyzer is enough — no ICU plugin. */
export function memoriesMapping(dim: number) {
  return {
    settings: { index: { knn: true, number_of_shards: 1, number_of_replicas: 0 } },
    mappings: {
      properties: {
        content: { type: 'text', analyzer: 'english' },
        embedding: {
          type: 'knn_vector',
          dimension: dim,
          method: {
            name: 'hnsw',
            space_type: 'cosinesimil',
            engine: 'lucene',
            parameters: { ef_construction: 128, m: 16 },
          },
        },
        type: { type: 'keyword' },
        project: { type: 'keyword' },
        tags: { type: 'keyword' },
        importance: { type: 'byte' },
        status: { type: 'keyword' },
        superseded_by: { type: 'keyword' },
        episode: {
          type: 'object',
          properties: {
            did: { type: 'text', analyzer: 'english' },
            why: { type: 'text', analyzer: 'english' },
            outcome: { type: 'text', analyzer: 'english' },
            deferred: { type: 'text', analyzer: 'english' },
            files: { type: 'keyword' },
          },
        },
        source: {
          type: 'object',
          properties: {
            kind: { type: 'keyword' },
            client: { type: 'keyword' },
            device: { type: 'keyword' },
            session_id: { type: 'keyword' },
          },
        },
        occurred_at: { type: 'date' },
        created_at: { type: 'date' },
        content_hash: { type: 'keyword' },
      },
    },
  };
}

export const projectsMapping = {
  settings: { index: { number_of_shards: 1, number_of_replicas: 0 } },
  mappings: {
    properties: {
      slug: { type: 'keyword' },
      name: { type: 'text' },
      repo_names: { type: 'keyword' },
      aliases: { type: 'keyword' },
      last_activity: { type: 'date' },
    },
  },
};

/** BM25 : kNN weighting from spec §7. */
export const hybridPipeline = {
  description: 'min-max normalize BM25 and kNN scores, combine 0.4 : 0.6',
  phase_results_processors: [
    {
      'normalization-processor': {
        normalization: { technique: 'min_max' },
        combination: { technique: 'arithmetic_mean', parameters: { weights: [0.4, 0.6] } },
      },
    },
  ],
};

async function ensureIndex(name: string, body: unknown): Promise<'created' | 'exists'> {
  if (await osExists(`/${name}`)) return 'exists';
  try {
    await osRequest('PUT', `/${name}`, body);
  } catch (err) {
    // resource_already_exists_exception — something created it between the
    // check and the write. Not an error for an idempotent bootstrap.
    if (statusOf(err) !== 400) throw err;
    return 'exists';
  }
  return 'created';
}

/** Idempotent: safe on every boot and from `npm run init-index`. */
export async function ensureIndices(): Promise<Record<string, string>> {
  const result: Record<string, string> = {
    [INDEX.memories]: await ensureIndex(INDEX.memories, memoriesMapping(config.EMBED_DIM)),
    [INDEX.projects]: await ensureIndex(INDEX.projects, projectsMapping),
  };

  await osRequest('PUT', `/_search/pipeline/${SEARCH_PIPELINE}`, hybridPipeline);
  result[`pipeline:${SEARCH_PIPELINE}`] = 'applied';

  logger.info({ result }, 'indices ready');
  return result;
}

/**
 * A changed embedding model with an unchanged index means every write fails at
 * index time. Catch it at boot instead.
 */
export async function assertEmbedDim(expected: number): Promise<void> {
  let mapping: Record<string, { mappings?: { properties?: { embedding?: { dimension?: number } } } }>;
  try {
    mapping = await osRequest('GET', `/${INDEX.memories}/_mapping`);
  } catch (err) {
    if (statusOf(err) === 404) {
      // ensureIndices() ran and claimed success, so an absent index means the
      // existence check lied — say that, rather than surfacing a bare 404.
      throw new Error(
        `Index ${INDEX.memories} is missing immediately after ensureIndices() reported success. ` +
          'Index creation was skipped by a faulty existence check.',
      );
    }
    throw err;
  }
  const actual = Object.values(mapping)[0]?.mappings?.properties?.embedding?.dimension;
  if (actual !== undefined && actual !== expected) {
    throw new Error(
      `Index ${INDEX.memories} has embedding dimension ${actual} but EMBED_DIM=${expected}. ` +
        'Changing the embedding model requires `npm run reindex`.',
    );
  }
}
