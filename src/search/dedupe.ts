import { createHash } from 'node:crypto';
import { INDEX, config } from '../config.js';
import type { MemoryType } from '../types.js';
import { osRequest } from './client.js';
import { knnSearch, type RawHit } from './hybrid.js';

/**
 * Canonical form for exact-duplicate detection: unicode-normalized, case-folded,
 * whitespace-collapsed, trailing punctuation dropped. Deliberately lossy — it
 * only ever feeds the hash, never storage.
 */
export function normalizeContent(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    // Trim before stripping punctuation, or trailing whitespace hides the terminator.
    .trim()
    .replace(/[.,;:!?…]+$/gu, '')
    .trim();
}

export function contentHash(input: string): string {
  return createHash('sha256').update(normalizeContent(input), 'utf8').digest('hex');
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

/** Exact hit on the normalized hash — the same statement, restated. */
export async function findByHash(hash: string, project: string, type: MemoryType): Promise<RawHit | null> {
  const res = await osRequest<{ hits: { hits: RawHit[] } }>('POST', `/${INDEX.memories}/_search`, {
    size: 1,
    _source: { excludes: ['embedding'] },
    query: {
      bool: {
        filter: [
          { term: { content_hash: hash } },
          { term: { project } },
          { term: { type } },
          { terms: { status: ['active'] } },
        ],
      },
    },
  });
  return res.hits.hits[0] ?? null;
}

export interface NearDuplicate {
  id: string;
  similarity: number;
  locked: boolean;
}

/**
 * Nearest active memory of the same type in the same project. Cosine is
 * recomputed in Node from the stored vector rather than read off `_score`,
 * whose scale depends on the k-NN engine and space type.
 */
export async function findNearDuplicate(
  vector: number[],
  type: MemoryType,
  project: string,
  threshold: number = config.DEDUPE_THRESHOLD,
): Promise<NearDuplicate | null> {
  const hits = await knnSearch(vector, { project: [project], type: [type] }, 5);

  let best: NearDuplicate | null = null;
  for (const hit of hits) {
    const stored = hit._source.embedding;
    if (!stored) continue;
    const similarity = cosine(vector, stored);
    if (similarity >= threshold && (!best || similarity > best.similarity)) {
      best = { id: hit._id, similarity, locked: hit._source.locked === true };
    }
  }
  return best;
}

export interface Neighbor {
  id: string;
  content: string;
  embedding?: number[];
  locked?: boolean;
}

export interface WritePlan {
  /** contained: the new text is already inside a stored record — touch that one, write nothing. */
  action: 'new' | 'supersede' | 'contained';
  target?: { id: string; similarity: number };
  /** Close but below the merge bar — returned so the calling model can decide. */
  similar: { id: string; content: string; similarity: number }[];
}

/** Shorter than this, "contained in" is coincidence rather than restatement. */
const MIN_CONTAINED_CHARS = 20;
const MAX_SIMILAR = 3;

/**
 * Where a new fact sits relative to its nearest stored neighbours (same project
 * and type). Substring checks catch what cosine misses: a restatement that
 * drops or adds a clause scores well below the dedupe bar yet says nothing new.
 */
export function planWrite(
  content: string,
  vector: number[],
  neighbors: Neighbor[],
  dedupeThreshold: number,
  relatedThreshold: number,
): WritePlan {
  const mine = normalizeContent(content);
  const scored = neighbors
    .filter(n => Array.isArray(n.embedding) && n.embedding.length > 0)
    .map(n => ({ ...n, similarity: cosine(vector, n.embedding!), norm: normalizeContent(n.content) }))
    .sort((a, b) => b.similarity - a.similarity);

  let plan: Omit<WritePlan, 'similar'> = { action: 'new' };
  for (const n of scored) {
    if (n.similarity < relatedThreshold) break;
    const target = { id: n.id, similarity: n.similarity };
    if (mine.length >= MIN_CONTAINED_CHARS && n.norm.includes(mine)) {
      plan = { action: 'contained', target };
      break;
    }
    if (n.similarity >= dedupeThreshold || (n.norm.length >= MIN_CONTAINED_CHARS && mine.includes(n.norm))) {
      // A locked record is a user correction: a restatement must not replace it.
      plan = { action: n.locked ? 'contained' : 'supersede', target };
      break;
    }
  }

  const similar = scored
    .filter(n => n.similarity >= relatedThreshold && n.id !== plan.target?.id)
    .slice(0, MAX_SIMILAR)
    .map(n => ({ id: n.id, content: n.content, similarity: Number(n.similarity.toFixed(4)) }));

  return { ...plan, similar };
}
