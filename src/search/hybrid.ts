import { INDEX, SEARCH_PIPELINE } from '../config.js';
import { logger } from '../logger.js';
import type { MemoryDoc, MemoryFilters } from '../types.js';
import { osRequest, statusOf } from './client.js';
import { rrf } from './rerank.js';

export interface RawHit {
  _id: string;
  _score: number;
  _source: Omit<MemoryDoc, 'embedding'> & { embedding?: number[] };
}

interface SearchResponse {
  hits: { hits: RawHit[] };
}

export function buildFilters(f: MemoryFilters): unknown[] {
  const clauses: unknown[] = [{ terms: { status: f.status ?? ['active'] } }];
  if (f.project?.length) clauses.push({ terms: { project: f.project } });
  if (f.type?.length) clauses.push({ terms: { type: f.type } });
  if (f.tags?.length) clauses.push({ terms: { tags: f.tags } });
  if (f.since) clauses.push({ range: { occurred_at: { gte: f.since } } });
  return clauses;
}

// Flipped off the first time OpenSearch rejects a `hybrid` clause, so the
// fallback is used for the rest of the process lifetime.
let hybridSupported = true;

export interface SearchArgs {
  query: string;
  vector: number[];
  filters: MemoryFilters;
  k: number;
}

export async function searchMemories(args: SearchArgs): Promise<RawHit[]> {
  if (hybridSupported) {
    try {
      return await hybridSearch(args);
    } catch (err) {
      if (!isUnsupportedHybrid(err)) throw err;
      hybridSupported = false;
      logger.warn('hybrid query unavailable — falling back to client-side RRF');
    }
  }
  return fallbackSearch(args);
}

function isUnsupportedHybrid(err: unknown): boolean {
  if (statusOf(err) !== 400) return false;
  return JSON.stringify((err as { body?: unknown }).body ?? (err as Error).message ?? '').includes('hybrid');
}

const NO_VECTOR = { excludes: ['embedding'] };

/** One round trip: BM25 + kNN normalized and combined by the search pipeline. */
async function hybridSearch({ query, vector, filters, k }: SearchArgs): Promise<RawHit[]> {
  const filter = buildFilters(filters);
  const body = {
    size: k,
    _source: NO_VECTOR,
    query: {
      hybrid: {
        queries: [
          { bool: { must: [{ match: { content: { query, operator: 'or' } } }], filter } },
          // knn's own `filter` pre-filters inside the HNSW walk; a bool filter
          // wrapped around it would post-filter and silently return fewer hits.
          { knn: { embedding: { vector, k: k * 3, filter: { bool: { filter } } } } },
        ],
      },
    },
  };

  const res = await osRequest<SearchResponse>('POST', `/${INDEX.memories}/_search`, body, {
    search_pipeline: SEARCH_PIPELINE,
  });
  return res.hits.hits;
}

/** Two queries fused in Node — for OpenSearch without the neural-search plugin. */
async function fallbackSearch({ query, vector, filters, k }: SearchArgs): Promise<RawHit[]> {
  const filter = buildFilters(filters);
  const [bm25, knn] = await Promise.all([
    osRequest<SearchResponse>('POST', `/${INDEX.memories}/_search`, {
      size: k * 3,
      _source: NO_VECTOR,
      query: { bool: { must: [{ match: { content: { query, operator: 'or' } } }], filter } },
    }),
    osRequest<SearchResponse>('POST', `/${INDEX.memories}/_search`, {
      size: k * 3,
      _source: NO_VECTOR,
      query: { knn: { embedding: { vector, k: k * 3, filter: { bool: { filter } } } } },
    }),
  ]);

  const byId = new Map<string, RawHit>();
  for (const hit of [...bm25.hits.hits, ...knn.hits.hits]) byId.set(hit._id, hit);

  const fused = rrf([bm25.hits.hits.map(h => h._id), knn.hits.hits.map(h => h._id)]);
  return [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .flatMap(([id, score]) => {
      const hit = byId.get(id);
      return hit ? [{ ...hit, _score: score }] : [];
    });
}

/** Pure kNN with the stored vectors returned — dedupe needs them for an exact cosine. */
export async function knnSearch(vector: number[], filters: MemoryFilters, k: number): Promise<RawHit[]> {
  const filter = buildFilters(filters);
  const res = await osRequest<SearchResponse>('POST', `/${INDEX.memories}/_search`, {
    size: k,
    _source: true,
    query: { knn: { embedding: { vector, k, filter: { bool: { filter } } } } },
  });
  return res.hits.hits;
}

/** Plain filtered listing, newest first — the summary timeline and todo lists. */
export async function listMemories(
  filters: MemoryFilters,
  size: number,
  sort: unknown[] = [{ occurred_at: 'desc' }],
): Promise<RawHit[]> {
  const res = await osRequest<SearchResponse>('POST', `/${INDEX.memories}/_search`, {
    size,
    _source: NO_VECTOR,
    query: { bool: { filter: buildFilters(filters) } },
    sort,
  });
  return res.hits.hits;
}
