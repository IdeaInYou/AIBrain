import { describe, expect, it } from 'vitest';
import { finalScore, rerank, rrf } from '../src/search/rerank.js';
import { groupByMonth } from '../src/core/summary.js';
import type { MemoryStatus, MemoryType } from '../src/types.js';

const NOW = Date.parse('2026-08-22T00:00:00Z');
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function hit(type: MemoryType, ageDays: number, score = 1, importance = 3, status: MemoryStatus = 'active') {
  return { score, type, importance, status, occurred_at: daysAgo(ageDays) };
}

describe('finalScore', () => {
  it('decays episodes on a year scale', () => {
    expect(finalScore(hit('episode', 100), NOW)).toBeCloseTo(Math.exp(-100 / 365), 5);
  });

  // The floor is the point: without it, a year-old episode scores so low that
  // history effectively disappears from recall. exp(-age/365) crosses 0.5 at
  // 365·ln2 ≈ 253 days, so everything past that clamps.
  it('never lets an episode decay below half', () => {
    expect(finalScore(hit('episode', 253), NOW)).toBeCloseTo(0.5, 2);
    expect(finalScore(hit('episode', 365), NOW)).toBe(0.5);
    expect(finalScore(hit('episode', 3650), NOW)).toBe(0.5);
    expect(finalScore(hit('episode', 100_000), NOW)).toBe(0.5);
  });

  it('does not decay decisions or facts at all', () => {
    expect(finalScore(hit('decision', 3650), NOW)).toBeCloseTo(1);
    expect(finalScore(hit('fact', 3650), NOW)).toBeCloseTo(1);
  });

  it('never decays preferences', () => {
    expect(finalScore(hit('preference', 3650), NOW)).toBe(1);
  });

  it('boosts open todos but not closed ones', () => {
    expect(finalScore(hit('todo', 10), NOW)).toBeCloseTo(1.2);
    expect(finalScore(hit('todo', 10, 1, 3, 'done'), NOW)).toBeCloseTo(1);
  });

  it('applies the importance boost to decisions', () => {
    const high = finalScore(hit('decision', 0, 1, 5), NOW);
    const low = finalScore(hit('decision', 0, 1, 1), NOW);
    expect(high / low).toBeCloseTo(1.2 / 0.8, 5);
  });

  it('still prefers a recent episode over an equally-scored old one', () => {
    expect(finalScore(hit('episode', 7), NOW)).toBeGreaterThan(finalScore(hit('episode', 400), NOW));
  });

  it('lets an old decision outrank a recent episode of equal relevance', () => {
    expect(finalScore(hit('decision', 500), NOW)).toBeGreaterThan(finalScore(hit('episode', 500), NOW));
  });
});

describe('rerank', () => {
  it('sorts by final score and rewrites score in place', () => {
    const out = rerank([hit('episode', 365), hit('preference', 365)], NOW);
    expect(out[0]!.type).toBe('preference');
    expect(out[0]!.score).toBe(1);
    expect(out[1]!.score).toBeLessThan(1);
  });
});

describe('summary blocks', () => {
  it('groups episodes by calendar month, preserving order', () => {
    const at = (iso: string) => ({
      id: iso,
      content: 'x',
      type: 'episode' as const,
      project: 'p',
      tags: [],
      importance: 3,
      status: 'active' as const,
      episode: null,
      refs: [],
      has_note: false,
      occurred_at: iso,
      created_at: iso,
      score: 1,
    });
    const months = groupByMonth([
      at('2026-08-20T00:00:00Z'),
      at('2026-08-02T00:00:00Z'),
      at('2026-07-11T00:00:00Z'),
    ]);
    expect([...months.keys()]).toEqual(['2026-08', '2026-07']);
    expect(months.get('2026-08')).toHaveLength(2);
    expect(months.get('2026-07')).toHaveLength(1);
  });
});

describe('rrf', () => {
  it('rewards a document found by both retrievers over one found by a single one', () => {
    const scores = rrf([
      ['a', 'b', 'c'],
      ['b', 'd', 'e'],
    ]);
    // `b` is 2nd and 1st; `a` is 1st but appears only once.
    expect(scores.get('b')).toBeGreaterThan(scores.get('a')!);
  });

  it('preserves rank order within a single ranking', () => {
    const scores = rrf([['a', 'b', 'c']]);
    expect(scores.get('a')).toBeGreaterThan(scores.get('b')!);
    expect(scores.get('b')).toBeGreaterThan(scores.get('c')!);
  });
});
