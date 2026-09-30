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
            commits: {
              type: 'object',
              properties: { sha: { type: 'keyword' }, message: { type: 'text', analyzer: 'english' } },
            },
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
        related: { type: 'keyword' },
        refs: { type: 'keyword' },
        // Stored for retrieval but never indexed: notes are large, and search
        // goes through `content`. Chunked note search is a separate patch.
        note: { type: 'text', index: false },
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
      brief: { type: 'text', index: false },
      brief_updated_at: { type: 'date' },
    },
  },
};

/** OAuth clients, codes and tokens. Persisted so a redeploy does not sign devices out. */
export const oauthMapping = {
  settings: { index: { number_of_shards: 1, number_of_replicas: 0 } },
  mappings: {
    properties: {
      kind: { type: 'keyword' },
      client_id: { type: 'keyword' },
      client_name: { type: 'keyword' },
      redirect_uris: { type: 'keyword' },
      redirect_uri: { type: 'keyword' },
      code_challenge: { type: 'keyword' },
      code_challenge_method: { type: 'keyword' },
      scope: { type: 'keyword' },
      resource: { type: 'keyword' },
      family: { type: 'keyword' },
      created_at: { type: 'date' },
      expires_at: { type: 'date' },
    },
  },
};

/** Usage metrics. No memory content ever lands here — only shapes and timings. */
export const eventsMapping = {
  settings: { index: { number_of_shards: 1, number_of_replicas: 0 } },
  mappings: {
    properties: {
      ts: { type: 'date' },
      kind: { type: 'keyword' },
      client: { type: 'keyword' },
      project: { type: 'keyword' },
      source_kind: { type: 'keyword' },
      k: { type: 'integer' },
      hits: { type: 'integer' },
      latency_ms: { type: 'integer' },
      query_len: { type: 'integer' },
      top_score: { type: 'float' },
      cached: { type: 'boolean' },
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

/**
 * Fields added to `memories` after the index already existed.
 *
 * `ensureIndex` only creates, never alters, so without this a new field is left
 * to dynamic mapping the first time a document carries it. That is silent and
 * wrong: `note` would be indexed as searchable text — 20 KB of markdown per
 * record, for a field that is never searched.
 *
 * A `PUT _mapping` is idempotent and additive. It only fails on a type conflict
 * with an already-mapped field, which is worth a warning rather than a crash:
 * the server still runs, just with a suboptimal mapping.
 */
async function ensureMappings(): Promise<void> {
  const additions = {
    properties: {
      refs: { type: 'keyword' },
      related: { type: 'keyword' },
      note: { type: 'text', index: false },
      episode: {
        properties: {
          commits: {
            type: 'object',
            properties: { sha: { type: 'keyword' }, message: { type: 'text', analyzer: 'english' } },
          },
        },
      },
    },
  };

  const projectAdditions = {
    properties: { brief: { type: 'text', index: false }, brief_updated_at: { type: 'date' } },
  };

  for (const [index, body] of [
    [INDEX.memories, additions],
    [INDEX.projects, projectAdditions],
  ] as const) {
    try {
      await osRequest('PUT', `/${index}/_mapping`, body);
      logger.info({ index }, 'mappings up to date');
    } catch (err) {
      logger.warn(
        { index, err: (err as Error).message },
        'mapping update failed — a field may already be mapped with a conflicting type; reindex to fix',
      );
    }
  }
}

/** Idempotent: safe on every boot and from `npm run init-index`. */
export async function ensureIndices(): Promise<Record<string, string>> {
  const result: Record<string, string> = {
    [INDEX.memories]: await ensureIndex(INDEX.memories, memoriesMapping(config.EMBED_DIM)),
    [INDEX.projects]: await ensureIndex(INDEX.projects, projectsMapping),
    [INDEX.oauth]: await ensureIndex(INDEX.oauth, oauthMapping),
    [INDEX.events]: await ensureIndex(INDEX.events, eventsMapping),
  };

  // Runs whether the index was just created or already existed.
  await ensureMappings();

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
