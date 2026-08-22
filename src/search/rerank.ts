import type { MemoryStatus, MemoryType } from '../types.js';

export function ageInDays(iso: string, now: number): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  return Math.max(0, (now - then) / 86_400_000);
}

export interface Rerankable {
  score: number;
  type: MemoryType;
  importance: number;
  status: MemoryStatus;
  occurred_at: string;
}

/**
 * Spec §5: recency outranks importance, and each type decays differently.
 * Episodes fade fastest (a 90-day half-life keeps the journal current);
 * preferences never fade, because they hold until explicitly superseded.
 */
export function finalScore(hit: Rerankable, now: number): number {
  const age = ageInDays(hit.occurred_at, now);
  switch (hit.type) {
    case 'episode':
      // Year-scale decay with a floor: recent work still wins, but an old
      // episode never decays to irrelevance — that is how history got lost.
      return hit.score * Math.max(0.5, Math.exp(-age / 365));
    case 'todo':
      return hit.status === 'active' ? hit.score * 1.2 : hit.score;
    case 'preference':
      return hit.score;
    case 'decision':
    case 'fact':
      // No decay at all: a decision stands until something supersedes it.
      return hit.score * (1 + (hit.importance - 3) * 0.1);
  }
}

export function rerank<T extends Rerankable>(hits: T[], now: number = Date.now()): T[] {
  return hits
    .map(hit => ({ hit, s: finalScore(hit, now) }))
    .sort((a, b) => b.s - a.s)
    .map(({ hit, s }) => ({ ...hit, score: s }));
}

/** Reciprocal rank fusion, used when the `hybrid` query clause is unavailable. */
export function rrf(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    ranking.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}
